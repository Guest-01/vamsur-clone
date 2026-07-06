/**
 * Enemy entity — a pooled Arcade sprite that chases the player, takes damage
 * with juicy feedback (white flash, knockback, hit sparks), and drops loot on
 * death. See ARCHITECTURE.md §B.
 *
 * Enemies are POOLED via a plain Arcade group (no classType). The owning system
 * (EnemySpawner) reuses dead instances:
 *
 *   let e = group.getFirstDead(false) as Enemy | null;
 *   if (!e) { e = new Enemy(scene); group.add(e, true); }
 *   e.spawn(ctx, def, x, y);
 *
 * When done an enemy calls `deactivate()` (disable body + hide) so the pool can
 * recycle it.
 */
import Phaser from 'phaser';
import type { EnemyDef, EnemyLike, GameContext } from '../types';
import { TEXTURES } from '../config/assets';
import {
  COLORS,
  DEPTH,
  ENTITY_SCALE,
  PICKUP,
  SPAWN,
  curseMults,
  damageScale,
  hpScale,
  speedScale,
} from '../config/balance';

/** Squared despawn distance — compared without sqrt for cheapness. */
const DESPAWN_DIST_SQ = SPAWN.DESPAWN_DIST * SPAWN.DESPAWN_DIST;

export class Enemy extends Phaser.Physics.Arcade.Sprite implements EnemyLike {
  // EnemyLike contract -------------------------------------------------------
  public def!: EnemyDef;
  public hp = 0;
  public maxHp = 0;
  public spawnGen = 0;

  /**
   * Effective contact damage (def value scaled by elapsed-time difficulty).
   * GameScene's `onPlayerTouchEnemy` reads this directly.
   */
  public contactDamage = 0;

  // internal state -----------------------------------------------------------
  private ctx!: GameContext;
  /** chase movement speed in px/s (def value × time scaling). */
  private speed = 0;
  /** ms remaining of the white hit-flash. */
  private flashLeft = 0;
  /** ms remaining of a knockback impulse, during which we don't steer. */
  private knockbackLeft = 0;
  /** per-enemy wobble phase so wander-chasers don't all sync up. */
  private wobblePhase = 0;
  /** running clock used for sine wobble + bar bob. */
  private clock = 0;

  // attached visuals (created lazily, reused across spawns) ------------------
  private shadow?: Phaser.GameObjects.Image;
  /** floating HP bar (bosses/elites only): [track, fill]. */
  private hpBar?: Phaser.GameObjects.Container;
  private hpBarFill?: Phaser.GameObjects.Rectangle;
  private hpBarW = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEXTURES.SPRITES, 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    // Circular body keeps contact collisions fair regardless of sprite shape.
    this.setCircle(5);
    // Start fully inactive so getFirstDead() can hand us out.
    this.disableBody(true, true);
    this.setActive(false).setVisible(false);
  }

  /* ----------------------------------------------------------------------- */
  /* Spawn / lifecycle                                                       */
  /* ----------------------------------------------------------------------- */

  /** Activate this pooled enemy at (x,y) using `def`, scaling stats by time. */
  spawn(ctx: GameContext, def: EnemyDef, x: number, y: number): void {
    this.ctx = ctx;
    this.def = def;
    this.spawnGen++;

    // re-enable the physics body and reset transform.
    this.enableBody(true, x, y, true, true);
    this.setActive(true).setVisible(true);

    // appearance
    this.setTexture(TEXTURES.SPRITES, def.frame);
    if (def.tint !== undefined) this.setTint(def.tint);
    else this.clearTint();
    this.setScale(ENTITY_SCALE * def.scale);
    this.setAlpha(1);
    this.setAngle(0);
    this.setDepth(def.isBoss ? DEPTH.ENEMY + 1 : DEPTH.ENEMY);

    // size the circular body to the (scaled) sprite footprint.
    const r = (this.width / 2) * 0.7;
    this.setCircle(r, this.width / 2 - r, this.height / 2 - r);

    // time-scaled combat stats (× the run's curse-contract multipliers)
    const elapsed = ctx.run.elapsedMs;
    const curse = curseMults(ctx.run.curse);
    this.maxHp = def.baseHp * hpScale(elapsed) * curse.enemyHp;
    this.hp = this.maxHp;
    this.contactDamage = def.contactDamage * damageScale(elapsed) * curse.enemyDmg;
    this.speed = def.moveSpeed * speedScale(elapsed);

    // reset transient state
    this.flashLeft = 0;
    this.knockbackLeft = 0;
    this.clock = 0;
    this.wobblePhase = ctx.rng.frac() * Math.PI * 2;
    this.setVelocity(0, 0);

    // shadow (created once, reused)
    this.ensureShadow();
    if (this.shadow) {
      this.shadow.setVisible(true).setActive(true).setScale(def.scale);
      this.shadow.setPosition(x, y + this.displayHeight * 0.42);
    }

    // floating HP bar for bosses & elites only
    if (def.isBoss || def.isElite) this.ensureHpBar();
    else this.hideHpBar();
  }

  /** Disable physics + hide; returns the instance to the pool. */
  deactivate(): void {
    this.disableBody(true, true);
    this.setActive(false).setVisible(false);
    this.clearTint();
    this.setVelocity(0, 0);
    if (this.shadow) this.shadow.setVisible(false).setActive(false);
    this.hideHpBar();
  }

  /* ----------------------------------------------------------------------- */
  /* Per-frame steering                                                      */
  /* ----------------------------------------------------------------------- */

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;

    const dt = delta / 1000;
    this.clock += delta;

    const player = this.ctx.player;
    const dx = player.x - this.x;
    const dy = player.y - this.y;

    // Despawn if we wandered too far from the player (no death/drop).
    const distSq = dx * dx + dy * dy;
    if (distSq > DESPAWN_DIST_SQ) {
      this.deactivate();
      return;
    }

    // hit-flash countdown
    if (this.flashLeft > 0) {
      this.flashLeft -= delta;
      if (this.flashLeft <= 0) {
        if (this.def.tint !== undefined) this.setTint(this.def.tint);
        else this.clearTint();
      }
    }

    // Steering: while a knockback impulse is active we let the body coast.
    if (this.knockbackLeft > 0) {
      this.knockbackLeft -= delta;
    } else {
      const len = Math.sqrt(distSq) || 1;
      let nx = dx / len;
      let ny = dy / len;

      // wander-chase weaves with a perpendicular sine wobble.
      if (this.def.behavior === 'wander-chase') {
        const wob = Math.sin(this.clock * 0.004 + this.wobblePhase) * 0.5;
        // add the perpendicular vector (-ny, nx) * wob to the chase direction.
        // (capture originals first so the second line uses the un-mutated nx)
        const ox = nx;
        const oy = ny;
        nx = ox + -oy * wob;
        ny = oy + ox * wob;
        const l2 = Math.hypot(nx, ny) || 1;
        nx /= l2;
        ny /= l2;
      }

      this.setVelocity(nx * this.speed, ny * this.speed);

      // face the player (sheet sprites face right at frame default).
      this.setFlipX(dx < 0);
    }

    // keep the shadow planted beneath us.
    if (this.shadow && this.shadow.visible) {
      this.shadow.setPosition(this.x, this.y + this.displayHeight * 0.42);
    }

    // keep the floating HP bar above bosses/elites.
    if (this.hpBar && this.hpBar.visible) {
      const bob = Math.sin(this.clock * 0.005) * 1.5;
      this.hpBar.setPosition(this.x, this.y - this.displayHeight * 0.62 + bob);
    }
  }

  /* ----------------------------------------------------------------------- */
  /* Damage / death                                                          */
  /* ----------------------------------------------------------------------- */

  /**
   * Apply `amount` damage. `from` is the hit source position (knockback
   * direction); `knockback` is the impulse strength in px/s before resist.
   */
  takeDamage(amount: number, from?: { x: number; y: number }, knockback?: number): void {
    if (!this.active) return;

    this.hp -= amount;

    // white hit-flash
    this.setTint(COLORS.ENEMY_FLASH);
    this.flashLeft = 70;

    // tiny hit spark at the impact point
    this.emitHitSpark(from);

    // knockback impulse away from the source
    if (knockback && knockback > 0) {
      const sx = from ? from.x : this.ctx.player.x;
      const sy = from ? from.y : this.ctx.player.y;
      let ax = this.x - sx;
      let ay = this.y - sy;
      const l = Math.hypot(ax, ay) || 1;
      ax /= l;
      ay /= l;
      const force = knockback * (1 - this.def.knockbackResist);
      if (force > 0) {
        this.setVelocity(ax * force, ay * force);
        // coast under the impulse briefly, then resume chasing.
        this.knockbackLeft = Phaser.Math.Clamp(force * 0.18, 60, 180);
      }
    }

    if (this.hp <= 0) this.die();
    else this.updateHpBar();
  }

  /** Death: reward XP/gold/loot, emit fx, then return to the pool. */
  private die(): void {
    const ctx = this.ctx;
    const def = this.def;
    const x = this.x;
    const y = this.y;

    ctx.addKill();
    ctx.spawnXpGem(x, y, def.xp);

    if (ctx.rng.frac() < def.goldChance) ctx.spawnPickup(x, y, 'gold');
    // Rare support drops (offset so they don't stack on the xp gem).
    if (ctx.rng.frac() < PICKUP.HEALTH_DROP) ctx.spawnPickup(x + 14, y, 'health');
    else if (ctx.rng.frac() < PICKUP.MAGNET_DROP) ctx.spawnPickup(x + 14, y, 'magnet');
    // elites & bosses always cough up a treasure chest (+ a potion for elites).
    if (def.isElite || def.isBoss) ctx.spawnPickup(x, y, 'chest');
    if (def.isElite) ctx.spawnPickup(x - 18, y, 'health');

    this.emitDeathPoof(x, y, def.isBoss === true);

    if (def.isBoss) {
      // big, screen-filling death beat for the boss.
      ctx.shakeCamera(0.02, 600);
      this.flashScreen(x, y);
    }

    this.deactivate();
  }

  /* ----------------------------------------------------------------------- */
  /* FX helpers                                                              */
  /* ----------------------------------------------------------------------- */

  /** A small burst of sparks at the impact point (shared pooled emitter). */
  private emitHitSpark(from?: { x: number; y: number }): void {
    // bias the spark toward the side the hit came from.
    let px = this.x;
    let py = this.y;
    if (from) {
      const ax = this.x - from.x;
      const ay = this.y - from.y;
      const l = Math.hypot(ax, ay) || 1;
      px = this.x - (ax / l) * (this.displayWidth * 0.3);
      py = this.y - (ay / l) * (this.displayHeight * 0.3);
    }
    this.ctx.hitSparkAt(px, py);
  }

  /**
   * Death poof: a puff of dark dust + a few blood-tinted bits. Regular deaths
   * route through the shared pooled emitter; the (rare, ≤2 per run) boss death
   * keeps its own bigger one-shot emitter for a distinct look.
   */
  private emitDeathPoof(x: number, y: number, big: boolean): void {
    if (!big) {
      this.ctx.deathPoofAt(x, y);
      return;
    }
    const n = 26;
    const emitter = this.scene.add.particles(x, y, TEXTURES.PARTICLE, {
      lifespan: 600,
      speed: { min: 30, max: 220 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: [COLORS.BLOOD, COLORS.BLOOD_LIGHT, 0x2a1a22],
      quantity: n,
      blendMode: Phaser.BlendModes.NORMAL,
      emitting: false,
    });
    emitter.setDepth(DEPTH.FX);
    emitter.explode(n);
    this.scene.time.delayedCall(700, () => emitter.destroy());
  }

  /** Bright expanding ring + flash for boss death. */
  private flashScreen(x: number, y: number): void {
    const ring = this.scene.add.image(x, y, TEXTURES.RING);
    ring.setDepth(DEPTH.FX).setBlendMode(Phaser.BlendModes.ADD).setScale(1).setAlpha(1);
    ring.setTint(COLORS.GOLD_LIGHT);
    this.scene.tweens.add({
      targets: ring,
      scale: 10,
      alpha: 0,
      duration: 500,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
    // brief additive white pop at the corpse.
    const pop = this.scene.add.image(x, y, TEXTURES.PARTICLE);
    pop.setDepth(DEPTH.FX).setBlendMode(Phaser.BlendModes.ADD).setScale(6).setAlpha(0.9);
    this.scene.tweens.add({
      targets: pop,
      scale: 12,
      alpha: 0,
      duration: 350,
      ease: 'Quad.easeOut',
      onComplete: () => pop.destroy(),
    });
  }

  /* ----------------------------------------------------------------------- */
  /* Attached visuals (lazy-created, reused)                                 */
  /* ----------------------------------------------------------------------- */

  private ensureShadow(): void {
    if (this.shadow) return;
    this.shadow = this.scene.add.image(this.x, this.y, TEXTURES.SHADOW);
    this.shadow.setDepth(DEPTH.SHADOW).setAlpha(0.55);
  }

  private ensureHpBar(): void {
    if (!this.hpBar) {
      this.hpBarW = this.def.isBoss ? 64 : 36;
      const h = this.def.isBoss ? 6 : 4;
      const track = this.scene.add.rectangle(0, 0, this.hpBarW + 2, h + 2, COLORS.PANEL, 0.85);
      track.setStrokeStyle(1, 0x000000, 0.9);
      const fill = this.scene.add.rectangle(
        -this.hpBarW / 2,
        0,
        this.hpBarW,
        h,
        this.def.isBoss ? COLORS.BLOOD : COLORS.HP_BAR
      );
      fill.setOrigin(0, 0.5);
      this.hpBarFill = fill;
      this.hpBar = this.scene.add.container(this.x, this.y, [track, fill]);
      this.hpBar.setDepth(DEPTH.FX);
    }
    this.hpBar.setVisible(true).setActive(true);
    this.updateHpBar();
  }

  private updateHpBar(): void {
    if (!this.hpBar || !this.hpBarFill) return;
    const frac = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.hpBarFill.width = this.hpBarW * frac;
  }

  private hideHpBar(): void {
    if (this.hpBar) this.hpBar.setVisible(false).setActive(false);
  }

  /** Fully tear down attached visuals (called if the group destroys us). */
  destroy(fromScene?: boolean): void {
    this.shadow?.destroy();
    this.hpBar?.destroy();
    super.destroy(fromScene);
  }
}
