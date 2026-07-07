import Phaser from 'phaser';
import type { GameContext, EnemySprite } from '../types';
import { TEXTURES } from '../config/assets';
import { DEPTH } from '../config/balance';

/**
 * Options describing a single fired projectile. Built by WeaponSystem per shot.
 */
export interface ProjectileOpts {
  /** spawn position */
  x: number;
  y: number;
  /** initial velocity (px/s) */
  vx: number;
  vy: number;
  /** texture key (TEXTURES.KNIFE / TEXTURES.BOLT / TEXTURES.SPRITES for the axe) */
  textureKey: string;
  /** frame index when the texture is the dungeon sheet; omit for generated textures */
  frame?: number;
  /** base damage already multiplied by might (crit is applied in damageEnemy) */
  damage: number;
  /** how many enemies the shot may pass through (0 = single hit) */
  pierce: number;
  /** lifetime in ms before auto-deactivation */
  life: number;
  /** knockback impulse (px/s) forwarded to damageEnemy */
  knockback: number;
  /** display scale (sheet sprites already include ENTITY_SCALE in this value) */
  scale: number;
  /** rotation in radians; defaults to the velocity heading when omitted */
  angle?: number;
  /** if set, the sprite spins at this rate (rad/s) overriding fixed rotation */
  spin?: number;
  /** additive blend mode for glowy bolts/sparks */
  additive?: boolean;
  /** optional tint (0xRRGGBB) applied to the sprite, for per-weapon colours */
  tint?: number;
  /** pre-rolled crit flag forwarded to damageEnemy (undefined → rolled there) */
  crit?: boolean;
  /** owning weapon id, forwarded to damageEnemy for the per-weapon damage stats */
  sourceId?: string;
  /**
   * Lobbed (axe) arc parameters. When present the projectile fakes gravity by
   * applying a downward acceleration to its velocity each frame so it arcs up
   * then falls, while spinning. Travels horizontally via vx the whole time.
   */
  gravity?: number;
  /**
   * Boomerang return acceleration (px/s²). When present the projectile is
   * continuously accelerated toward the player's LIVE position, so it flies
   * out, turns around, and homes back. The moment it starts closing in again
   * its hit set is cleared (each enemy can be struck once per pass), and it
   * despawns on being "caught" (returning within hand reach).
   */
  returnAccel?: number;
}

/**
 * A pooled physics sprite used by every projectile-style weapon (knife, wand,
 * axe). Aura/whip/orbit do NOT use this — they query enemies directly.
 *
 * Pooling: WeaponSystem grabs a dead instance from `ctx.projectiles` (or makes
 * one) and calls `fire`. The sprite deactivates itself on lifetime expiry or
 * once its pierce budget is exhausted.
 */
export class Projectile extends Phaser.Physics.Arcade.Sprite {
  /** set on every fire() so hit() can reach the shared helpers */
  private ctx!: GameContext;
  /** remaining lifetime in ms; counted down in preUpdate */
  private life = 0;
  /** remaining pass-throughs; when it drops below zero the shot dies */
  private pierce = 0;
  private damage = 0;
  private knockback = 0;
  private crit: boolean | undefined;
  private sourceId: string | undefined;
  /** spin rate in rad/s (0 = none) */
  private spin = 0;
  /** fake-gravity acceleration for lobbed shots (0 = straight flight) */
  private grav = 0;
  /** boomerang: homing-return acceleration toward the player (0 = none) */
  private retAccel = 0;
  /** boomerang: still on the outbound leg (hit set clears when this flips) */
  private outbound = false;
  /** boomerang: squared player distance last frame (turn-around detection) */
  private prevDistSq = 0;
  /**
   * Enemies already damaged by THIS shot. Enforces one hit per enemy so a
   * piercing shot cannot tick the same target repeatedly. Reset on every fire.
   */
  private readonly hitSet = new Set<EnemySprite>();

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEXTURES.KNIFE, 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(DEPTH.PROJECTILE);
    this.deactivate();
  }

  /**
   * Activate + launch this projectile. Called by WeaponSystem after pulling the
   * instance from the pool.
   */
  fire(ctx: GameContext, opts: ProjectileOpts): void {
    this.ctx = ctx;

    // texture / frame
    if (opts.frame !== undefined) this.setTexture(opts.textureKey, opts.frame);
    else this.setTexture(opts.textureKey);

    // re-enable the body + visibility at the spawn point
    this.enableBody(true, opts.x, opts.y, true, true);
    this.setActive(true).setVisible(true);
    this.setPosition(opts.x, opts.y);

    this.setScale(opts.scale);
    this.setBlendMode(opts.additive ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    this.setDepth(DEPTH.PROJECTILE);
    if (opts.tint !== undefined) this.setTint(opts.tint);
    else this.clearTint();
    this.setAlpha(1);

    // motion
    this.setVelocity(opts.vx, opts.vy);
    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setAllowGravity(false); // we fake gravity manually for lobbed shots
    this.grav = opts.gravity ?? 0;
    this.retAccel = opts.returnAccel ?? 0;
    this.outbound = this.retAccel > 0;
    this.prevDistSq = 0;

    // orientation: explicit angle, else face the direction of travel
    this.spin = opts.spin ?? 0;
    if (this.spin === 0) {
      const rot = opts.angle ?? Math.atan2(opts.vy, opts.vx);
      this.setRotation(rot);
    }

    // combat state
    this.damage = opts.damage;
    this.pierce = opts.pierce;
    this.knockback = opts.knockback;
    this.crit = opts.crit;
    this.sourceId = opts.sourceId;
    this.life = opts.life;
    this.hitSet.clear();
  }

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active) return;

    const dt = delta / 1000;

    // fake gravity for lobbed (axe) shots → arcs up then accelerates down.
    if (this.grav !== 0) {
      const body = this.body as Phaser.Physics.Arcade.Body;
      body.velocity.y += this.grav * dt;
    }

    // visual spin (axe / any spinning shot)
    if (this.spin !== 0) this.rotation += this.spin * dt;

    // boomerang: home back toward the player's live position.
    if (this.retAccel > 0) {
      const pl = this.ctx.player;
      const dx = pl.x - this.x;
      const dy = pl.y - this.y;
      const dist = Math.hypot(dx, dy) || 1;
      const body = this.body as Phaser.Physics.Arcade.Body;
      body.velocity.x += (dx / dist) * this.retAccel * dt;
      body.velocity.y += (dy / dist) * this.retAccel * dt;

      const distSq = dist * dist;
      // Turn-around: the first frame the distance starts shrinking, open the
      // return pass — every enemy may be hit once more on the way back.
      if (this.outbound && this.prevDistSq > 0 && distSq < this.prevDistSq) {
        this.outbound = false;
        this.hitSet.clear();
      }
      this.prevDistSq = distSq;
      // Caught: returned to hand reach.
      if (!this.outbound && dist < 30) {
        this.deactivate();
        return;
      }
    }

    // lifetime countdown
    this.life -= delta;
    if (this.life <= 0) this.deactivate();
  }

  /**
   * Apply this projectile's damage to one enemy. Called from
   * WeaponSystem.onProjectileHit on physics overlap. Guards against double-hits
   * (pierce) and self-deactivates once the pierce budget runs out.
   */
  hit(enemy: EnemySprite): void {
    if (!this.active) return;
    if (this.hitSet.has(enemy)) return;
    this.hitSet.add(enemy);

    this.ctx.damageEnemy(enemy, this.damage, {
      knockback: this.knockback,
      crit: this.crit,
      sourceId: this.sourceId,
    });

    this.pierce--;
    if (this.pierce < 0) this.deactivate();
  }

  /** Return to the pool: stop physics + hide. */
  deactivate(): void {
    if (this.body) this.disableBody(true, true);
    this.setActive(false).setVisible(false);
    this.setVelocity(0, 0);
  }
}
