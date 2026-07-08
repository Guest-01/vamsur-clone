import Phaser from 'phaser';

import { SCENES, REGISTRY } from '../types';
import type { IconRef, OwnedWeaponView, OwnedItemView, RunSummary } from '../types';
import { TEXTURES } from '../config/assets';
import { COLORS, GAME, DEPTH, ENTITY_SCALE } from '../config/balance';
import { formatTime } from './MenuScene';
import { Sound } from '../audio/Sound';

/** Convert a 0xRRGGBB number into a `#rrggbb` css string for canvas text. */
function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

/** Compact damage total for the per-weapon chart ("12.4k", "1.2M"). */
function fmtDamage(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

/**
 * GameOverScene — the end-of-run results screen.
 *
 * Receives a {@link RunSummary} via `init`, shows victory/defeat headline, the
 * run stats (with a "new best" highlight on the time), the acquired build as a
 * row of weapon + item icons with their levels, and Retry / Menu buttons.
 */
export class GameOverScene extends Phaser.Scene {
  private summary!: RunSummary;
  /** Whether this run set a new best survival time. */
  private newBest = false;
  /** Whether this run set a new best score. */
  private newBestScore = false;
  /** live width captured at build time; used to throttle resize restarts. */
  private lastW = 0;

  constructor() {
    super(SCENES.GAME_OVER);
  }

  init(data: { summary: RunSummary }): void {
    this.summary = data.summary;
    this.newBest = this.recordBest(this.summary);
    this.newBestScore = this.recordBestScore(this.summary);
  }

  create(): void {
    const W = this.scale.width; // live (landscape-responsive) width
    const H = GAME.HEIGHT; // fixed design height (1080)
    const s = this.summary;
    this.lastW = W;

    this.buildBackdrop(W, H);

    // central panel — two-column body (records left, gear right), same 1420
    // width idiom as the pause panel.
    const pw = 1420;
    const ph = 780;
    this.add
      .rectangle(W / 2, H / 2, pw, ph, COLORS.PANEL, 0.96)
      .setStrokeStyle(6, COLORS.PANEL_BORDER)
      .setDepth(DEPTH.POPTEXT);

    this.buildHeadline(W, s);
    this.buildRecords(W / 2 - 330, s);
    this.buildGear(W / 2 + 330, s);
    this.buildButtons(W, s);

    this.bindInput();

    // Landscape-responsive: restart re-centers the results for the new width
    // (rotation / resize). The best-time record was already persisted in init().
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    });

    this.cameras.main.fadeIn(450, 0, 0, 0);
  }

  /** Restart to re-center for the new width (guarded against resize thrash). */
  private onResize(): void {
    if (Math.abs(this.scale.width - this.lastW) > 1) {
      this.lastW = this.scale.width;
      this.scene.restart();
    }
  }

  /* --------------------------- backdrop --------------------------- */

  private buildBackdrop(W: number, H: number): void {
    this.add
      .tileSprite(0, 0, W, H, TEXTURES.BG_TILE)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.BG)
      .setAlpha(0.6);

    // dark wash so the panel reads clearly
    this.add.rectangle(0, 0, W, H, 0x000000, 0.55).setOrigin(0, 0).setDepth(DEPTH.BG + 1);

    this.add
      .image(W / 2, H / 2, TEXTURES.VIGNETTE)
      .setDisplaySize(W, H)
      .setScrollFactor(0)
      .setDepth(DEPTH.VIGNETTE);
  }

  /* --------------------------- headline --------------------------- */

  private buildHeadline(W: number, s: RunSummary): void {
    const top = GAME.HEIGHT / 2 - 390 + 30;
    const title = s.victory ? 'YOU SURVIVED' : 'YOU DIED';
    const color = s.victory ? COLORS.GOLD_LIGHT : COLORS.BLOOD_LIGHT;

    const headline = this.add
      .text(W / 2, top + 36, title, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '84px',
        color: hex(color),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT)
      .setShadow(0, 6, '#000000', 20, true, true);

    // entrance pop
    headline.setScale(0.6).setAlpha(0);
    this.tweens.add({
      targets: headline,
      scale: 1,
      alpha: 1,
      duration: 520,
      ease: 'Back.out',
    });
    // living pulse afterwards
    this.tweens.add({
      targets: headline,
      alpha: { from: 1, to: 0.85 },
      delay: 600,
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    // flavour + (hard mode) the curse badge, merged into a single line so the
    // headline zone stays two rows tall.
    const flavour = s.victory ? '영원한 밤을 견뎌냈다' : '어둠에 삼켜졌다';
    const subtitle = s.curse > 0 ? `${flavour}  ·  ☠ 저주 계약 ${s.curse}단계` : flavour;
    this.add
      .text(W / 2, top + 100, subtitle, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontSize: '26px',
        color: hex(s.curse > 0 ? 0xb794e0 : COLORS.PARCHMENT),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT)
      .setAlpha(0.9);
  }

  /* ---------------------------- stats ----------------------------- */

  /** Left column — score (hero number), breakdown, time, level/kills/gold. */
  private buildRecords(lx: number, s: RunSummary): void {
    const H2 = GAME.HEIGHT / 2;

    // Score — the run's ONE hero number.
    const scoreLabel = this.add
      .text(lx, H2 - 150, `SCORE ${s.score.toLocaleString()}${this.newBestScore ? ' ★' : ''}`, {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '38px',
        color: hex(this.newBestScore ? COLORS.GOLD_LIGHT : COLORS.GOLD),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT);
    if (this.newBestScore) {
      this.tweens.add({
        targets: scoreLabel,
        scale: { from: 1, to: 1.06 },
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }

    // Breakdown — terms on one line, the curse multiplier on its own.
    const b = s.scoreBreakdown;
    let detail = `생존 ${b.timePts.toLocaleString()} + 처치 ${b.killPts.toLocaleString()} + 레벨 ${b.levelPts.toLocaleString()}`;
    if (b.victoryPts > 0) detail += ` + 승리 ${b.victoryPts.toLocaleString()}`;
    this.add
      .text(lx, H2 - 104, detail, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '18px',
        color: hex(COLORS.TEXT_DIM),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT);
    if (b.curseMult > 1) {
      this.add
        .text(lx, H2 - 76, `× ${b.curseMult.toFixed(2)} (저주 계약 보정)`, {
          fontFamily: 'Cinzel, "Noto Serif KR", serif',
          fontStyle: '700',
          fontSize: '18px',
          color: '#b794e0',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.POPTEXT);
    }

    // Survival time.
    const timeLabel = this.add
      .text(lx, H2 - 22, `생존 ${formatTime(s.timeMs)}${this.newBest ? ' ★' : ''}`, {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '30px',
        color: hex(this.newBest ? COLORS.GOLD_LIGHT : COLORS.BONE),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT);
    if (this.newBest) {
      this.tweens.add({
        targets: timeLabel,
        scale: { from: 1, to: 1.06 },
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }

    // divider
    this.add
      .rectangle(lx, H2 + 22, 560, 2, COLORS.PANEL_BORDER, 1)
      .setDepth(DEPTH.POPTEXT);

    // three stat columns: Level / Kills / Gold
    const cols: Array<{ label: string; value: string; color: number }> = [
      { label: 'LEVEL', value: `${s.level}`, color: COLORS.XP_BAR },
      { label: 'KILLS', value: `${s.kills}`, color: COLORS.BLOOD_LIGHT },
      { label: 'GOLD', value: `${s.gold}`, color: COLORS.GOLD },
    ];
    const spread = 210;
    cols.forEach((c, i) => {
      const x = lx + (i - 1) * spread;
      this.add
        .text(x, H2 + 60, c.label, {
          fontFamily: '"Press Start 2P", Galmuri11, monospace',
          fontSize: '16px',
          color: hex(COLORS.TEXT_DIM),
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.POPTEXT);
      this.add
        .text(x, H2 + 100, c.value, {
          fontFamily: '"Press Start 2P", Galmuri11, monospace',
          fontSize: '28px',
          color: hex(c.color),
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.POPTEXT);
    });
  }

  /* --------------------------- the build -------------------------- */

  /** Right column — the acquired build (icon grid) + top damage contributors. */
  private buildGear(rx: number, s: RunSummary): void {
    const H2 = GAME.HEIGHT / 2;

    this.add
      .text(rx, H2 - 184, '획득한 장비', {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '24px',
        color: hex(COLORS.TEXT_DIM),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT);

    // weapons first, then items — a fixed 6-per-row grid (max 12 slots total,
    // so two rows can never spill into the damage chart below)
    const entries: Array<OwnedWeaponView | OwnedItemView> = [...s.weapons, ...s.items];
    const slot = 84;
    const gap = 14;
    const perRow = 6;
    const rowW = perRow * slot + (perRow - 1) * gap;
    const startX = rx - rowW / 2 + slot / 2;
    const rowY = H2 - 126;
    const rowPitch = slot + gap;

    entries.forEach((e, i) => {
      const col = i % perRow;
      const rowN = Math.floor(i / perRow);
      const x = startX + col * (slot + gap);
      const y = rowY + rowN * rowPitch;

      // framed slot
      this.add
        .rectangle(x, y, slot, slot, COLORS.PANEL_LIGHT, 1)
        .setStrokeStyle(4, COLORS.PANEL_BORDER)
        .setDepth(DEPTH.POPTEXT);

      const icon = this.add.image(x, y - 2, TEXTURES.PIXEL).setDepth(DEPTH.POPTEXT);
      this.applyIcon(icon, e.icon, ENTITY_SCALE * 2.4);

      // level / max pip, on a small backing chip so it stays legible over any icon
      const pipText = this.add
        .text(0, 0, `${e.level}/${e.maxLevel}`, {
          fontFamily: '"Press Start 2P", Galmuri11, monospace',
          fontSize: '14px',
          color: e.level >= e.maxLevel ? hex(COLORS.GOLD_LIGHT) : hex(COLORS.BONE),
        })
        .setOrigin(1, 1)
        .setDepth(DEPTH.POPTEXT + 1);
      const chipX = x + slot / 2 - 2;
      const chipY = y + slot / 2 - 2;
      this.add
        .rectangle(chipX, chipY, pipText.width + 10, pipText.height + 4, 0x0a0a12, 0.82)
        .setOrigin(1, 1)
        .setDepth(DEPTH.POPTEXT);
      pipText.setPosition(chipX - 5, chipY - 2);
    });

    // Damage contribution — a ranked horizontal bar chart of the top weapons,
    // separated from the grid so slots stay clean and rows can't collide.
    const top = s.weaponDamage.slice(0, 4);
    if (top.length === 0) return;
    const maxDmg = top[0].total || 1;

    this.add
      .text(rx, H2 + 64, '피해 기여', {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '24px',
        color: hex(COLORS.TEXT_DIM),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT);

    const barX = rx - 250; // track left edge (icon sits left of it)
    const barMaxW = 430;
    top.forEach((d, i) => {
      const y = H2 + 108 + i * 38;

      const icon = this.add.image(rx - 292, y, TEXTURES.PIXEL).setDepth(DEPTH.POPTEXT);
      this.applyIcon(icon, d.icon, 1.7);

      this.add
        .rectangle(barX, y, barMaxW, 16, 0x0a0a12, 0.9)
        .setOrigin(0, 0.5)
        .setStrokeStyle(1, COLORS.PANEL_BORDER)
        .setDepth(DEPTH.POPTEXT);
      const frac = Phaser.Math.Clamp(d.total / maxDmg, 0, 1);
      this.add
        .rectangle(barX + 1, y, Math.max(3, (barMaxW - 2) * frac), 12, COLORS.GOLD, 1)
        .setOrigin(0, 0.5)
        .setDepth(DEPTH.POPTEXT + 1);

      this.add
        .text(rx + 296, y, fmtDamage(d.total), {
          fontFamily: '"Press Start 2P", Galmuri11, monospace',
          fontSize: '14px',
          color: hex(COLORS.BONE),
        })
        .setOrigin(1, 0.5)
        .setDepth(DEPTH.POPTEXT);
    });
  }

  /**
   * Point an Image at an IconRef. `icon.frame === -1` means a standalone
   * generated texture (no frame); otherwise it is a dungeon-sheet frame.
   */
  private applyIcon(img: Phaser.GameObjects.Image, icon: IconRef, sheetScale: number): void {
    if (icon.frame === -1) {
      img.setTexture(icon.texture);
      img.setScale((sheetScale * 16) / Math.max(img.width, 1));
    } else {
      img.setTexture(icon.texture, icon.frame);
      img.setScale(sheetScale);
    }
  }

  /* --------------------------- buttons ---------------------------- */

  private buildButtons(W: number, s: RunSummary): void {
    const by = GAME.HEIGHT / 2 + 316;
    this.makeButton(W / 2 - 192, by, '다시 도전', COLORS.GOLD, () => {
      Sound.play('uiConfirm');
      this.transition(() =>
        this.scene.start(SCENES.GAME, { characterId: s.characterId, curse: s.curse })
      );
    });
    this.makeButton(W / 2 + 192, by, '메뉴로', COLORS.PANEL_BORDER, () => {
      Sound.play('uiClick');
      this.transition(() => this.scene.start(SCENES.MENU));
    });
  }

  /** A reusable gothic button with hover state. */
  private makeButton(
    x: number,
    y: number,
    label: string,
    accent: number,
    onClick: () => void
  ): void {
    const w = 336;
    const h = 88;
    const bg = this.add
      .rectangle(x, y, w, h, COLORS.PANEL_LIGHT, 1)
      .setStrokeStyle(4, accent)
      .setDepth(DEPTH.POPTEXT)
      .setInteractive({ useHandCursor: true });

    const txt = this.add
      .text(x, y, label, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '34px',
        color: hex(COLORS.BONE),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT + 1);

    bg.on('pointerover', () => {
      Sound.play('uiHover');
      bg.setFillStyle(accent, 0.28);
      bg.setScale(1.05);
      txt.setScale(1.05);
      txt.setColor(hex(COLORS.GOLD_LIGHT));
    });
    bg.on('pointerout', () => {
      bg.setFillStyle(COLORS.PANEL_LIGHT, 1);
      bg.setScale(1);
      txt.setScale(1);
      txt.setColor(hex(COLORS.BONE));
    });
    bg.on('pointerdown', onClick);
  }

  /* --------------------------- input ------------------------------ */

  private bindInput(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    // ENTER = retry (same character AND same curse level)
    kb.on('keydown-ENTER', () => {
      Sound.play('uiConfirm');
      this.transition(() =>
        this.scene.start(SCENES.GAME, {
          characterId: this.summary.characterId,
          curse: this.summary.curse,
        })
      );
    });
    // ESC = back to menu
    kb.on('keydown-ESC', () => {
      Sound.play('uiClick');
      this.transition(() => this.scene.start(SCENES.MENU));
    });
  }

  /* -------------------------- transition -------------------------- */

  private transition(go: () => void): void {
    this.input.enabled = false;
    this.cameras.main.fadeOut(280, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, go);
  }

  /* ---------------------------- best ------------------------------ */

  /**
   * Persist the best survival time. Returns true if this run beat the record.
   * Stored both in the Phaser registry (fast) and localStorage (durable).
   */
  private recordBest(s: RunSummary): boolean {
    let prev = 0;
    const reg = this.registry.get(REGISTRY.BEST_TIME);
    if (typeof reg === 'number') prev = reg;
    if (prev <= 0) {
      try {
        const raw = window.localStorage.getItem(REGISTRY.BEST_TIME);
        const n = raw ? parseInt(raw, 10) : 0;
        if (Number.isFinite(n)) prev = n;
      } catch {
        /* ignore unavailable storage */
      }
    }

    if (s.timeMs > prev) {
      this.registry.set(REGISTRY.BEST_TIME, s.timeMs);
      try {
        window.localStorage.setItem(REGISTRY.BEST_TIME, String(Math.floor(s.timeMs)));
      } catch {
        /* ignore unavailable storage */
      }
      return prev > 0; // only flag a "new best" if there was a prior record to beat
    }
    return false;
  }

  /** Same pattern as recordBest, for the run score. */
  private recordBestScore(s: RunSummary): boolean {
    let prev = 0;
    const reg = this.registry.get(REGISTRY.BEST_SCORE);
    if (typeof reg === 'number') prev = reg;
    if (prev <= 0) {
      try {
        const raw = window.localStorage.getItem(REGISTRY.BEST_SCORE);
        const n = raw ? parseInt(raw, 10) : 0;
        if (Number.isFinite(n)) prev = n;
      } catch {
        /* ignore unavailable storage */
      }
    }

    if (s.score > prev) {
      this.registry.set(REGISTRY.BEST_SCORE, s.score);
      try {
        window.localStorage.setItem(REGISTRY.BEST_SCORE, String(Math.floor(s.score)));
      } catch {
        /* ignore unavailable storage */
      }
      return prev > 0;
    }
    return false;
  }
}
