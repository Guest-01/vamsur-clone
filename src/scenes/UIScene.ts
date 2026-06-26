import Phaser from 'phaser';
import { SCENES, EVENTS } from '../types';
import type {
  UpgradeOption,
  OwnedWeaponView,
  OwnedItemView,
  IconRef,
} from '../types';
import { TEXTURES, FRAMES } from '../config/assets';
import { GAME, COLORS, DEPTH } from '../config/balance';
import { getCharacter } from '../content/characters';
import { LevelUpOverlay } from '../ui/LevelUpOverlay';
import { PauseOverlay } from '../ui/PauseOverlay';
import { HelpOverlay } from '../ui/HelpOverlay';
import type { PauseSummary } from '../ui/PauseOverlay';
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
  elapsedMs: number;
  weapons: OwnedWeaponView[];
  items: OwnedItemView[];
}

// Depth for the HUD layer — above gameplay/vignette, below the overlays.
const HUD_DEPTH = DEPTH.POPTEXT + 10;

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
    elapsedMs: 0,
    weapons: [],
    items: [],
  };

  // --- HUD elements ---
  private xpBarFill!: Phaser.GameObjects.Rectangle;
  private xpBarWidth = GAME.WIDTH; // full track width
  private levelBadgeText!: Phaser.GameObjects.Text;

  private timerText!: Phaser.GameObjects.Text;

  private hpBarFill!: Phaser.GameObjects.Rectangle;
  private hpBarMaxWidth = 300;
  private hpText!: Phaser.GameObjects.Text;
  private portrait!: Phaser.GameObjects.Image;

  private killsText!: Phaser.GameObjects.Text;
  private goldText!: Phaser.GameObjects.Text;

  private trayContainer!: Phaser.GameObjects.Container;

  private hitFlash!: Phaser.GameObjects.Rectangle;

  // --- tweens we keep handles to so they can be retargeted/cancelled ---
  private xpTween?: Phaser.Tweens.Tween;
  private hpTween?: Phaser.Tweens.Tween;

  // --- overlays ---
  private levelUpOverlay!: LevelUpOverlay;
  private pauseOverlay!: PauseOverlay;
  private helpOverlay!: HelpOverlay;

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
        x: { min: 0, max: GAME.WIDTH },
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

    this.add
      .image(0, 0, TEXTURES.VIGNETTE)
      .setOrigin(0, 0)
      .setDisplaySize(GAME.WIDTH, GAME.HEIGHT)
      .setScrollFactor(0)
      // sits just above the dust, still well below the HUD/overlays.
      .setDepth(3);

    this.buildHud();

    // Apply the initial snapshot to the freshly-built widgets (no animation).
    this.refreshXp(false);
    this.refreshHp(false);
    this.killsText.setText(`${this.state.kills}`);
    this.goldText.setText(`${this.state.gold}`);
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

    // Cleanly detach all listeners + DOM handlers when the scene stops.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown(gameEvents));
  }

  /* --------------------------------------------------------------- */
  /* Event wiring                                                    */
  /* --------------------------------------------------------------- */

  private subscribe(g: Phaser.Events.EventEmitter): void {
    g.on(EVENTS.HP_CHANGED, this.onHpChanged, this);
    g.on(EVENTS.XP_CHANGED, this.onXpChanged, this);
    g.on(EVENTS.KILLS_CHANGED, this.onKillsChanged, this);
    g.on(EVENTS.GOLD_CHANGED, this.onGoldChanged, this);
    g.on(EVENTS.TIMER, this.onTimer, this);
    g.on(EVENTS.WEAPONS_CHANGED, this.onWeaponsChanged, this);
    g.on(EVENTS.ITEMS_CHANGED, this.onItemsChanged, this);
    g.on(EVENTS.PLAYER_HIT, this.onPlayerHit, this);
    g.on(EVENTS.LEVEL_UP, this.onLevelUp, this);
    g.on(EVENTS.PAUSE_TOGGLED, this.onPauseToggled, this);
  }

  private teardown(g: Phaser.Events.EventEmitter): void {
    g.off(EVENTS.HP_CHANGED, this.onHpChanged, this);
    g.off(EVENTS.XP_CHANGED, this.onXpChanged, this);
    g.off(EVENTS.KILLS_CHANGED, this.onKillsChanged, this);
    g.off(EVENTS.GOLD_CHANGED, this.onGoldChanged, this);
    g.off(EVENTS.TIMER, this.onTimer, this);
    g.off(EVENTS.WEAPONS_CHANGED, this.onWeaponsChanged, this);
    g.off(EVENTS.ITEMS_CHANGED, this.onItemsChanged, this);
    g.off(EVENTS.PLAYER_HIT, this.onPlayerHit, this);
    g.off(EVENTS.LEVEL_UP, this.onLevelUp, this);
    g.off(EVENTS.PAUSE_TOGGLED, this.onPauseToggled, this);
    this.escKey?.removeAllListeners();
    this.levelUpOverlay?.destroy();
    this.pauseOverlay?.destroy();
    this.helpOverlay?.destroy();
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

  private onLevelUp(p: { level: number; options: UpgradeOption[] }): void {
    // Hide the pause overlay if somehow open; level-up takes priority.
    if (this.pauseOverlay.isVisible()) this.pauseOverlay.hide();
    this.levelUpOverlay.show(p.level, p.options);
  }

  private onPauseToggled(p: { paused: boolean }): void {
    if (p.paused) {
      this.pauseOpenedAt = this.time.now;
      this.pauseOverlay.show(this.buildPauseSummary());
    } else {
      this.pauseOverlay.hide();
    }
  }

  private onEsc(): void {
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
  }

  /** Full-width thin XP bar at the very top + a circular "Lv N" badge. */
  private buildXpBar(): void {
    const barH = 24;
    const y = barH / 2;

    // dark track
    const track = this.add
      .rectangle(0, 0, GAME.WIDTH, barH, COLORS.XP_BAR_DARK, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH);
    track.setStrokeStyle(0);

    // fill
    this.xpBarFill = this.add
      .rectangle(0, 0, GAME.WIDTH, barH, COLORS.XP_BAR, 1)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);

    // a brighter top highlight line for a glassy feel
    this.add
      .rectangle(0, 0, GAME.WIDTH, 4, 0xffffff, 0.22)
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
        fontFamily: '"Press Start 2P"',
        fontSize: '16px',
        color: '#c9a24b',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 2);
    void lvLabel;

    this.levelBadgeText = this.add
      .text(badgeX, badgeY + 8, `${this.state.level}`, {
        fontFamily: '"Press Start 2P"',
        fontSize: '24px',
        color: '#f0d896',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 2);

    void track;
  }

  /** Large mm:ss timer centred just below the XP bar. */
  private buildTimer(): void {
    this.timerText = this.add
      .text(GAME.WIDTH / 2, 60, '00:00', {
        fontFamily: '"Press Start 2P"',
        fontSize: '40px',
        color: '#e8e0d0',
        stroke: '#000000',
        strokeThickness: 8,
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
        fontFamily: '"Press Start 2P"',
        fontSize: '16px',
        color: '#e24b58',
      })
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);

    // cur/max text centred over the bar.
    this.hpText = this.add
      .text(barX + this.hpBarMaxWidth / 2, barY + barH / 2, '100 / 100', {
        fontFamily: '"Press Start 2P"',
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

  /** Top-right: kills (skull) and gold (coin) counters. */
  private buildTopRight(): void {
    const rightX = GAME.WIDTH - 32;
    const topY = 44;

    // panel behind the counters
    const panelW = 280;
    const panelH = 112;
    const panel = this.add.graphics().setScrollFactor(0).setDepth(HUD_DEPTH);
    panel
      .fillStyle(COLORS.PANEL, 0.85)
      .fillRoundedRect(rightX - panelW, topY, panelW, panelH, 12);
    panel
      .lineStyle(4, COLORS.PANEL_BORDER, 1)
      .strokeRoundedRect(rightX - panelW, topY, panelW, panelH, 12);

    const iconX = rightX - panelW + 44;

    // kills row — skull glyph (text) + count.
    const skull = this.add
      .text(iconX, topY + 32, '☠', {
        fontFamily: 'serif',
        fontSize: '36px',
        color: '#e8e0d0',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);
    void skull;

    this.killsText = this.add
      .text(iconX + 36, topY + 32, '0', {
        fontFamily: '"Press Start 2P"',
        fontSize: '24px',
        color: '#e8e0d0',
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);

    // gold row — coin sprite (sheet frame) + count.
    const coin = this.add
      .image(iconX, topY + 80, TEXTURES.SPRITES, FRAMES.COINS)
      .setScale(2.8)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);
    void coin;

    this.goldText = this.add
      .text(iconX + 36, topY + 80, '0', {
        fontFamily: '"Press Start 2P"',
        fontSize: '24px',
        color: '#f0d896',
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 1);
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
    this.hitFlash = this.add
      .rectangle(GAME.WIDTH / 2, GAME.HEIGHT / 2, GAME.WIDTH, GAME.HEIGHT, COLORS.BLOOD, 1)
      .setScrollFactor(0)
      .setDepth(HUD_DEPTH + 5)
      .setAlpha(0);
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
          fontFamily: '"Press Start 2P"',
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
      elapsedMs: this.state.elapsedMs,
      hp: this.state.hp,
      maxHp: this.state.maxHp,
      weapons: this.state.weapons,
      items: this.state.items,
    };
  }

  /** The selected character id for the portrait (from the GameScene's run). */
  private getCharacterId(): string {
    // GameScene exposes the run via getHudSnapshot only; characterId is not in
    // the snapshot, so read it off the scene's settings data if present.
    const data = this.gameScene?.scene?.settings?.data as { characterId?: string } | undefined;
    return data?.characterId ?? 'knight';
  }
}
