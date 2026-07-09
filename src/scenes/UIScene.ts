import Phaser from 'phaser';
import { SCENES, EVENTS } from '../types';
import type {
  UpgradeOption,
  OwnedWeaponView,
  OwnedItemView,
  IconRef,
  PlayerStats,
} from '../types';
import { TEXTURES, FRAMES } from '../config/assets';
import { GAME, COLORS, DEPTH, DEFAULT_STATS, PLAYER } from '../config/balance';
import { getCharacter } from '../content/characters';
import { LevelUpOverlay } from '../ui/LevelUpOverlay';
import { PauseOverlay } from '../ui/PauseOverlay';
import { HelpOverlay } from '../ui/HelpOverlay';
import type { PauseSummary } from '../ui/PauseOverlay';
import { VirtualJoystick } from '../ui/VirtualJoystick';
import { Sound } from '../audio/Sound';
import { Music } from '../audio/Music';
// Type-only import so we can type the GameScene reference for getHudSnapshot().
import type { GameScene } from './GameScene';

/** Live HUD snapshot mirrored from GameScene events (used for the pause panel). */
interface HudState {
  hp: number;
  maxHp: number;
  xp: number;
  xpToNext: number;
  level: number;
  kills: number;
  gold: number;
  score: number;
  elapsedMs: number;
  weapons: OwnedWeaponView[];
  items: OwnedItemView[];
}

// Depth for the HUD layer — above gameplay/vignette, below the overlays.
const HUD_DEPTH = DEPTH.POPTEXT + 10;

// On-screen (mobile) pause button geometry — right-anchored under the
// kills/gold panel so the two never overlap.
const PAUSE_BTN_SIZE = 64;
const PAUSE_BTN_MARGIN = 32;
const PAUSE_BTN_Y = 204;
// Mute (speaker) button sits directly below the pause button.
const MUTE_BTN_Y = PAUSE_BTN_Y + PAUSE_BTN_SIZE + 20;

/**
 * Heads-up display. Runs on top of GameScene (scene.launch) and is NEVER paused,
 * so its EventEmitter listeners keep firing while the GameScene is paused for a
 * level-up or pause screen. Reads live state via the GameScene's emitter plus an
 * initial getHudSnapshot().
 */
export class UIScene extends Phaser.Scene {
  private gameScene!: Phaser.Scene; // the GameScene (typed loosely; cast where needed)

  private state: HudState = {
    hp: 100,
    maxHp: 100,
    xp: 0,
    xpToNext: 1,
    level: 1,
    kills: 0,
    gold: 0,
    score: 0,
    elapsedMs: 0,
    weapons: [],
    items: [],
  };

  // --- HUD elements ---
  private xpBarFill!: Phaser.GameObjects.Rectangle;
  private xpBarTrack!: Phaser.GameObjects.Rectangle;
  private xpBarHighlight!: Phaser.GameObjects.Rectangle;
  private xpBarWidth: number = GAME.WIDTH; // full track width (live width at runtime)
  private levelBadgeText!: Phaser.GameObjects.Text;

  private timerText!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;

  private hpBarFill!: Phaser.GameObjects.Rectangle;
  private hpBarMaxWidth = 300;
  private hpText!: Phaser.GameObjects.Text;
  private portrait!: Phaser.GameObjects.Image;

  private killsText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;
  /** right-anchored container wrapping the kills/gold panel (x = live width). */
  private topRight!: Phaser.GameObjects.Container;

  private trayContainer!: Phaser.GameObjects.Container;

  private hitFlash!: Phaser.GameObjects.Rectangle;
  private vignette!: Phaser.GameObjects.Image;

  // --- timed run events (banner + ambient screen tint) ---
  private eventBannerName!: Phaser.GameObjects.Text;
  private eventBannerDesc!: Phaser.GameObjects.Text;
  private eventTint!: Phaser.GameObjects.Rectangle;

  // --- chest compass (edge arrow toward the nearest off-screen chest) ---
  private chestCompass!: Phaser.GameObjects.Container;
  private chestArrow!: Phaser.GameObjects.Graphics;

  // --- touch controls (mobile) ---
  private joystick?: VirtualJoystick;
  private pauseButton!: Phaser.GameObjects.Container;

  // --- mute (speaker) button ---
  private muteButton!: Phaser.GameObjects.Container;
  /** redraw callback registered on Sound.onChanged (detached in teardown) */
  private muteRedraw?: () => void;

  // --- tweens we keep handles to so they can be retargeted/cancelled ---
  private xpTween?: Phaser.Tweens.Tween;
  private hpTween?: Phaser.Tweens.Tween;

  // --- overlays ---
  private levelUpOverlay!: LevelUpOverlay;
  private pauseOverlay!: PauseOverlay;
  private helpOverlay!: HelpOverlay;
  /** the victory screen shown when 8:00 is survived */
  private victoryChoice?: Phaser.GameObjects.Container;
  /** true while the revive freeze beat is playing (GameScene is paused) */
  private reviveFreeze = false;

  private escKey?: Phaser.Input.Keyboard.Key;
  /** timestamp the pause overlay opened; gates ESC-resume from same-frame race. */
  private pauseOpenedAt = 0;

  constructor() {
    super(SCENES.UI);
  }

  create(): void {
    this.gameScene = this.scene.get(SCENES.GAME);

    // Pull the initial values from the GameScene so the HUD starts correct.
    const snap = (this.gameScene as GameScene).getHudSnapshot?.();
    if (snap) {
      this.state = {
        hp: snap.hp,
        maxHp: snap.maxHp,
        xp: snap.xp,
        xpToNext: snap.xpToNext,
        level: snap.level,
        kills: snap.kills,
        gold: snap.gold,
        score: snap.score ?? 0,
        elapsedMs: snap.elapsedMs,
        weapons: snap.weapons ?? [],
        items: snap.items ?? [],
      };
    }

    // Ambient atmosphere moved here from the GameScene: the world camera is
    // zoomed, which would distort a full-screen overlay, so the un-zoomed UIScene
    // draws the vignette + drifting dust above the world but below the HUD.
    this.add
      .particles(0, 0, TEXTURES.PARTICLE, {
        x: { min: 0, max: this.scale.width },
        y: { min: 0, max: GAME.HEIGHT },
        lifespan: 4200,
        speedX: { min: -8, max: 8 },
        speedY: { min: 6, max: 20 },
        scale: { min: 0.16, max: 0.44 },
        alpha: { start: 0.12, end: 0 },
        frequency: 200,
        quantity: 1,
        blendMode: Phaser.BlendModes.ADD,
        tint: COLORS.BONE,
      })
      .setScrollFactor(0)
      // low depth: above the GameScene world (UIScene renders after it) but
      // below every HUD widget (HUD_DEPTH = 60) and the overlays (70–80).
      .setDepth(2);

    this.vignette = this.add
      .image(0, 0, TEXTURES.VIGNETTE)
      .setOrigin(0, 0)
      .setDisplaySize(this.scale.width, GAME.HEIGHT)
      .setScrollFactor(0)
      // sits just above the dust, still well below the HUD/overlays.
      .setDepth(3);

    this.buildHud();

    // Apply the initial snapshot to the freshly-built widgets (no animation).
    this.refreshXp(false);
    this.refreshHp(false);
    this.killsText.setText(`${this.state.kills}`);
    this.goldText.setText(`${this.state.gold}`);
    this.refreshScore();
    this.refreshTimer();
    this.rebuildTray();

    // Overlays.
    const gameEvents = this.gameScene.events;
    this.levelUpOverlay = new LevelUpOverlay(this, gameEvents);
    this.pauseOverlay = new PauseOverlay(this);
    this.pauseOverlay.setOnResume(() => {
      this.scene.resume(SCENES.GAME);
    });
    // The guide is opened from the pause screen's 가이드 button; it draws over
    // the (still-visible) pause panel and closes back to it.
    this.helpOverlay = new HelpOverlay(this);
    this.pauseOverlay.setOnHelp(() => this.helpOverlay.show());

    this.subscribe(gameEvents);

    // ESC: this scene stays active, so it owns the pause/resume toggle. While a
    // level-up is showing we ignore ESC (the GameScene gates opening a pause too).
    this.escKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    this.escKey?.on('down', () => this.onEsc());

    // Touch controls (mobile): floating joystick for movement (writes MoveInput,
    // ignores mouse) + an on-screen pause button (no ESC on touch devices).
    this.joystick = new VirtualJoystick(this);
    this.buildPauseButton();
    this.buildMuteButton();

    // Landscape-responsive: reposition the width-dependent HUD pieces when the
    // live width changes. We do NOT restart (it would desync the running game /
    // close overlays); reflow only while no overlay is up.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);

    // Cleanly detach all listeners + DOM handlers when the scene stops.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown(gameEvents));
  }

  /* --------------------------------------------------------------- */
  /* Landscape-responsive reflow                                     */
  /* --------------------------------------------------------------- */

  /**
   * Reposition the width-dependent HUD on resize/rotation. Skipped while any
   * overlay is visible (re-laying out under a modal can desync / softlock it;
   * the overlays re-centre themselves on their next show()).
   */
  private onResize(): void {
    if (
      this.levelUpOverlay.isVisible() ||
      this.pauseOverlay.isVisible() ||
      this.helpOverlay.isVisible() ||
      this.victoryChoice
    )
      return;

    const w = this.scale.width;
    const h = this.scale.height;

    // full-width XP bar (track + fill + highlight)
    this.xpBarWidth = w;
    this.xpBarTrack.width = w;
    this.xpBarHighlight.width = w;
    this.refreshXp(false);

    // centred timer + score
    this.timerText.x = w / 2;
    this.scoreText.x = w / 2;

    // right-anchored kills/gold group
    this.topRight.x = w;

    // full-screen hit-flash + vignette + event tint / banner
    this.hitFlash.setPosition(w / 2, h / 2).setSize(w, h);
    this.vignette.setDisplaySize(w, h);
    this.eventTint.setPosition(w / 2, GAME.HEIGHT / 2).setSize(w, GAME.HEIGHT);
    this.eventBannerName.setX(w / 2);
    this.eventBannerDesc.setX(w / 2);

    // right-anchored pause + mute buttons
    this.pauseButton.x = w - PAUSE_BTN_MARGIN - PAUSE_BTN_SIZE / 2;
    this.muteButton.x = w - PAUSE_BTN_MARGIN - PAUSE_BTN_SIZE / 2;
  }

  /* --------------------------------------------------------------- */
  /* Event wiring                                                    */
  /* --------------------------------------------------------------- */

  private subscribe(g: Phaser.Events.EventEmitter): void {
    g.on(EVENTS.HP_CHANGED, this.onHpChanged, this);
    g.on(EVENTS.XP_CHANGED, this.onXpChanged, this);
    g.on(EVENTS.KILLS_CHANGED, this.onKillsChanged, this);
    g.on(EVENTS.GOLD_CHANGED, this.onGoldChanged, this);
    g.on(EVENTS.SCORE_CHANGED, this.onScoreChanged, this);
    g.on(EVENTS.REVIVED, this.onRevived, this);
    g.on(EVENTS.VICTORY_CHOICE, this.onVictoryChoice, this);
    g.on(EVENTS.TIMER, this.onTimer, this);
    g.on(EVENTS.WEAPONS_CHANGED, this.onWeaponsChanged, this);
    g.on(EVENTS.ITEMS_CHANGED, this.onItemsChanged, this);
    g.on(EVENTS.PLAYER_HIT, this.onPlayerHit, this);
    g.on(EVENTS.LEVEL_UP, this.onLevelUp, this);
    g.on(EVENTS.PAUSE_TOGGLED, this.onPauseToggled, this);
    g.on(EVENTS.RUN_EVENT, this.onRunEvent, this);
    g.on(EVENTS.CHEST_DIR, this.onChestDir, this);
    // Scene lifecycle: the GameScene pauses for BOTH the pause overlay and the
    // level-up choice — duck the music behind either modal, restore on resume.
    g.on(Phaser.Scenes.Events.PAUSE, this.onGamePaused, this);
    g.on(Phaser.Scenes.Events.RESUME, this.onGameResumed, this);
  }

  private teardown(g: Phaser.Events.EventEmitter): void {
    g.off(EVENTS.HP_CHANGED, this.onHpChanged, this);
    g.off(EVENTS.XP_CHANGED, this.onXpChanged, this);
    g.off(EVENTS.KILLS_CHANGED, this.onKillsChanged, this);
    g.off(EVENTS.GOLD_CHANGED, this.onGoldChanged, this);
    g.off(EVENTS.SCORE_CHANGED, this.onScoreChanged, this);
    g.off(EVENTS.REVIVED, this.onRevived, this);
    g.off(EVENTS.VICTORY_CHOICE, this.onVictoryChoice, this);
    g.off(EVENTS.TIMER, this.onTimer, this);
    g.off(EVENTS.WEAPONS_CHANGED, this.onWeaponsChanged, this);
    g.off(EVENTS.ITEMS_CHANGED, this.onItemsChanged, this);
    g.off(EVENTS.PLAYER_HIT, this.onPlayerHit, this);
    g.off(EVENTS.LEVEL_UP, this.onLevelUp, this);
    g.off(EVENTS.PAUSE_TOGGLED, this.onPauseToggled, this);
    g.off(EVENTS.RUN_EVENT, this.onRunEvent, this);
    g.off(EVENTS.CHEST_DIR, this.onChestDir, this);
    g.off(Phaser.Scenes.Events.PAUSE, this.onGamePaused, this);
    g.off(Phaser.Scenes.Events.RESUME, this.onGameResumed, this);
    if (this.muteRedraw) Sound.offChanged(this.muteRedraw);
    Music.duck(false);
    this.escKey?.removeAllListeners();
    this.levelUpOverlay?.destroy();
    this.pauseOverlay?.destroy();
    this.helpOverlay?.destroy();
    this.victoryChoice?.destroy();
    this.victoryChoice = undefined;
    this.joystick?.destroy();
    this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
  }

  /* --------------------------------------------------------------- */
  /* Event handlers                                                  */
  /* --------------------------------------------------------------- */

  private onHpChanged(p: { current: number; max: number }): void {
    this.state.hp = p.current;
    this.state.maxHp = p.max;
    this.refreshHp(true);
  }

  private onXpChanged(p: { xp: number; xpToNext: number; level: number }): void {
    const leveled = p.level !== this.state.level;
    this.state.xp = p.xp;
    this.state.xpToNext = p.xpToNext;
    this.state.level = p.level;
    this.refreshXp(true);
    if (leveled) this.pulseLevelBadge();
  }

  private onKillsChanged(p: { kills: number }): void {
    this.state.kills = p.kills;
    this.killsText.setText(`${p.kills}`);
    this.bump(this.killsText);
  }

  private onGoldChanged(p: { gold: number }): void {
    this.state.gold = p.gold;
    this.goldText.setText(`${p.gold}`);
    this.bump(this.goldText);
  }

  // Score updates constantly (time term ticks 4x/sec) — no bump tween, the
  // motion of the number itself is the feedback.
  private onScoreChanged(p: { score: number }): void {
    this.state.score = p.score;
    this.refreshScore();
  }

  private onTimer(p: { elapsedMs: number }): void {
    this.state.elapsedMs = p.elapsedMs;
    this.refreshTimer();
  }

  private onWeaponsChanged(p: { owned: OwnedWeaponView[] }): void {
    this.state.weapons = p.owned ?? [];
    this.rebuildTray();
  }

  private onItemsChanged(p: { owned: OwnedItemView[] }): void {
    this.state.items = p.owned ?? [];
    this.rebuildTray();
  }

  private onGamePaused(): void {
    Music.duck(true);
  }

  private onGameResumed(): void {
    Music.duck(false);
  }

  private onPlayerHit(): void {
    this.hitFlash.setAlpha(0.5);
    this.tweens.killTweensOf(this.hitFlash);
    this.tweens.add({
      targets: this.hitFlash,
      alpha: 0,
      duration: 260,
      ease: 'Quad.Out',
    });
  }

  private onLevelUp(p: { level: number; options: UpgradeOption[]; rerollsLeft?: number }): void {
    // Hide the pause overlay if somehow open; level-up takes priority.
    if (this.pauseOverlay.isVisible()) this.pauseOverlay.hide();
    this.levelUpOverlay.show(p.level, p.options, p.rerollsLeft ?? 0);
  }

  private onPauseToggled(p: { paused: boolean }): void {
    if (p.paused) {
      this.pauseOpenedAt = this.time.now;
      this.pauseOverlay.show(this.buildPauseSummary());
    } else {
      this.pauseOverlay.hide();
    }
  }

  /* --------------------------------------------------------------- */
  /* Revive freeze beat                                              */
  /* --------------------------------------------------------------- */

  /**
   * game -> UI: an auto-revive fired. The GameScene just paused itself; this
   * scene (never paused) plays a short golden beat — flash, big "부활", the
   * remaining-charges line — then resumes the world.
   */
  private onRevived(p: { revivesLeft: number }): void {
    if (this.reviveFreeze) return;
    this.reviveFreeze = true;
    const w = this.scale.width;
    const cy = GAME.HEIGHT / 2;
    const depth = HUD_DEPTH + 25;

    // golden full-screen flash that decays over the freeze
    const flash = this.add
      .rectangle(w / 2, cy, w, GAME.HEIGHT, COLORS.GOLD, 1)
      .setScrollFactor(0)
      .setDepth(depth)
      .setAlpha(0.38);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      duration: PLAYER.REVIVE_FREEZE_MS,
      ease: 'Quad.easeOut',
    });

    // big "부활" pop (the player sits at screen centre — camera-followed)
    const serif = 'Cinzel, "Noto Serif KR", serif';
    const title = this.add
      .text(w / 2, cy - 96, '부 활', {
        fontFamily: serif,
        fontStyle: '700',
        fontSize: '84px',
        color: '#f0d896',
        stroke: '#1a1208',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(depth + 1)
      .setScale(0.5)
      .setAlpha(0);
    this.tweens.add({
      targets: title,
      scale: 1,
      alpha: 1,
      duration: 260,
      ease: 'Back.Out',
    });

    const sub = this.add
      .text(w / 2, cy - 30, `남은 부활 ${p.revivesLeft}회`, {
        fontFamily: serif,
        fontStyle: '700',
        fontSize: '26px',
        color: '#d8c9a0',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(depth + 1)
      .setAlpha(0);
    this.tweens.add({ targets: sub, alpha: 0.95, duration: 260, delay: 140 });

    // hold, fade out, resume the world
    this.tweens.add({
      targets: [title, sub],
      alpha: 0,
      delay: PLAYER.REVIVE_FREEZE_MS - 240,
      duration: 240,
      ease: 'Quad.In',
    });
    this.time.delayedCall(PLAYER.REVIVE_FREEZE_MS, () => {
      flash.destroy();
      title.destroy();
      sub.destroy();
      this.reviveFreeze = false;
      // resume unless some other modal took over the pause meanwhile
      if (
        !this.levelUpOverlay.isVisible() &&
        !this.pauseOverlay.isVisible() &&
        !this.victoryChoice
      ) {
        this.scene.resume(SCENES.GAME);
      }
    });
  }

  /* --------------------------------------------------------------- */
  /* Victory screen (8:00 survived → run finalised)                  */
  /* --------------------------------------------------------------- */

  /** game -> UI: the 8:00 mark was survived; show the victory screen. */
  private onVictoryChoice(): void {
    if (this.victoryChoice) return; // already showing
    const w = this.scale.width;
    const cy = GAME.HEIGHT / 2;
    const depth = HUD_DEPTH + 25; // above every HUD widget and overlay

    const c = this.add.container(0, 0).setScrollFactor(0).setDepth(depth);
    this.victoryChoice = c;

    // dim + panel
    c.add(this.add.rectangle(w / 2, cy, w, GAME.HEIGHT, 0x000000, 0.62));
    const pw = 880;
    const ph = 420;
    c.add(
      this.add
        .rectangle(w / 2, cy, pw, ph, COLORS.PANEL, 0.97)
        .setStrokeStyle(6, COLORS.GOLD)
    );

    const serif = 'Cinzel, "Noto Serif KR", serif';
    c.add(
      this.add
        .text(w / 2, cy - 128, '승리!', {
          fontFamily: serif,
          fontStyle: '700',
          fontSize: '72px',
          color: '#f0d896',
        })
        .setOrigin(0.5)
        .setShadow(0, 4, '#000000', 16, true, true)
    );
    c.add(
      this.add
        .text(w / 2, cy - 40, '영원한 밤을 견뎌냈다 — 승리는 확정되었다.', {
          fontFamily: serif,
          fontSize: '26px',
          color: '#e8e0d0',
        })
        .setOrigin(0.5)
    );

    const mkButton = (x: number, label: string, accent: number, cb: () => void): void => {
      const bw = 340;
      const bh = 84;
      const bg = this.add
        .rectangle(x, cy + 96, bw, bh, COLORS.PANEL_LIGHT, 1)
        .setStrokeStyle(4, accent)
        .setInteractive({ useHandCursor: true });
      const txt = this.add
        .text(x, cy + 96, label, {
          fontFamily: serif,
          fontStyle: '700',
          fontSize: '30px',
          color: '#e8e0d0',
        })
        .setOrigin(0.5);
      bg.on('pointerover', () => {
        Sound.play('uiHover');
        bg.setFillStyle(accent, 0.28);
        txt.setColor('#f0d896');
      });
      bg.on('pointerout', () => {
        bg.setFillStyle(COLORS.PANEL_LIGHT, 1);
        txt.setColor('#e8e0d0');
      });
      bg.on('pointerdown', cb);
      // clickable bg added before txt; container input follows add order, and
      // the interactive rect is beneath its own label only visually.
      c.add(bg);
      c.add(txt);
    };

    mkButton(w / 2, '결과 확인', COLORS.GOLD, () => this.decideVictory());
  }

  private decideVictory(): void {
    if (!this.victoryChoice) return;
    Sound.play('uiConfirm');
    this.victoryChoice.destroy();
    this.victoryChoice = undefined;
    this.gameScene.events.emit(EVENTS.VICTORY_DECIDED, {});
  }

  /** A timed run event started/ended: banner + ambient tint. */
  private onRunEvent(p: {
    id: string;
    name: string;
    desc: string;
    active: boolean;
    durationMs: number;
  }): void {
    // per-event flavour colours
    const accent =
      p.id === 'goldRush' ? '#f0d896' : p.id === 'bloodMoon' ? '#e24b58' : '#bfe8ff';
    const tintColor =
      p.id === 'goldRush' ? COLORS.GOLD : p.id === 'bloodMoon' ? COLORS.BLOOD : 0x6ab0ff;
    const tintAlpha = p.id === 'bloodMoon' ? 0.09 : 0.055;

    if (p.active) {
      // banner: pop in, hold, fade out
      this.eventBannerName.setText(`✦ ${p.name} ✦`).setColor(accent);
      this.eventBannerDesc.setText(p.desc);
      this.tweens.killTweensOf([this.eventBannerName, this.eventBannerDesc]);
      this.eventBannerName.setAlpha(0).setScale(0.7);
      this.eventBannerDesc.setAlpha(0);
      this.tweens.add({
        targets: this.eventBannerName,
        alpha: 1,
        scale: 1,
        duration: 320,
        ease: 'Back.Out',
      });
      this.tweens.add({ targets: this.eventBannerDesc, alpha: 0.95, duration: 320, delay: 120 });
      this.tweens.add({
        targets: [this.eventBannerName, this.eventBannerDesc],
        alpha: 0,
        delay: 2800,
        duration: 500,
        ease: 'Quad.In',
      });

      // ambient tint while the event runs (instant events just flash briefly)
      this.tweens.killTweensOf(this.eventTint);
      this.eventTint.setFillStyle(tintColor, 1);
      this.tweens.add({ targets: this.eventTint, alpha: tintAlpha, duration: 400 });
      if (p.durationMs <= 0) {
        this.tweens.add({ targets: this.eventTint, alpha: 0, delay: 1600, duration: 900 });
      }
    } else {
      this.tweens.killTweensOf(this.eventTint);
      this.tweens.add({ targets: this.eventTint, alpha: 0, duration: 600 });
    }
  }

  /** Aim/park the chest compass on the screen edge (player ≈ screen centre). */
  private onChestDir(p: { active: boolean; angle: number }): void {
    if (!p.active) {
      this.chestCompass.setVisible(false);
      return;
    }
    const cx = this.scale.width / 2;
    const cy = GAME.HEIGHT / 2;
    const cos = Math.cos(p.angle);
    const sin = Math.sin(p.angle);
    const maxX = this.scale.width / 2 - 96;
    const maxY = GAME.HEIGHT / 2 - 120;
    const r = Math.min(
      Math.abs(cos) > 1e-4 ? maxX / Math.abs(cos) : Number.POSITIVE_INFINITY,
      Math.abs(sin) > 1e-4 ? maxY / Math.abs(sin) : Number.POSITIVE_INFINITY
    );
    this.chestCompass.setPosition(cx + cos * r, cy + sin * r);
    this.chestArrow.setRotation(p.angle);
    this.chestCompass.setVisible(true);
  }

  private onEsc(): void {
    // The victory-choice modal and the revive freeze block ESC entirely.
    if (this.victoryChoice || this.reviveFreeze) return;
    // Level-up screen blocks pausing entirely (choice must be made first).
    if (this.levelUpOverlay.isVisible()) return;
    // The guide (opened from the pause screen) closes first, back to the pause.
    if (this.helpOverlay.isVisible()) {
      this.helpOverlay.hide();
      return;
    }
    // If the pause overlay is up, ESC resumes — but ignore the same keypress
    // that just opened it (GameScene's ESC opens pause; both scenes get the key
    // in the same frame). A small window prevents an instant open->resume.
    if (this.pauseOverlay.isVisible()) {
      if (this.time.now - this.pauseOpenedAt < 250) return;
      this.pauseOverlay.resume();
    }
    // If not paused, the GameScene owns ESC->openPause (it gates on running
    // state). We do nothing here to avoid double-handling.
  }

  /* --------------------------------------------------------------- */
  /* HUD construction                                                */
  /* --------------------------------------------------------------- */

  private buildHud(): void {
    this.buildXpBar();
    this.buildTimer();
    this.buildHpBlock();
    this.buildTopRight();
    this.buildTray();
    this.buildHitFlash();
    this.buildEventLayer();
    this.buildChestCompass();
  }

  /** Full-width thin XP bar at the very top + a circular "Lv N" badge. */
  private buildXpBar(): void {
    const barH = 24;
    const y = barH / 2;
    const w = this.scale.width; // live full-screen width
    this.xpBarWidth = w;

    // dark track
    this.xpBarTrack = this.add
      .rectangle(0, 0, w, barH, COLORS.XP_BAR_DARK, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH);
    this.xpBarTrack.setStrokeStyle(0);

    // fill
    this.xpBarFill = this.add
      .rectangle(0, 0, w, barH, COLORS.XP_BAR, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);

    // a brighter top highlight line for a glassy feel
    this.xpBarHighlight = this.add
      .rectangle(0, 0, w, 4, 0xffffff, 0.22)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 2);

    // Lv badge: a gold-rimmed disc near the left.
    const badgeX = 60;
    const badgeY = barH + 36;
    const badge = this.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH + 1);
    badge.fillStyle(0x000000, 0.5).fillCircle(badgeX + 2, badgeY + 2, 36);
    badge.fillStyle(COLORS.PANEL, 1).fillCircle(badgeX, badgeY, 36);
    badge.lineStyle(5, COLORS.GOLD, 1).strokeCircle(badgeX, badgeY, 36);

    const lvLabel = this.add
      .text(badgeX, badgeY - 16, 'LV', {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '16px',
        color: '#c9a24b',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 2);
    void lvLabel;

    this.levelBadgeText = this.add
      .text(badgeX, badgeY + 8, `${this.state.level}`, {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '24px',
        color: '#f0d896',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 2);
  }

  /** Large mm:ss timer centred just below the XP bar, live score under it. */
  private buildTimer(): void {
    this.timerText = this.add
      .text(this.scale.width / 2, 60, '00:00', {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '40px',
        color: '#e8e0d0',
        stroke: '#000000',
        strokeThickness: 8,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 2);

    this.scoreText = this.add
      .text(this.scale.width / 2, 112, 'SCORE 0', {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '20px',
        color: '#f0d896',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 2);
  }

  /** Top-left: framed character portrait + red HP bar with cur/max text. */
  private buildHpBlock(): void {
    const ox = 28; // left margin
    // Sit BELOW the circular level badge (which spans y≈24–96) so the two no
    // longer overlap in the top-left corner.
    const oy = 108;
    const portraitSize = 88;

    // portrait frame
    const frame = this.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH);
    frame
      .fillStyle(COLORS.PANEL, 0.95)
      .fillRoundedRect(ox, oy, portraitSize, portraitSize, 12);
    frame
      .lineStyle(4, COLORS.PANEL_BORDER, 1)
      .strokeRoundedRect(ox, oy, portraitSize, portraitSize, 12);

    // portrait sprite from the dungeon sheet (the run's character).
    const charId = this.getCharacterId();
    const character = getCharacter(charId);
    this.portrait = this.add
      .image(ox + portraitSize / 2, oy + portraitSize / 2, TEXTURES.SPRITES, character.frame)
      .setScale(4.4)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);

    // HP bar to the right of the portrait.
    const barX = ox + portraitSize + 20;
    const barY = oy + portraitSize - 36;
    const barH = 28;
    this.hpBarMaxWidth = 300;

    // dark track
    const track = this.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH);
    track.fillStyle(0x000000, 0.5).fillRoundedRect(barX - 4, barY - 4, this.hpBarMaxWidth + 8, barH + 8, 8);
    track.fillStyle(COLORS.HP_BAR_DARK, 1).fillRoundedRect(barX, barY, this.hpBarMaxWidth, barH, 6);

    // fill (a plain rect so we can tween width cheaply).
    this.hpBarFill = this.add
      .rectangle(barX, barY, this.hpBarMaxWidth, barH, COLORS.HP_BAR, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);

    // "HP" label above the bar.
    this.add
      .text(barX, oy + 4, 'HP', {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '16px',
        color: '#e24b58',
      })
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);

    // cur/max text centred over the bar.
    this.hpText = this.add
      .text(barX + this.hpBarMaxWidth / 2, barY + barH / 2, '100 / 100', {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '16px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 2);

    void frame;
  }

  /**
   * Top-right: kills (skull) and gold (coin) counters. Wrapped in a container
   * anchored to the LIVE right edge (container.x = screen width), so every child
   * is laid out with NEGATIVE x offsets and onResize() only nudges container.x.
   */
  private buildTopRight(): void {
    const topY = 44;
    const rightX = -32; // local: right edge of the group sits at container.x

    this.topRight = this.add
      .container(this.scale.width, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH);

    // panel behind the counters
    const panelW = 280;
    const panelH = 112;
    const panel = this.add.graphics();
    panel
      .fillStyle(COLORS.PANEL, 0.85)
      .fillRoundedRect(rightX - panelW, topY, panelW, panelH, 12);
    panel
      .lineStyle(4, COLORS.PANEL_BORDER, 1)
      .strokeRoundedRect(rightX - panelW, topY, panelW, panelH, 12);
    this.topRight.add(panel);

    const iconX = rightX - panelW + 44;

    // kills row — skull glyph (text) + count.
    const skull = this.add
      .text(iconX, topY + 32, '☠', {
        fontFamily: 'serif',
        fontSize: '36px',
        color: '#e8e0d0',
      })
      .setOrigin(0.5);
    this.topRight.add(skull);

    this.killsText = this.add
      .text(iconX + 36, topY + 32, '0', {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '24px',
        color: '#e8e0d0',
      })
      .setOrigin(0, 0.5);
    this.topRight.add(this.killsText);

    // gold row — generated coin icon + count.
    const coin = this.add
      .image(iconX, topY + 80, TEXTURES.ICON_COIN)
      .setScale(0.9);
    this.topRight.add(coin);

    this.goldText = this.add
      .text(iconX + 36, topY + 80, '0', {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '24px',
        color: '#f0d896',
      })
      .setOrigin(0, 0.5);
    this.topRight.add(this.goldText);
  }

  /** Bottom-left tray container for weapon + item icon slots. */
  private buildTray(): void {
    this.trayContainer = this.add
      .container(28, GAME.HEIGHT - 28)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);
  }

  /** Red full-screen flash used on PLAYER_HIT. */
  private buildHitFlash(): void {
    const w = this.scale.width;
    this.hitFlash = this.add
      .rectangle(w / 2, GAME.HEIGHT / 2, w, GAME.HEIGHT, COLORS.BLOOD, 1)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 5)
      .setAlpha(0);
  }

  /** Banner texts + ambient tint used by the timed run events. */
  private buildEventLayer(): void {
    const w = this.scale.width;

    // ambient full-screen tint while a timed event is active (above the
    // vignette at depth 3, below every HUD widget).
    this.eventTint = this.add
      .rectangle(w / 2, GAME.HEIGHT / 2, w, GAME.HEIGHT, COLORS.BLOOD, 1)
      .setScrollFactor(0)
      .setDepth(4)
      .setAlpha(0);

    this.eventBannerName = this.add
      .text(w / 2, 236, '', {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '58px',
        color: '#f0d896',
        stroke: '#1a1208',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 4)
      .setAlpha(0);

    this.eventBannerDesc = this.add
      .text(w / 2, 292, '', {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '26px',
        color: '#d8c9a0',
        stroke: '#000000',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 4)
      .setAlpha(0);
  }

  /**
   * Chest compass: a gold chest icon + pointing arrow that sits on the screen
   * edge in the direction of the nearest off-screen treasure chest.
   */
  private buildChestCompass(): void {
    this.chestCompass = this.add
      .container(0, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 3)
      .setVisible(false);

    const chest = this.add
      .image(0, 0, TEXTURES.SPRITES, FRAMES.CHEST)
      .setScale(2.6);
    this.chestCompass.add(chest);

    // triangle pointing +x, orbiting the chest icon via its own rotation
    this.chestArrow = this.add.graphics();
    this.chestArrow.fillStyle(COLORS.GOLD_LIGHT, 1).fillTriangle(52, 0, 30, -13, 30, 13);
    this.chestArrow.lineStyle(3, 0x1a1208, 0.9).strokeTriangle(52, 0, 30, -13, 30, 13);
    this.chestCompass.add(this.chestArrow);

    // attention pulse
    this.tweens.add({
      targets: this.chestCompass,
      alpha: { from: 1, to: 0.55 },
      duration: 600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  /**
   * On-screen pause button (mobile has no ESC). Gothic framed square with a
   * pause glyph, anchored to the LIVE right edge under the kills/gold panel.
   * Sits above the HUD and the joystick chrome so taps reach it, not the
   * joystick catch-zone (which is at a much lower depth).
   */
  private buildPauseButton(): void {
    const size = PAUSE_BTN_SIZE;
    const c = this.add
      .container(this.scale.width - PAUSE_BTN_MARGIN - size / 2, PAUSE_BTN_Y)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 8);

    const bg = this.add.graphics();
    const draw = (hot: boolean): void => {
      bg.clear();
      bg.fillStyle(hot ? COLORS.PANEL_LIGHT : COLORS.PANEL, 0.92).fillRoundedRect(-size / 2, -size / 2, size, size, 12);
      bg.lineStyle(4, COLORS.GOLD, hot ? 1 : 0.8).strokeRoundedRect(-size / 2, -size / 2, size, size, 12);
      // two pause bars
      bg.fillStyle(COLORS.GOLD_LIGHT, 1);
      bg.fillRect(-12, -16, 8, 32);
      bg.fillRect(4, -16, 8, 32);
    };
    draw(false);
    c.add(bg);

    const zone = this.add.zone(0, 0, size, size).setOrigin(0.5).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => draw(true));
    zone.on('pointerout', () => draw(false));
    zone.on('pointerdown', () => this.onPauseButton());
    c.add(zone);

    this.pauseButton = c;
  }

  /** Tap handler for the on-screen pause button — mirrors the ESC/open path. */
  private onPauseButton(): void {
    // Do nothing if a modal is already up (level-up / victory choice / revive
    // freeze / paused).
    if (
      this.victoryChoice ||
      this.reviveFreeze ||
      this.levelUpOverlay.isVisible() ||
      this.pauseOverlay.isVisible()
    )
      return;
    Sound.play('uiClick');
    this.scene.pause(SCENES.GAME);
    this.pauseOpenedAt = this.time.now;
    this.pauseOverlay.show(this.buildPauseSummary());
  }

  /**
   * Master mute (speaker) button under the pause button. The M key toggles the
   * same global state (handled inside Sound); the icon re-renders through
   * Sound.onChanged so both paths stay in sync.
   */
  private buildMuteButton(): void {
    const size = PAUSE_BTN_SIZE;
    const c = this.add
      .container(this.scale.width - PAUSE_BTN_MARGIN - size / 2, MUTE_BTN_Y)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 8);

    const bg = this.add.graphics();
    const draw = (hot: boolean): void => {
      const muted = Sound.muted;
      bg.clear();
      bg.fillStyle(hot ? COLORS.PANEL_LIGHT : COLORS.PANEL, 0.92).fillRoundedRect(-size / 2, -size / 2, size, size, 12);
      bg.lineStyle(4, COLORS.GOLD, hot ? 1 : 0.8).strokeRoundedRect(-size / 2, -size / 2, size, size, 12);
      // speaker glyph: box + cone (dimmed while muted)
      bg.fillStyle(muted ? 0x8a8296 : COLORS.GOLD_LIGHT, 1);
      bg.fillRect(-20, -7, 9, 14);
      bg.fillTriangle(-12, 0, 0, -15, 0, 15);
      if (muted) {
        // red strike-through
        bg.lineStyle(5, COLORS.BLOOD_LIGHT, 1);
        bg.lineBetween(6, -10, 20, 10);
        bg.lineBetween(20, -10, 6, 10);
      } else {
        // sound waves
        bg.lineStyle(4, COLORS.GOLD_LIGHT, 0.9);
        bg.beginPath();
        bg.arc(2, 0, 9, -0.85, 0.85);
        bg.strokePath();
        bg.beginPath();
        bg.arc(2, 0, 15, -0.85, 0.85);
        bg.strokePath();
      }
    };
    draw(false);
    c.add(bg);

    // clickable zone LAST (container children ignore depth; input follows add order)
    const zone = this.add.zone(0, 0, size, size).setOrigin(0.5).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => draw(true));
    zone.on('pointerout', () => draw(false));
    zone.on('pointerdown', () => Sound.toggleMuted()); // redraw arrives via onChanged
    c.add(zone);

    this.muteButton = c;
    this.muteRedraw = () => draw(false);
    Sound.onChanged(this.muteRedraw);
  }

  /* --------------------------------------------------------------- */
  /* HUD refreshers                                                  */
  /* --------------------------------------------------------------- */

  private refreshXp(animate: boolean): void {
    const ratio = this.state.xpToNext > 0 ? Phaser.Math.Clamp(this.state.xp / this.state.xpToNext, 0, 1) : 0;
    const targetW = Math.max(0, this.xpBarWidth * ratio);
    this.levelBadgeText.setText(`${this.state.level}`);

    this.xpTween?.stop();
    if (animate) {
      this.xpTween = this.tweens.add({
        targets: this.xpBarFill,
        width: targetW,
        duration: 220,
        ease: 'Quad.Out',
      });
    } else {
      this.xpBarFill.width = targetW;
    }
  }

  private refreshHp(animate: boolean): void {
    const max = this.state.maxHp > 0 ? this.state.maxHp : 1;
    const ratio = Phaser.Math.Clamp(this.state.hp / max, 0, 1);
    const targetW = this.hpBarMaxWidth * ratio;
    const cur = Math.max(0, Math.ceil(this.state.hp));
    this.hpText.setText(`${cur} / ${Math.round(this.state.maxHp)}`);

    // tint shifts toward bright as it gets dangerous (low hp = warning).
    const danger = ratio <= 0.3;
    this.hpBarFill.setFillStyle(danger ? COLORS.BLOOD_LIGHT : COLORS.HP_BAR, 1);

    this.hpTween?.stop();
    if (animate) {
      this.hpTween = this.tweens.add({
        targets: this.hpBarFill,
        width: targetW,
        duration: 200,
        ease: 'Quad.Out',
      });
    } else {
      this.hpBarFill.width = targetW;
    }
  }

  private refreshTimer(): void {
    const total = Math.floor(this.state.elapsedMs / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    this.timerText.setText(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
  }

  private refreshScore(): void {
    this.scoreText.setText(`SCORE ${this.state.score.toLocaleString()}`);
  }

  /** Rebuild the bottom-left tray of weapon then item icon slots. */
  private rebuildTray(): void {
    this.trayContainer.removeAll(true);

    const slot = 76;
    const gap = 12;
    let x = slot / 2; // first slot centre, growing right
    const y = -slot / 2; // container anchored at bottom-left, so go up

    const addSlot = (
      icon: IconRef,
      level: number,
      maxLevel: number,
      isWeapon: boolean
    ): void => {
      const cell = this.add.container(x, y).setScrollFactor(0);

      const box = this.add.graphics();
      // weapons get a slightly warmer rim than items for quick scanning.
      const rim = isWeapon ? COLORS.GOLD : COLORS.PANEL_BORDER;
      const maxed = level >= maxLevel;
      box.fillStyle(COLORS.PANEL, 0.9).fillRoundedRect(-slot / 2, -slot / 2, slot, slot, 12);
      box
        .lineStyle(4, maxed ? COLORS.GOLD_LIGHT : rim, 1)
        .strokeRoundedRect(-slot / 2, -slot / 2, slot, slot, 12);
      cell.add(box);

      const img = this.makeIcon(icon, 0, -4, 48);
      cell.add(img);

      const lvl = this.add
        .text(slot / 2 - 6, slot / 2 - 6, maxed ? 'M' : `${level}`, {
          fontFamily: '"Press Start 2P", Galmuri11, monospace',
          fontSize: '16px',
          color: maxed ? '#f0d896' : '#e8e0d0',
          stroke: '#000000',
          strokeThickness: 4,
        })
        .setOrigin(1, 1)
        .setScrollFactor(0);
      cell.add(lvl);

      this.trayContainer.add(cell);
      x += slot + gap;
    };

    for (const w of this.state.weapons) {
      addSlot(w.icon, w.level, w.maxLevel, true);
    }
    for (const it of this.state.items) {
      addSlot(it.icon, it.level, it.maxLevel, false);
    }
  }

  /* --------------------------------------------------------------- */
  /* Small fx + helpers                                              */
  /* --------------------------------------------------------------- */

  private makeIcon(icon: IconRef, x: number, y: number, targetSize: number): Phaser.GameObjects.Image {
    let img: Phaser.GameObjects.Image;
    if (icon.frame >= 0) {
      img = this.add.image(x, y, icon.texture, icon.frame);
    } else {
      img = this.add.image(x, y, icon.texture);
    }
    const base = Math.max(img.width, img.height) || 16;
    img.setScale(targetSize / base).setScrollFactor(0);
    return img;
  }

  /** Quick scale bump used for counter updates. */
  private bump(obj: Phaser.GameObjects.Text): void {
    this.tweens.killTweensOf(obj);
    obj.setScale(1);
    this.tweens.add({
      targets: obj,
      scale: 1.3,
      duration: 90,
      yoyo: true,
      ease: 'Quad.Out',
    });
  }

  private pulseLevelBadge(): void {
    this.tweens.killTweensOf(this.levelBadgeText);
    this.levelBadgeText.setScale(1);
    this.tweens.add({
      targets: this.levelBadgeText,
      scale: 1.6,
      duration: 140,
      yoyo: true,
      ease: 'Back.Out',
    });
  }

  private buildPauseSummary(): PauseSummary {
    return {
      level: this.state.level,
      kills: this.state.kills,
      gold: this.state.gold,
      score: this.state.score,
      elapsedMs: this.state.elapsedMs,
      hp: this.state.hp,
      maxHp: this.state.maxHp,
      stats: this.getLiveStats(),
      weapons: this.state.weapons,
      items: this.state.items,
    };
  }

  /**
   * The live PlayerStats block for the pause panel. The GameScene keeps its
   * GameContext private, so read it structurally (same defensive shape as the
   * optional getHudSnapshot() call in create()); the object is shared by
   * reference across the game's systems, so it is always current at pause time.
   */
  private getLiveStats(): PlayerStats {
    const ctx = (this.gameScene as unknown as { ctx?: { stats?: PlayerStats } }).ctx;
    return ctx?.stats ?? { ...DEFAULT_STATS };
  }

  /** The selected character id for the portrait (from the GameScene's run). */
  private getCharacterId(): string {
    // GameScene exposes the run via getHudSnapshot only; characterId is not in
    // the snapshot, so read it off the scene's settings data if present.
    const data = this.gameScene?.scene?.settings?.data as { characterId?: string } | undefined;
    return data?.characterId ?? 'knight';
  }
}
