import Phaser from 'phaser';
import type {
  GameContext,
  IWeaponSystem,
  WeaponId,
  WeaponDef,
  OwnedWeaponView,
  EnemySprite,
} from '../types';
import { EVENTS } from '../types';
import { WEAPONS } from '../content/weapons';
import { TEXTURES, FRAMES } from '../config/assets';
import { COLORS, DEPTH, ENTITY_SCALE } from '../config/balance';
import { Projectile } from '../entities/Projectile';

/** Per-owned-weapon runtime state (timer, level, persistent visuals). */
interface WeaponState {
  id: WeaponId;
  def: WeaponDef;
  level: number;
  /** ms accumulated toward the next fire (cooldown-driven weapons) */
  timer: number;
  /** persistent aura disc (behavior === 'aura') */
  aura?: Phaser.GameObjects.Image;
  /** persistent orbit orbs (behavior === 'orbit') */
  orbs?: Phaser.GameObjects.Image[];
  /** current orbit phase angle (radians), advanced each frame */
  orbitPhase: number;
  /**
   * Per-orbit, per-enemy re-hit cooldowns (ms remaining). Keyed by enemy.
   * Orbit + aura tick continuously, so a given enemy must respect cooldownMs
   * between consecutive damage instances.
   */
  rehit: Map<EnemySprite, number>;
}

/**
 * Owns owned-weapon state, fires weapons on their cooldowns, manages the
 * persistent aura/orbit visuals, and routes projectile↔enemy overlap to the
 * Projectile.hit one-hit-per-enemy logic.
 *
 * Aura/whip/orbit deal damage directly via ctx.getEnemiesInRadius (NOT through
 * the projectile group); only knife/wand/axe spawn pooled Projectiles.
 */
export class WeaponSystem implements IWeaponSystem {
  private readonly ctx: GameContext;
  private readonly scene: Phaser.Scene;
  /** ordered map of owned weapons → runtime state */
  private readonly owned = new Map<WeaponId, WeaponState>();

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    this.scene = ctx.scene;

    // Projectile group ↔ enemy group overlap. Every pooled projectile routes
    // its damage through Projectile.hit (pierce-aware, one hit per enemy).
    this.scene.physics.add.overlap(
      ctx.projectiles,
      ctx.enemies,
      this.onProjectileHit,
      undefined,
      this
    );
  }

  /* -------------------------------------------------------------- */
  /* IWeaponSystem queries                                          */
  /* -------------------------------------------------------------- */

  hasWeapon(id: WeaponId): boolean {
    return this.owned.has(id);
  }

  getLevel(id: WeaponId): number {
    return this.owned.get(id)?.level ?? 0;
  }

  ownedCount(): number {
    return this.owned.size;
  }

  getOwned(): Array<{ id: WeaponId; level: number; def: WeaponDef }> {
    const out: Array<{ id: WeaponId; level: number; def: WeaponDef }> = [];
    this.owned.forEach((w) => out.push({ id: w.id, level: w.level, def: w.def }));
    return out;
  }

  /** Build the lightweight view list for the HUD / WEAPONS_CHANGED payload. */
  private getOwnedViews(): OwnedWeaponView[] {
    const out: OwnedWeaponView[] = [];
    this.owned.forEach((w) => {
      out.push({
        id: w.id,
        level: w.level,
        maxLevel: w.def.maxLevel,
        icon: w.def.icon,
        name: w.def.name,
      });
    });
    return out;
  }

  private emitChanged(): void {
    this.ctx.events.emit(EVENTS.WEAPONS_CHANGED, { owned: this.getOwnedViews() });
  }

  /* -------------------------------------------------------------- */
  /* Acquire / level                                                */
  /* -------------------------------------------------------------- */

  addWeapon(id: WeaponId): boolean {
    if (this.owned.has(id)) return false;
    const def = WEAPONS[id];
    if (!def) return false;

    const state: WeaponState = {
      id,
      def,
      level: 1,
      timer: 0,
      orbitPhase: 0,
      rehit: new Map(),
    };
    this.owned.set(id, state);

    // Persistent weapons spin up their visuals immediately.
    if (def.behavior === 'aura') this.createAura(state);
    else if (def.behavior === 'orbit') this.rebuildOrbs(state);

    this.emitChanged();
    return true;
  }

  levelUpWeapon(id: WeaponId): void {
    const state = this.owned.get(id);
    if (!state) return;
    if (state.level < state.def.maxLevel) state.level++;

    // Keep persistent visuals in sync with the new level (radius, orb count).
    if (state.def.behavior === 'aura') this.updateAuraVisual(state);
    else if (state.def.behavior === 'orbit') this.rebuildOrbs(state);

    this.emitChanged();
  }

  /* -------------------------------------------------------------- */
  /* Per-frame firing                                               */
  /* -------------------------------------------------------------- */

  update(_time: number, delta: number): void {
    const stats = this.ctx.stats;
    this.owned.forEach((w) => {
      switch (w.def.behavior) {
        case 'aura':
          this.updateAura(w, delta);
          break;
        case 'orbit':
          this.updateOrbit(w, delta);
          break;
        default: {
          // Cooldown-driven weapons (whip / wand / knife / axe).
          const i = w.level - 1;
          const cd = w.def.cooldownMs[i] * stats.cooldownMult;
          w.timer += delta;
          if (w.timer >= cd) {
            w.timer -= cd;
            this.fireCooldownWeapon(w);
          }
          break;
        }
      }
    });
  }

  /** Dispatch one cooldown-driven fire by behavior. */
  private fireCooldownWeapon(w: WeaponState): void {
    switch (w.def.behavior) {
      case 'projectile-facing':
        this.fireFacing(w);
        break;
      case 'projectile-nearest':
        this.fireNearest(w);
        break;
      case 'lobbed':
        this.fireLobbed(w);
        break;
      case 'whip':
        this.fireWhip(w);
        break;
      case 'spin':
        this.fireSpin(w);
        break;
      default:
        break;
    }
  }

  /* -------------------------------------------------------------- */
  /* Behavior: spin — periodic 360° cleave around the player        */
  /* -------------------------------------------------------------- */

  /**
   * A burst radial cleave: damages every enemy within `reach` of the player at
   * once (great when surrounded), with a whirling crescent + expanding shock
   * ring. Distinct from the directional whip and from the sustained aura.
   * For 'spin' weapons, `area` is the cleave RADIUS multiplier.
   */
  private fireSpin(w: WeaponState): void {
    const p = this.ctx.player;
    const reach = 95 * this.area(w);
    const dmg = this.dmg(w);
    const knock = this.knock(w);
    const tint = w.def.projectileTint ?? COLORS.BONE;

    const enemies = this.ctx.getEnemiesInRadius(p.x, p.y, reach);
    for (const e of enemies) {
      if (!e.active) continue;
      this.ctx.damageEnemy(e, dmg, { knockback: knock, crit: this.rollCrit() });
    }

    // whirling crescent
    const sStart = (reach / 30) * 0.8;
    const slash = this.scene.add
      .image(p.x, p.y, TEXTURES.SLASH)
      .setDepth(DEPTH.FX)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(tint)
      .setAlpha(0.95)
      .setScale(sStart);
    this.scene.tweens.add({
      targets: slash,
      rotation: Math.PI * 2,
      scaleX: sStart * 1.25,
      scaleY: sStart * 1.25,
      alpha: 0,
      duration: 280,
      ease: 'Quad.easeOut',
      onComplete: () => slash.destroy(),
    });

    // expanding shock ring marking the cleave footprint
    const ring = this.scene.add
      .image(p.x, p.y, TEXTURES.RING)
      .setDepth(DEPTH.FX)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(tint)
      .setAlpha(0.55)
      .setScale((reach / 20) * 0.4);
    this.scene.tweens.add({
      targets: ring,
      scaleX: reach / 20,
      scaleY: reach / 20,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /* -------------------------------------------------------------- */
  /* Effective-value helpers                                        */
  /* -------------------------------------------------------------- */

  private dmg(w: WeaponState): number {
    return w.def.damage[w.level - 1] * this.ctx.stats.might;
  }
  private count(w: WeaponState): number {
    return Math.max(1, w.def.amount[w.level - 1] + this.ctx.stats.amount);
  }
  private speed(w: WeaponState): number {
    return w.def.speed[w.level - 1] * this.ctx.stats.projectileSpeed;
  }
  private area(w: WeaponState): number {
    return w.def.area[w.level - 1] * this.ctx.stats.area;
  }
  private life(w: WeaponState): number {
    return w.def.durationMs[w.level - 1] * this.ctx.stats.duration;
  }
  private knock(w: WeaponState): number {
    return w.def.knockback[w.level - 1];
  }
  private pierceOf(w: WeaponState): number {
    return w.def.pierce[w.level - 1];
  }
  /** Roll a crit for a single hit using the player's crit stats. */
  private rollCrit(): boolean {
    return this.ctx.rng.frac() < this.ctx.stats.critChance;
  }

  /* -------------------------------------------------------------- */
  /* Projectile pool                                                */
  /* -------------------------------------------------------------- */

  /** Grab a dead Projectile from the pool, creating one if needed. */
  private getProjectile(): Projectile {
    let p = this.ctx.projectiles.getFirstDead(false) as Projectile | null;
    if (!p) {
      p = new Projectile(this.scene);
      this.ctx.projectiles.add(p, true);
    }
    return p;
  }

  /* -------------------------------------------------------------- */
  /* Behavior: projectile-facing (knife)                            */
  /* -------------------------------------------------------------- */

  private fireFacing(w: WeaponState): void {
    const p = this.ctx.player;
    const n = this.count(w);
    const spd = this.speed(w);
    const baseAngle = Math.atan2(p.facing.y, p.facing.x);
    // Fan the knives out slightly when firing more than one.
    const spread = n > 1 ? 0.22 : 0; // ~12.6° total per extra knife band
    const start = baseAngle - (spread * (n - 1)) / 2;

    for (let k = 0; k < n; k++) {
      const ang = n > 1 ? start + spread * k : baseAngle;
      const vx = Math.cos(ang) * spd;
      const vy = Math.sin(ang) * spd;
      const proj = this.getProjectile();
      proj.fire(this.ctx, {
        x: p.x,
        y: p.y,
        vx,
        vy,
        textureKey: TEXTURES.KNIFE,
        damage: this.dmg(w),
        pierce: this.pierceOf(w),
        life: this.life(w),
        knockback: this.knock(w),
        scale: ENTITY_SCALE * this.area(w),
        angle: ang,
        tint: w.def.projectileTint,
        crit: this.rollCrit(),
      });
    }
  }

  /* -------------------------------------------------------------- */
  /* Behavior: projectile-nearest (wand)                            */
  /* -------------------------------------------------------------- */

  private fireNearest(w: WeaponState): void {
    const p = this.ctx.player;
    const n = this.count(w);
    const spd = this.speed(w);

    // Aim each bolt at a distinct nearby enemy when possible; fall back to the
    // single nearest (or the facing direction if the arena is empty).
    const targets = this.pickNearestTargets(p.x, p.y, n);

    for (let k = 0; k < n; k++) {
      const target = targets[k] ?? targets[0];
      let ang: number;
      if (target) {
        ang = Math.atan2(target.y - p.y, target.x - p.x);
      } else {
        // no enemies — spray gently around the facing direction
        const base = Math.atan2(p.facing.y, p.facing.x);
        ang = base + (k - (n - 1) / 2) * 0.3;
      }
      const vx = Math.cos(ang) * spd;
      const vy = Math.sin(ang) * spd;
      const proj = this.getProjectile();
      proj.fire(this.ctx, {
        x: p.x,
        y: p.y,
        vx,
        vy,
        textureKey: TEXTURES.BOLT,
        damage: this.dmg(w),
        pierce: this.pierceOf(w),
        life: this.life(w),
        knockback: this.knock(w),
        scale: this.area(w),
        angle: ang,
        additive: true,
        tint: w.def.projectileTint,
        crit: this.rollCrit(),
      });
    }
  }

  /**
   * Pick up to `n` nearest distinct enemies. Uses ctx.getNearestEnemy as the
   * primary source; for additional targets it scans the radius and sorts.
   */
  private pickNearestTargets(x: number, y: number, n: number): EnemySprite[] {
    if (n <= 1) {
      const nearest = this.ctx.getNearestEnemy(x, y);
      return nearest ? [nearest] : [];
    }
    // Gather a generous pool and sort by distance, take the closest n.
    const pool = this.ctx.getEnemiesInRadius(x, y, 9999);
    pool.sort(
      (a, b) =>
        Phaser.Math.Distance.Squared(x, y, a.x, a.y) -
        Phaser.Math.Distance.Squared(x, y, b.x, b.y)
    );
    return pool.slice(0, n);
  }

  /* -------------------------------------------------------------- */
  /* Behavior: lobbed (axe)                                         */
  /* -------------------------------------------------------------- */

  private fireLobbed(w: WeaponState): void {
    const p = this.ctx.player;
    const n = this.count(w);
    const spd = this.speed(w);
    const life = this.life(w);
    // Convert flight time into a gravity that brings the arc back to a similar
    // height by the time it expires: peak then fall. Tuned for a satisfying lob.
    const grav = 900;

    for (let k = 0; k < n; k++) {
      // alternate left/right of the facing direction, with a strong upward toss
      const dir = p.facing.x >= 0 ? 1 : -1;
      const side = n > 1 ? (k % 2 === 0 ? 1 : -1) : dir;
      const spreadX = n > 1 ? 0.5 + (k >> 1) * 0.35 : 0.7;
      const vx = side * spd * spreadX;
      const vy = -spd * (0.9 + this.ctx.rng.frac() * 0.25); // strong initial toss up

      const proj = this.getProjectile();
      proj.fire(this.ctx, {
        x: p.x,
        y: p.y,
        vx,
        vy,
        textureKey: TEXTURES.SPRITES,
        frame: FRAMES.AXE,
        damage: this.dmg(w),
        pierce: this.pierceOf(w),
        life,
        knockback: this.knock(w),
        scale: ENTITY_SCALE * this.area(w),
        spin: side * 14, // fast spin, direction matches throw side
        gravity: grav,
        tint: w.def.projectileTint,
        crit: this.rollCrit(),
      });
    }
  }

  /* -------------------------------------------------------------- */
  /* Behavior: whip                                                 */
  /* -------------------------------------------------------------- */

  private fireWhip(w: WeaponState): void {
    const p = this.ctx.player;
    const n = this.count(w);
    const area = this.area(w);
    const dir = p.facing.x >= 0 ? 1 : -1;

    // Always slash the facing side; if amount >= 2 also the opposite side.
    this.slashSide(w, dir, area);
    if (n >= 2) this.slashSide(w, -dir, area);
  }

  /**
   * Spawn a transient SLASH sprite on one side and immediately damage every
   * enemy in the arc once. The slash crescent texture opens toward +x, so we
   * flip X for left-side slashes.
   */
  private slashSide(w: WeaponState, dir: number, area: number): void {
    const p = this.ctx.player;
    // SLASH texture is 60×44; reach scales with area. Offset the hit centre out.
    const reach = 70 * area;
    const cx = p.x + dir * reach * 0.55;
    const cy = p.y;
    const hitRadius = reach * 0.7;

    // Visual: short-lived additive crescent that tweens out.
    const slash = this.scene.add.image(cx, cy, TEXTURES.SLASH);
    slash.setDepth(DEPTH.FX);
    slash.setBlendMode(Phaser.BlendModes.ADD);
    slash.setTint(w.def.projectileTint ?? COLORS.GOLD_LIGHT);
    // Mirror the left-side slash with a SIGNED scaleX (no flipX). Start and end
    // share the same sign as `dir`, so the tween never crosses zero — that zero
    // crossing (plus flipX) is what made the left slash collapse and look wrong.
    slash.setScale(0.6 * area * dir, 0.9 * area);
    slash.setAlpha(0.95);
    this.scene.tweens.add({
      targets: slash,
      scaleX: 1.5 * area * dir,
      scaleY: 1.35 * area,
      alpha: 0,
      duration: Math.max(80, this.life(w)),
      ease: 'Quad.easeOut',
      onComplete: () => slash.destroy(),
    });

    // Damage: every enemy in the arc, once, with knockback away from the player.
    const enemies = this.ctx.getEnemiesInRadius(cx, cy, hitRadius);
    const dmg = this.dmg(w);
    const knock = this.knock(w);
    for (const e of enemies) {
      if (!e.active) continue;
      this.ctx.damageEnemy(e, dmg, { knockback: knock, crit: this.rollCrit() });
    }
  }

  /* -------------------------------------------------------------- */
  /* Behavior: aura (sanctuary) — persistent                        */
  /* -------------------------------------------------------------- */

  private createAura(state: WeaponState): void {
    const aura = this.scene.add.image(this.ctx.player.x, this.ctx.player.y, TEXTURES.AURA);
    aura.setDepth(DEPTH.FX - 1); // under projectiles/poptext, over the player feet
    aura.setBlendMode(Phaser.BlendModes.ADD);
    aura.setTint(state.def.projectileTint ?? COLORS.GOLD_LIGHT);
    aura.setAlpha(0.32);
    state.aura = aura;
    this.updateAuraVisual(state);
  }

  /** Aura radius in world px for the current level. AURA texture is 160px (r=80). */
  private auraRadius(state: WeaponState): number {
    return 95 * this.area(state);
  }

  private updateAuraVisual(state: WeaponState): void {
    if (!state.aura) return;
    const r = this.auraRadius(state);
    // texture native radius is 80px → scale so the visual matches the hit radius
    state.aura.setScale(r / 80);
  }

  private updateAura(state: WeaponState, delta: number): void {
    const p = this.ctx.player;
    const aura = state.aura;
    if (aura) {
      aura.setPosition(p.x, p.y);
      // gentle alpha pulse for life
      const t = this.scene.time.now / 1000;
      aura.setAlpha(0.26 + Math.sin(t * 2.2) * 0.07);
    }

    // Tick down per-enemy re-hit cooldowns.
    this.decayRehit(state, delta);

    // Damage tick on cooldown.
    const i = state.level - 1;
    const tickMs = state.def.cooldownMs[i] * this.ctx.stats.cooldownMult;
    state.timer += delta;
    if (state.timer < tickMs) return;
    state.timer -= tickMs;

    const r = this.auraRadius(state);
    const enemies = this.ctx.getEnemiesInRadius(p.x, p.y, r);
    const dmg = state.def.damage[i] * this.ctx.stats.might;
    const knock = this.knock(state);
    for (const e of enemies) {
      if (!e.active) continue;
      this.ctx.damageEnemy(e, dmg, { knockback: knock, crit: this.rollCrit() });
    }
  }

  /* -------------------------------------------------------------- */
  /* Behavior: orbit (spirit orbs) — persistent                     */
  /* -------------------------------------------------------------- */

  /** (Re)build the orbit orb sprites to match the current orb count. */
  private rebuildOrbs(state: WeaponState): void {
    if (!state.orbs) state.orbs = [];
    const want = Math.max(1, state.def.amount[state.level - 1] + this.ctx.stats.amount);

    // add missing orbs
    while (state.orbs.length < want) {
      const orb = this.scene.add.image(this.ctx.player.x, this.ctx.player.y, TEXTURES.ORB);
      orb.setDepth(DEPTH.PROJECTILE);
      orb.setBlendMode(Phaser.BlendModes.ADD);
      if (state.def.projectileTint !== undefined) orb.setTint(state.def.projectileTint);
      state.orbs.push(orb);
    }
    // remove surplus orbs
    while (state.orbs.length > want) {
      const orb = state.orbs.pop();
      orb?.destroy();
    }

    // size scales with area
    const scale = ENTITY_SCALE * 0.9 * this.area(state);
    for (const orb of state.orbs) orb.setScale(scale);
  }

  private orbitRadius(state: WeaponState): number {
    return 64 * this.area(state);
  }

  private updateOrbit(state: WeaponState, delta: number): void {
    const orbs = state.orbs;
    if (!orbs || orbs.length === 0) return;
    const p = this.ctx.player;
    const dt = delta / 1000;

    // advance the orbit phase (speed is deg/s in the data)
    const i = state.level - 1;
    const angularSpeed = (state.def.speed[i] * Math.PI) / 180; // rad/s
    state.orbitPhase += angularSpeed * dt;
    if (state.orbitPhase > Math.PI * 2) state.orbitPhase -= Math.PI * 2;

    const radius = this.orbitRadius(state);
    const n = orbs.length;
    const hitR = 20 * this.area(state); // per-orb contact radius

    this.decayRehit(state, delta);

    const dmg = state.def.damage[i] * this.ctx.stats.might;
    const knock = this.knock(state);
    const rehitMs = state.def.cooldownMs[i] * this.ctx.stats.cooldownMult;

    for (let k = 0; k < n; k++) {
      const ang = state.orbitPhase + (Math.PI * 2 * k) / n;
      const ox = p.x + Math.cos(ang) * radius;
      const oy = p.y + Math.sin(ang) * radius;
      const orb = orbs[k];
      orb.setPosition(ox, oy);
      orb.setRotation(ang);

      // contact damage with a per-enemy re-hit cooldown
      const near = this.ctx.getEnemiesInRadius(ox, oy, hitR);
      for (const e of near) {
        if (!e.active) continue;
        if ((state.rehit.get(e) ?? 0) > 0) continue;
        this.ctx.damageEnemy(e, dmg, { knockback: knock, crit: this.rollCrit() });
        state.rehit.set(e, rehitMs);
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* Shared: per-enemy re-hit cooldown decay (aura/orbit)           */
  /* -------------------------------------------------------------- */

  private decayRehit(state: WeaponState, delta: number): void {
    if (state.rehit.size === 0) return;
    state.rehit.forEach((ms, enemy) => {
      const left = ms - delta;
      // drop expired entries and dead enemies to keep the map small
      if (left <= 0 || !enemy.active) state.rehit.delete(enemy);
      else state.rehit.set(enemy, left);
    });
  }

  /* -------------------------------------------------------------- */
  /* Overlap callback (projectile ↔ enemy)                          */
  /* -------------------------------------------------------------- */

  private onProjectileHit: Phaser.Types.Physics.Arcade.ArcadePhysicsCallback = (
    projObj,
    enemyObj
  ) => {
    const proj = projObj as Projectile;
    const enemy = enemyObj as EnemySprite;
    if (!proj.active || !enemy.active) return;
    proj.hit(enemy);
  };
}
