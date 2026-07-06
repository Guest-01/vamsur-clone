/**
 * Pickup — a pooled floor collectible (XP gem, health potion, gold coin, magnet
 * pulse, or treasure chest). One class covers every type; `spawn()` reconfigures
 * the sprite for its type and `collect()` routes the effect through the
 * GameContext. Instances are pooled by the GameScene (plain Arcade group) and
 * recycled via `deactivate()`.
 */
import Phaser from 'phaser';
import type { GameContext, PickupLike, PickupType } from '../types';
import { TEXTURES, FRAMES } from '../config/assets';
import { DEPTH, COLORS, GEM_TIERS, PICKUP, ENTITY_SCALE } from '../config/balance';

export class Pickup extends Phaser.Physics.Arcade.Sprite implements PickupLike {
  /** the kind of pickup this currently is (set each spawn) */
  pickupType: PickupType = 'xp';
  /** payload value (xp amount, etc.) interpreted per type */
  value = 0;

  private ctx!: GameContext;
  /** true once collect() has fired, to guard against double-collection */
  private collected = false;
  /** true while the magnet has locked on (so we keep homing once started) */
  private homing = false;
  /** scalar homing speed (ramps up); velocity is aimed straight at the player */
  private homeSpeed = 0;
  /** small sparkle emitter for gems (created lazily, reused) */
  private sparkle?: Phaser.GameObjects.Particles.ParticleEmitter;
  /** idle bob tween handle so we can stop it on deactivate */
  private bobTween?: Phaser.Tweens.Tween;
  /** phase offset so a field of gems doesn't bob in lockstep */
  private bobBase = 0;

  constructor(scene: Phaser.Scene) {
    super(scene, 0, 0, TEXTURES.GEM_S, 0);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(DEPTH.PICKUP);
    this.deactivate();
  }

  /* ----------------------------------------------------------------- */
  /* Spawn / reconfigure                                               */
  /* ----------------------------------------------------------------- */

  /**
   * Activate this pickup as `type` at (x,y) carrying `value`. Picks the right
   * texture/frame/scale, plays a little spawn pop, then a gentle idle bob.
   * Gems also get a soft sparkle emitter for juice.
   */
  spawn(ctx: GameContext, type: PickupType, x: number, y: number, value: number): void {
    this.ctx = ctx;
    this.pickupType = type;
    this.value = value;
    this.collected = false;
    this.homing = false;
    this.homeSpeed = 0;

    // Kill any tweens left over from a previous life in the pool (spawn-pop /
    // bob) so a recycled instance starts from a clean slate.
    this.scene.tweens.killTweensOf(this);

    this.setActive(true).setVisible(true);
    this.setPosition(x, y);
    this.clearTint();
    this.setAlpha(1);
    this.setRotation(0);
    this.setBlendMode(Phaser.BlendModes.NORMAL);

    // Re-enable the body and stop any leftover motion from the pool.
    if (this.body) {
      this.enableBody(true, x, y, true, true);
      this.setVelocity(0, 0);
    }

    this.configureForType(type, value);

    // record current y as the bob anchor
    this.bobBase = this.y;

    // --- spawn pop: scale up from 0 with a tiny upward hop ---
    const targetScale = this.scaleX; // configureForType set the resting scale
    this.setScale(targetScale * 0.2);
    this.scene.tweens.add({
      targets: this,
      scaleX: targetScale,
      scaleY: targetScale,
      duration: 220,
      ease: 'Back.Out',
    });

    this.startBob(targetScale);

    if (type === 'xp') this.startSparkle();
    else this.stopSparkle();
  }

  /** Set texture/frame/scale/tint for a given pickup type. */
  private configureForType(type: PickupType, value: number): void {
    switch (type) {
      case 'xp': {
        // Choose gem size tier by xp value.
        let key: string = TEXTURES.GEM_S;
        if (value >= GEM_TIERS.LARGE_AT) key = TEXTURES.GEM_L;
        else if (value >= GEM_TIERS.MED_AT) key = TEXTURES.GEM_M;
        this.setTexture(key, 0);
        this.setScale(1);
        this.setCircleBody(7);
        break;
      }
      case 'health':
        this.setTexture(TEXTURES.SPRITES, FRAMES.POTION_RED);
        this.setScale(ENTITY_SCALE * 0.8);
        this.setCircleBody(6);
        break;
      case 'gold':
        // generated 48px coin icon; scale down to gem-ish pickup size
        this.setTexture(TEXTURES.ICON_COIN);
        this.setScale(0.5);
        this.setCircleBody(18);
        break;
      case 'magnet':
        this.setTexture(TEXTURES.RING, 0);
        this.setTint(COLORS.GOLD_LIGHT);
        this.setScale(0.8);
        this.setBlendMode(Phaser.BlendModes.ADD);
        this.setCircleBody(16);
        break;
      case 'chest':
        this.setTexture(TEXTURES.SPRITES, FRAMES.CHEST);
        this.setScale(ENTITY_SCALE);
        this.setCircleBody(7);
        break;
    }
  }

  /**
   * Give the sprite a centred circular physics body. `radius` is in source
   * (unscaled) pixels; the offset centres it on the frame.
   */
  private setCircleBody(radius: number): void {
    if (!this.body) return;
    const w = this.width;
    const h = this.height;
    this.setCircle(radius, w / 2 - radius, h / 2 - radius);
  }

  /* ----------------------------------------------------------------- */
  /* Idle juice                                                        */
  /* ----------------------------------------------------------------- */

  private startBob(_baseScale: number): void {
    this.bobTween?.stop();
    // Heavier pickups bob a touch slower / lower; gems flutter quickly.
    const amount = this.pickupType === 'xp' ? 3 : 4;
    const dur = this.pickupType === 'xp' ? 700 : 900;
    this.bobTween = this.scene.tweens.add({
      targets: this,
      y: this.bobBase - amount,
      duration: dur,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
      delay: this.ctx.rng.between(0, 300),
    });
  }

  private startSparkle(): void {
    if (this.sparkle) {
      this.sparkle.startFollow(this);
      this.sparkle.start();
      return;
    }
    this.sparkle = this.scene.add.particles(0, 0, TEXTURES.SPARK, {
      lifespan: 600,
      speed: { min: 2, max: 10 },
      scale: { start: 0.5, end: 0 },
      alpha: { start: 0.9, end: 0 },
      frequency: 350,
      quantity: 1,
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    });
    this.sparkle.setDepth(DEPTH.PICKUP);
    this.sparkle.startFollow(this);
  }

  private stopSparkle(): void {
    if (this.sparkle) {
      this.sparkle.stop();
      this.sparkle.stopFollow();
    }
  }

  /* ----------------------------------------------------------------- */
  /* Per-frame magnet + auto-collect                                   */
  /* ----------------------------------------------------------------- */

  preUpdate(time: number, delta: number): void {
    super.preUpdate(time, delta);
    if (!this.active || this.collected) return;

    const player = this.ctx.player;
    if (!player || !player.active) return;

    const dx = player.x - this.x;
    const dy = player.y - this.y;
    const dist = Math.hypot(dx, dy);

    // Auto-collect when overlapping the player closely (independent of magnet).
    if (dist <= PICKUP.GRAB_RADIUS) {
      this.collect();
      return;
    }

    // Magnet: gems/coins/health get pulled in once inside the magnet radius.
    // The chest is a manual pickup (it triggers level-ups), so it doesn't home.
    const magnetRange = this.magnetRange();
    if (this.homing || dist <= magnetRange) {
      this.homing = true;
      // Pause the idle bob while flying so the motion reads cleanly.
      this.bobTween?.stop();

      const inv = dist > 0.0001 ? 1 / dist : 0;
      const nx = dx * inv;
      const ny = dy * inv;

      if (this.body) {
        // Aim the velocity STRAIGHT at the player every frame, ramping only a
        // scalar speed. The old code added acceleration onto the existing
        // velocity, which preserved sideways momentum and made gems orbit the
        // player. Setting the direction directly removes that orbit.
        if (this.homeSpeed <= 0) this.homeSpeed = 160;
        this.homeSpeed = Math.min(
          PICKUP.MAGNET_SPEED,
          this.homeSpeed + PICKUP.MAGNET_ACCEL * (delta / 1000)
        );
        (this.body as Phaser.Physics.Arcade.Body).velocity.set(
          nx * this.homeSpeed,
          ny * this.homeSpeed
        );
      }
    }
  }

  /** Effective magnet attraction radius for this pickup type. */
  private magnetRange(): number {
    const stats = this.ctx.stats;
    switch (this.pickupType) {
      case 'xp':
        return stats.magnet;
      case 'gold':
      case 'health':
        // Coins/health are pulled at a comfortable fixed range, boosted a bit
        // by the magnet stat so investing in magnet still feels good.
        return Math.max(60, stats.magnet * 0.6);
      default:
        return 0; // magnet pulse + chest are not auto-attracted
    }
  }

  /* ----------------------------------------------------------------- */
  /* Collection                                                        */
  /* ----------------------------------------------------------------- */

  /**
   * Apply this pickup's effect through the GameContext, play a small collect
   * pop, then deactivate. Safe to call from both the auto-collect path and the
   * GameScene's player↔pickup overlap (guarded by `collected`).
   */
  collect(): void {
    if (this.collected || !this.active) return;
    this.collected = true;

    const ctx = this.ctx;

    switch (this.pickupType) {
      case 'xp':
        ctx.addXp(this.value);
        break;
      case 'health':
        ctx.player.heal(PICKUP.HEALTH_HEAL);
        ctx.popText(this.x, this.y - 6, `+${PICKUP.HEALTH_HEAL}`, COLORS.HP_BAR);
        break;
      case 'gold':
        ctx.addGold(PICKUP.GOLD_VALUE);
        break;
      case 'magnet':
        this.vacuumAllGems();
        break;
      case 'chest':
        // A chest grants a burst of level-up screens.
        for (let i = 0; i < PICKUP.CHEST_ROLLS; i++) ctx.queueLevelUp();
        ctx.shakeCamera(0.004, 160);
        break;
    }

    this.collectFx();
    this.deactivate();
  }

  /**
   * Magnet pulse effect: flag every active XP gem as homing so they all stream
   * to the player on their own preUpdate. (We don't touch coins/chests.)
   */
  private vacuumAllGems(): void {
    const children = this.ctx.pickups.getChildren();
    for (const child of children) {
      const pk = child as Pickup;
      if (pk === this || !pk.active) continue;
      if (pk.pickupType === 'xp' || pk.pickupType === 'gold') {
        pk.homing = true;
      }
    }
    this.ctx.popText(this.ctx.player.x, this.ctx.player.y - 24, 'VACUUM!', COLORS.GOLD_LIGHT);
  }

  /** Tiny collect burst via the shared pooled emitter (tinted per type). */
  private collectFx(): void {
    const tint =
      this.pickupType === 'xp'
        ? this.gemTint()
        : this.pickupType === 'gold'
          ? COLORS.GOLD
          : this.pickupType === 'health'
            ? COLORS.HP_BAR
            : 0xffffff;

    this.ctx.collectBurstAt(this.x, this.y, tint, this.pickupType === 'chest' ? 14 : 6);
  }

  /** Resolve the colour of the gem tier this pickup is showing. */
  private gemTint(): number {
    if (this.value >= GEM_TIERS.LARGE_AT) return COLORS.GEM_L;
    if (this.value >= GEM_TIERS.MED_AT) return COLORS.GEM_M;
    return COLORS.GEM_S;
  }

  /* ----------------------------------------------------------------- */
  /* Pooling                                                           */
  /* ----------------------------------------------------------------- */

  /** Return to the pool: stop tweens/fx, disable the body, hide the sprite. */
  deactivate(): void {
    this.bobTween?.stop();
    this.bobTween = undefined;
    this.stopSparkle();
    this.homing = false;

    if (this.body) {
      this.setVelocity(0, 0);
      this.disableBody(true, true);
    }
    this.setActive(false).setVisible(false);
  }
}
