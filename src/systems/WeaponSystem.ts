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
import { Sound } from '../audio/Sound';

/**
 * One orbit re-hit cooldown entry. Enemies are pooled, so the sprite reference
 * alone can't identify "the same enemy" — a dead instance may be recycled as a
 * brand-new enemy within the same frame (weapon update runs before the
 * spawner). `gen` snapshots enemy.spawnGen at hit time; a mismatch means the
 * instance was recycled and the cooldown no longer applies.
 */
interface RehitEntry {
  /** ms remaining until this enemy can be hit by this weapon again */
  left: number;
  /** enemy.spawnGen captured when the cooldown was set */
  gen: number;
}

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
   * Per-enemy re-hit cooldowns for orbit contact damage. Orbits tick
   * continuously, so a given enemy must respect cooldownMs between
   * consecutive damage instances. (Aura doesn't use this — it damages
   * everything in radius on its own tick timer.)
   */
  rehit: Map<EnemySprite, RehitEntry>;
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
    // One (quiet, rate-limited) sound per volley — never per projectile, or a
    // high-amount build turns into machine-gun noise.
    switch (w.def.behavior) {
      case 'projectile-facing':
        Sound.play('shoot');
        this.fireFacing(w);
        break;
      case 'projectile-nearest':
        Sound.play('shoot');
        this.fireNearest(w);
        break;
      case 'lobbed':
        Sound.play('lob');
        this.fireLobbed(w);
        break;
      case 'whip':
        Sound.play('whoosh');
        this.fireWhip(w);
        break;
      case 'spin':
        Sound.play('spin');
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
      this.ctx.damageEnemy(e, dmg, { knockback: knock, crit: this.rollCrit(), sourceId: w.id });
    }

    // Whirling blades: 3 crescents held out at orbit radius and spun together
    // as one group, so they sweep AROUND the player like a cyclone — a single
    // crescent spinning in place (the old version) just twirls on its own
    // axis and reads as a boomerang, not a circular slash.
    const bladeCount = 3;
    const orbitR = reach * 0.5;
    const bladeScale = (reach / 42) * 0.85;
    const cyclone = this.scene.add.container(p.x, p.y).setDepth(DEPTH.FX).setAlpha(0.95);
    for (let i = 0; i < bladeCount; i++) {
      const a = (Math.PI * 2 * i) / bladeCount;
      const blade = this.scene.add
        .image(Math.cos(a) * orbitR, Math.sin(a) * orbitR, TEXTURES.SLASH)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(tint)
        .setScale(bladeScale)
        .setRotation(a + Math.PI / 2); // tangential facing, like a sweeping sickle
      cyclone.add(blade);
    }
    this.scene.tweens.add({
      targets: cyclone,
      rotation: Math.PI * 2,
      scaleX: 1.2,
      scaleY: 1.2,
      alpha: 0,
      duration: 280,
      ease: 'Quad.easeOut',
      onComplete: () => cyclone.destroy(),
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
    return w.def.durationMs[w.level - 1];
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
    // Fan the shots out when firing more than one — unless the weapon opts
    // into a spread of 0 (spear), in which case they stay dead-ahead and
    // instead line up side-by-side (see `perp`/`lineGap` below) so a multi-
    // shot volley reads as one focused thrust rather than a spray.
    const spread = w.def.volleySpreadRad ?? (n > 1 ? 0.22 : 0);
    const start = baseAngle - (spread * (n - 1)) / 2;
    const tightVolley = spread === 0 && n > 1;
    const perpX = -Math.sin(baseAngle);
    const perpY = Math.cos(baseAngle);
    const lineGap = 16;
    const lineStart = -(lineGap * (n - 1)) / 2;

    for (let k = 0; k < n; k++) {
      const ang = tightVolley ? baseAngle : start + spread * k;
      const vx = Math.cos(ang) * spd;
      const vy = Math.sin(ang) * spd;
      const off = tightVolley ? lineStart + lineGap * k : 0;
      const proj = this.getProjectile();
      proj.fire(this.ctx, {
        x: p.x + perpX * off,
        y: p.y + perpY * off,
        vx,
        vy,
        textureKey: w.def.projectileTexture ?? TEXTURES.KNIFE,
        damage: this.dmg(w),
        pierce: this.pierceOf(w),
        life: this.life(w),
        knockback: this.knock(w),
        scale: ENTITY_SCALE * this.area(w),
        angle: ang,
        tint: w.def.projectileTint,
        crit: this.rollCrit(),
        sourceId: w.id,
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
        sourceId: w.id,
      });
    }
  }

  /** scratch buffers for pickNearestTargets — reused across fires so a
   *  multi-shot weapon doesn't allocate + sort the whole enemy list per shot.
   *  The returned array is only valid until the next call. */
  private readonly nearScratch: EnemySprite[] = [];
  private readonly nearDistSq: number[] = [];

  /**
   * Pick up to `n` nearest distinct enemies in a single pass over the enemy
   * pool (insertion into a tiny sorted top-n buffer; n is the projectile
   * count, so a handful at most — no full sort, no per-fire allocation).
   */
  private pickNearestTargets(x: number, y: number, n: number): EnemySprite[] {
    if (n <= 1) {
      const nearest = this.ctx.getNearestEnemy(x, y);
      return nearest ? [nearest] : [];
    }
    const out = this.nearScratch;
    const d2s = this.nearDistSq;
    out.length = 0;
    d2s.length = 0;

    const children = this.ctx.enemies.getChildren();
    for (let i = 0; i < children.length; i++) {
      const e = children[i] as EnemySprite;
      if (!e.active) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      // full and not closer than the current worst → skip (the common case)
      if (out.length === n && d2 >= d2s[n - 1]) continue;
      // insert, shifting worse entries toward the tail
      let j = out.length < n ? out.length : n - 1;
      while (j > 0 && d2s[j - 1] > d2) {
        out[j] = out[j - 1];
        d2s[j] = d2s[j - 1];
        j--;
      }
      out[j] = e;
      d2s[j] = d2;
    }
    return out;
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
        sourceId: w.id,
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
   * Flash a transient horizontal whip crack on one side and immediately damage
   * every enemy in a LONG, FLAT forward box once. The thin cord snaps straight
   * out along the facing side and flashes away — an INSTANT lash, no arc —
   * punctuated by a small tip crack. `dir` is +1 (right) or -1 (left); a signed
   * scaleX mirrors it to the left, keeping the cord's base on the player.
   */
  private slashSide(w: WeaponState, dir: number, area: number): void {
    const p = this.ctx.player;
    // Hit box geometry (all scale with area). reach is the base forward unit;
    // the box is a long, flat swath: `frontLen` deep out front, `backLen`
    // behind (point-blank forgiveness), and `halfH` tall on each side. Longer
    // and flatter than a slash so it reads as a lash (cf. the LASH texture).
    const reach = 85 * area;
    const frontLen = reach * 1.7;
    const backLen = reach * 0.15;
    const halfH = reach * 0.4;

    // ---- Visual: an INSTANT horizontal whip crack — no arc. The thin cord snaps
    // straight out along the facing side and flashes away. Origin (0, 0.5) pins
    // the cord's base (handle end) to the player; a signed scaleX (= dir) mirrors
    // it left without moving the base (the sign is fixed, so the snap-out tween
    // never crosses zero). Bone-white so it reads as a bright lash, not a flame.
    const lenScale = frontLen / 220; // LASH texture is 220px long
    const thick = 0.7 + area * 0.35; // thin cord, a touch thicker at high area
    const tint = w.def.projectileTint ?? COLORS.BONE;
    const dur = Math.max(110, this.life(w));

    const cord = this.scene.add
      .image(p.x, p.y, TEXTURES.LASH)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.FX)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(tint)
      .setScale(dir * lenScale * 0.7, thick)
      .setAlpha(1);
    // Snap straight out to full length (fast), then hold bright and fade.
    this.scene.tweens.add({
      targets: cord,
      scaleX: dir * lenScale,
      duration: dur * 0.35,
      ease: 'Quad.easeOut',
    });
    this.scene.tweens.add({
      targets: cord,
      alpha: 0,
      delay: dur * 0.3,
      duration: dur * 0.7,
      ease: 'Quad.easeIn',
      onComplete: () => cord.destroy(),
    });

    // Tip crack flash: a small bright pop at the far end of the lash.
    const flash = this.scene.add
      .image(p.x + dir * frontLen * 0.92, p.y, TEXTURES.PARTICLE)
      .setDepth(DEPTH.FX)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(tint)
      .setScale(0.25 * area)
      .setAlpha(0);
    this.scene.tweens.add({
      targets: flash,
      alpha: { from: 0.9, to: 0 },
      scale: 1.3 * area,
      delay: dur * 0.15,
      duration: dur * 0.55,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });

    // Damage: broad-phase a bounding circle over the box, then reject anything
    // outside it. Knockback is away from the player (damageEnemy's default
    // origin), independent of the box shape.
    const boxCx = p.x + (dir * (frontLen - backLen)) / 2;
    const boxHalfW = (frontLen + backLen) / 2;
    const queryR = Math.hypot(boxHalfW, halfH);
    const enemies = this.ctx.getEnemiesInRadius(boxCx, p.y, queryR);
    const dmg = this.dmg(w);
    const knock = this.knock(w);
    for (const e of enemies) {
      if (!e.active) continue;
      const forward = (e.x - p.x) * dir; // signed distance along the lash
      if (forward < -backLen || forward > frontLen) continue;
      if (Math.abs(e.y - p.y) > halfH) continue;
      this.ctx.damageEnemy(e, dmg, { knockback: knock, crit: this.rollCrit(), sourceId: w.id });
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
    const slowMult = state.def.auraSlowMult;
    for (const e of enemies) {
      if (!e.active) continue;
      this.ctx.damageEnemy(e, dmg, {
        knockback: knock,
        crit: this.rollCrit(),
        sourceId: state.id,
      });
      // Re-applied every tick, so standing in the cloud keeps the slow live;
      // the duration outlasts the tick interval so it doesn't flicker between
      // ticks (e.g. miasma — sanctuary has no auraSlowMult and repels instead).
      if (slowMult !== undefined) e.applySlow(slowMult, tickMs + 100);
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
        const entry = state.rehit.get(e);
        if (entry && entry.gen === e.spawnGen) continue; // still cooling down
        this.ctx.damageEnemy(e, dmg, {
          knockback: knock,
          crit: this.rollCrit(),
          sourceId: state.id,
        });
        state.rehit.set(e, { left: rehitMs, gen: e.spawnGen });
      }
    }
  }

  /* -------------------------------------------------------------- */
  /* Shared: per-enemy re-hit cooldown decay (aura/orbit)           */
  /* -------------------------------------------------------------- */

  private decayRehit(state: WeaponState, delta: number): void {
    if (state.rehit.size === 0) return;
    state.rehit.forEach((entry, enemy) => {
      entry.left -= delta;
      // Drop expired entries, dead enemies, and entries whose pooled instance
      // has been recycled as a different enemy (spawnGen mismatch) — otherwise
      // the newcomer would inherit the previous occupant's cooldown.
      if (entry.left <= 0 || !enemy.active || enemy.spawnGen !== entry.gen) {
        state.rehit.delete(enemy);
      }
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
