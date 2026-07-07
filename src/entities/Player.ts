import Phaser from 'phaser';
import type { CharacterDef, GameContext, PlayerLike, PlayerStats } from '../types';
import { EVENTS } from '../types';
import { TEXTURES, SHEET } from '../config/assets';
import { COLORS, DEPTH, ENTITY_SCALE, PLAYER } from '../config/balance';
import { MoveInput } from '../input/MoveInput';
import { Sound } from '../audio/Sound';

/**
 * The player avatar. A pooled-free, single-instance Arcade sprite that reads
 * its tunables from the SHARED PlayerStats object (the very same reference held
 * by GameContext.stats — never replace it, only read it). All cross-module
 * communication goes through the GameContext / its event emitter; the Player
 * never imports another gameplay module.
 *
 * Visual juice handled here:
 *  - a soft drop-shadow sprite that tracks the feet,
 *  - a subtle idle/run sine "bob" so the character feels alive,
 *  - a horizontal flip toward the movement direction,
 *  - a red hit-flash + alpha-blink during the post-hit i-frame window.
 */
export class Player extends Phaser.Physics.Arcade.Sprite implements PlayerLike {
  /** The single shared stat block (set in init from ctx.stats). */
  public stats!: PlayerStats;
  /** Unit-ish vector of the last meaningful movement (defaults to facing right). */
  public facing = new Phaser.Math.Vector2(1, 0);
  public hp = 1;
  public maxHp = 1;
  public isAlive = true;

  /** Kept privately so we never need a cross-module import. */
  private ctx!: GameContext;

  /** Soft drop-shadow that follows under the sprite. */
  private shadow!: Phaser.GameObjects.Image;

  /** small HP bar that follows just beneath the player (track + fill) */
  private hpBarBg!: Phaser.GameObjects.Rectangle;
  private hpBarFill!: Phaser.GameObjects.Rectangle;

  // --- input ---
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // --- i-frames / hit feedback ---
  /** timestamp (scene time) until which the player is invulnerable. */
  private iframeUntil = 0;

  // --- hp regen throttle ---
  private lastHpEmit = 0;

  // --- bob animation ---
  private bobPhase = 0;
  /** logical render y of the sprite without the bob offset (the physics y). */
  private bobOffset = 0;

  // reusable scratch vector to avoid per-frame allocations.
  private readonly moveVec = new Phaser.Math.Vector2();

  constructor(scene: Phaser.Scene, x: number, y: number, character: CharacterDef) {
    super(scene, x, y, TEXTURES.SPRITES, character.frame);

    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.setDepth(DEPTH.PLAYER);
    this.setScale(ENTITY_SCALE);
    this.setOrigin(0.5, 0.5);

    // Circular collision body, centred on the sprite. The body uses LOGICAL
    // (pre-scale) pixels because Arcade applies the display scale for us.
    const r = PLAYER.BODY_RADIUS;
    this.setCircle(
      r,
      SHEET.FRAME_W / 2 - r,
      SHEET.FRAME_H / 2 - r
    );
    this.setCollideWorldBounds(false);

    // Soft drop-shadow under the feet. Centred origin (texture is 28x12).
    this.shadow = scene.add
      .image(x, y, TEXTURES.SHADOW)
      .setDepth(DEPTH.SHADOW)
      .setAlpha(0.55);

    // Compact HP bar that follows beneath the player so you can read your health
    // without glancing at the top-left HUD. Positioned/updated in preUpdate.
    this.hpBarBg = scene.add
      .rectangle(x, y, 34, 7, 0x000000, 0.7)
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.PLAYER)
      .setStrokeStyle(1, 0x000000, 0.85);
    this.hpBarFill = scene.add
      .rectangle(x, y, 30, 4, 0x49d048, 1)
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.PLAYER);
  }

  /**
   * Wire up the shared context. Must run before the first preUpdate.
   * `this.stats` becomes the EXACT same object as ctx.stats — we only read it.
   */
  init(ctx: GameContext): void {
    this.ctx = ctx;
    this.stats = ctx.stats;
    this.hp = this.maxHp = this.stats.maxHp;

    const kb = this.scene.input.keyboard;
    if (kb) {
      this.cursors = kb.createCursorKeys();
      this.keyW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
      this.keyA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
      this.keyS = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
      this.keyD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    }
  }

  /** Per-frame logic. Note `delta` is in ms. */
  preUpdate(time: number, delta: number): void {
    // Undo last frame's render-only bob BEFORE physics syncs the body from
    // this.y, otherwise the offset would accumulate into the true position.
    this.y -= this.bobOffset;

    super.preUpdate(time, delta);

    const body = this.body as Phaser.Physics.Arcade.Body | null;
    if (!body) {
      // keep visuals consistent even without a body
      this.shadow.setPosition(this.x, this.y);
      return;
    }

    const dt = delta / 1000;

    // --- read directional input: touch joystick takes precedence, else keys ---
    let dx = 0;
    let dy = 0;
    let analog = false;
    if (MoveInput.active) {
      // Joystick vector already lies in the unit disk (analog magnitude/speed).
      dx = MoveInput.x;
      dy = MoveInput.y;
      analog = true;
    } else if (this.cursors) {
      if (this.keyA.isDown || this.cursors.left.isDown) dx -= 1;
      if (this.keyD.isDown || this.cursors.right.isDown) dx += 1;
      if (this.keyW.isDown || this.cursors.up.isDown) dy -= 1;
      if (this.keyS.isDown || this.cursors.down.isDown) dy += 1;
    }

    const moving = (dx !== 0 || dy !== 0) && this.isAlive;

    if (moving) {
      if (analog) {
        // Preserve analog magnitude (cap at 1 so it never exceeds full speed).
        this.moveVec.set(dx, dy);
        const len = this.moveVec.length();
        if (len > 1) this.moveVec.scale(1 / len);
      } else {
        // Keyboard: normalise so diagonals aren't faster.
        this.moveVec.set(dx, dy).normalize();
      }
      body.setVelocity(
        this.moveVec.x * this.stats.moveSpeed,
        this.moveVec.y * this.stats.moveSpeed
      );

      // Facing must be a UNIT vector for weapon aiming.
      const fl = this.moveVec.length() || 1;
      this.facing.set(this.moveVec.x / fl, this.moveVec.y / fl);

      // Flip toward horizontal movement (small dead-band avoids jitter).
      if (this.moveVec.x < -0.05) this.setFlipX(true);
      else if (this.moveVec.x > 0.05) this.setFlipX(false);
    } else {
      body.setVelocity(0, 0);
    }

    // --- subtle idle/run bob (sine on a render y offset) ---
    // Run bobs faster + a touch deeper than idle for a lively gait.
    const bobSpeed = moving ? 12 : 3.2;
    const bobAmp = moving ? 2.2 : 1.0;
    this.bobPhase += bobSpeed * dt;
    // Use abs(sin) so the bob is an upward "hop" off the ground (negative y).
    this.bobOffset = -Math.abs(Math.sin(this.bobPhase)) * bobAmp;

    // --- hp regen (and throttled HP_CHANGED, ~4x/sec max) ---
    if (this.isAlive && this.stats.hpRegen > 0 && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + this.stats.hpRegen * dt);
      if (time - this.lastHpEmit >= 250) {
        this.lastHpEmit = time;
        this.ctx.events.emit(EVENTS.HP_CHANGED, { current: this.hp, max: this.maxHp });
      }
    }

    // --- i-frame alpha blink (and ensure full alpha once it ends) ---
    if (time < this.iframeUntil) {
      // ~10Hz flicker between visible and faint.
      this.setAlpha(Math.sin(time * 0.03) > 0 ? 1 : 0.4);
    } else if (this.alpha !== 1) {
      this.setAlpha(1);
    }

    // --- keep the shadow planted under the feet on the TRUE ground line ---
    // (computed from the pre-bob this.y so the hop doesn't drag the shadow up).
    const footY = this.y + (SHEET.FRAME_H / 2) * ENTITY_SCALE * 0.55;
    this.shadow.setPosition(this.x, footY);
    // Shadow shrinks slightly while mid-hop for a fake parallax lift.
    const lift = 1 + this.bobOffset * 0.03; // bobOffset is <= 0
    this.shadow.setScale(lift, lift);

    // --- compact HP bar beneath the player (uses pre-bob y so it stays put) ---
    const barY = footY + 9;
    const frac = Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1);
    this.hpBarBg.setPosition(this.x, barY);
    this.hpBarFill.setPosition(this.x - 15, barY);
    this.hpBarFill.width = 30 * frac;
    this.hpBarFill.setFillStyle(frac <= 0.3 ? COLORS.BLOOD_LIGHT : 0x49d048, 1);

    // --- apply the bob to the rendered position only (body stays at true y) ---
    // Done LAST; removed again at the top of next frame before the physics sync.
    this.y += this.bobOffset;
  }

  /**
   * Apply incoming damage. Honours i-frames, dodge and armor, drives all the
   * hurt feedback, and flips `isAlive` at zero HP (GameScene polls that and may
   * spend a revive).
   */
  takeDamage(amount: number): void {
    const now = this.scene.time.now;
    if (!this.isAlive || now < this.iframeUntil) return;

    // Dodge: a clean miss with a tiny "miss" tell, no i-frames consumed.
    if (this.stats.dodge > 0 && this.ctx.rng.frac() < this.stats.dodge) {
      this.ctx.popText(this.x, this.y - 14, 'MISS', COLORS.BONE);
      return;
    }

    // Armor is flat reduction, but a hit always stings for at least 1.
    const dmg = Math.max(1, amount - this.stats.armor);
    this.hp -= dmg;
    Sound.play('playerHurt');

    // Open the invulnerability window.
    this.iframeUntil = now + PLAYER.IFRAME_MS;

    // Red hit-flash that clears shortly; the i-frame blink takes over after.
    this.setTint(COLORS.BLOOD_LIGHT);
    this.scene.time.delayedCall(PLAYER.HURT_FLASH_MS, () => {
      // Only clear if we're still the one who tinted (avoid clobbering a death state).
      if (this.active) this.clearTint();
    });

    // Notify the rest of the game.
    this.ctx.events.emit(EVENTS.PLAYER_HIT, {});
    this.ctx.shakeCamera(0.004, 120);
    this.ctx.events.emit(EVENTS.HP_CHANGED, { current: Math.max(0, this.hp), max: this.maxHp });
    this.lastHpEmit = now;

    if (this.hp <= 0) {
      this.hp = 0;
      this.isAlive = false;
      // GameScene's update loop sees isAlive=false and handles revive/death.
    }
  }

  /**
   * Restore HP (clamped) and tell the HUD. `heal(0)` is a valid "just re-sync
   * the HUD" call (GameScene uses it after a revive sets hp directly), so we
   * always emit HP_CHANGED — only the heal feedback is gated on amount > 0.
   */
  heal(amount: number): void {
    if (amount > 0) {
      this.hp = Math.min(this.maxHp, this.hp + amount);
      // A soft green heal tint pulse for feedback.
      this.setTint(COLORS.GEM_M);
      this.scene.time.delayedCall(120, () => {
        if (this.active && this.scene.time.now >= this.iframeUntil) this.clearTint();
      });
    } else {
      // Defensive clamp in case hp was set directly above maxHp before this call.
      if (this.hp > this.maxHp) this.hp = this.maxHp;
    }
    this.ctx.events.emit(EVENTS.HP_CHANGED, { current: this.hp, max: this.maxHp });
    this.lastHpEmit = this.scene.time.now;
  }
}
