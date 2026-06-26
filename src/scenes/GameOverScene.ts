import Phaser from 'phaser';

import { SCENES, REGISTRY } from '../types';
import type { IconRef, OwnedWeaponView, OwnedItemView, RunSummary } from '../types';
import { TEXTURES } from '../config/assets';
import { COLORS, GAME, DEPTH, ENTITY_SCALE } from '../config/balance';
import { formatTime } from './MenuScene';

/** Convert a 0xRRGGBB number into a `#rrggbb` css string for canvas text. */
function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
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
  /** Whether this run set a new best survival time (defeat runs only). */
  private newBest = false;

  constructor() {
    super(SCENES.GAME_OVER);
  }

  init(data: { summary: RunSummary }): void {
    this.summary = data.summary;
    this.newBest = this.recordBest(this.summary);
  }

  create(): void {
    const W = GAME.WIDTH;
    const H = GAME.HEIGHT;
    const s = this.summary;

    this.buildBackdrop(W, H);

    // central panel
    const pw = 1120;
    const ph = 820;
    this.add
      .rectangle(W / 2, H / 2, pw, ph, COLORS.PANEL, 0.96)
      .setStrokeStyle(6, COLORS.PANEL_BORDER)
      .setDepth(DEPTH.POPTEXT);

    this.buildHeadline(W, s.victory);
    this.buildStats(W, s);
    this.buildBuild(W, s);
    this.buildButtons(W, s);

    this.bindInput();
    this.cameras.main.fadeIn(450, 0, 0, 0);
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

  private buildHeadline(W: number, victory: boolean): void {
    const top = GAME.HEIGHT / 2 - 400 + 28;
    const title = victory ? 'YOU SURVIVED' : 'YOU DIED';
    const color = victory ? COLORS.GOLD_LIGHT : COLORS.BLOOD_LIGHT;

    const headline = this.add
      .text(W / 2, top + 36, title, {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '92px',
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

    this.add
      .text(W / 2, top + 100, victory ? '영원한 밤을 견뎌냈다' : '어둠에 삼켜졌다', {
        fontFamily: 'Cinzel, serif',
        fontSize: '28px',
        color: hex(COLORS.PARCHMENT),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT)
      .setAlpha(0.85);
  }

  /* ---------------------------- stats ----------------------------- */

  private buildStats(W: number, s: RunSummary): void {
    const cy = GAME.HEIGHT / 2 - 156;

    // Time — highlighted gold if it is a new best record.
    const timeColor = this.newBest ? COLORS.GOLD_LIGHT : COLORS.BONE;
    const timeLabel = this.add
      .text(W / 2, cy, formatTime(s.timeMs), {
        fontFamily: 'Press Start 2P, monospace',
        fontSize: '52px',
        color: hex(timeColor),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT);

    if (this.newBest) {
      const tag = this.add
        .text(W / 2, cy + 48, '★ 신기록 ★', {
          fontFamily: 'Cinzel, serif',
          fontStyle: '700',
          fontSize: '26px',
          color: hex(COLORS.GOLD),
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.POPTEXT);
      this.tweens.add({
        targets: [timeLabel, tag],
        scale: { from: 1, to: 1.06 },
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
    }

    // three stat columns: Level / Kills / Gold
    const row = cy + 104;
    const cols: Array<{ label: string; value: string; color: number }> = [
      { label: 'LEVEL', value: `${s.level}`, color: COLORS.XP_BAR },
      { label: 'KILLS', value: `${s.kills}`, color: COLORS.BLOOD_LIGHT },
      { label: 'GOLD', value: `${s.gold}`, color: COLORS.GOLD },
    ];
    const spread = 300;
    cols.forEach((c, i) => {
      const x = W / 2 + (i - 1) * spread;
      this.add
        .text(x, row, c.label, {
          fontFamily: 'Press Start 2P, monospace',
          fontSize: '18px',
          color: hex(COLORS.TEXT_DIM),
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.POPTEXT);
      this.add
        .text(x, row + 44, c.value, {
          fontFamily: 'Press Start 2P, monospace',
          fontSize: '32px',
          color: hex(c.color),
        })
        .setOrigin(0.5)
        .setDepth(DEPTH.POPTEXT);
    });
  }

  /* --------------------------- the build -------------------------- */

  private buildBuild(W: number, s: RunSummary): void {
    const cy = GAME.HEIGHT / 2 + 72;

    this.add
      .text(W / 2, cy - 36, '획득한 장비', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '24px',
        color: hex(COLORS.TEXT_DIM),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT);

    // weapons first, then items — one combined row of framed icon slots
    const entries: Array<OwnedWeaponView | OwnedItemView> = [...s.weapons, ...s.items];
    if (entries.length === 0) return;

    const slot = 92;
    const gap = 16;
    const perRow = Math.min(entries.length, 10);
    const rowW = perRow * slot + (perRow - 1) * gap;
    const startX = W / 2 - rowW / 2 + slot / 2;
    const rowY = cy + 32;

    entries.forEach((e, i) => {
      const col = i % perRow;
      const rowN = Math.floor(i / perRow);
      const x = startX + col * (slot + gap);
      const y = rowY + rowN * (slot + gap);

      // framed slot
      this.add
        .rectangle(x, y, slot, slot, COLORS.PANEL_LIGHT, 1)
        .setStrokeStyle(4, COLORS.PANEL_BORDER)
        .setDepth(DEPTH.POPTEXT);

      const icon = this.add.image(x, y - 6, TEXTURES.PIXEL).setDepth(DEPTH.POPTEXT);
      this.applyIcon(icon, e.icon, ENTITY_SCALE * 2.8);

      // level / max pip
      this.add
        .text(x + slot / 2 - 6, y + slot / 2 - 6, `${e.level}/${e.maxLevel}`, {
          fontFamily: 'Press Start 2P, monospace',
          fontSize: '16px',
          color: e.level >= e.maxLevel ? hex(COLORS.GOLD_LIGHT) : hex(COLORS.BONE),
        })
        .setOrigin(1, 1)
        .setDepth(DEPTH.POPTEXT + 1);
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
      this.transition(() => this.scene.start(SCENES.GAME, { characterId: s.characterId }));
    });
    this.makeButton(W / 2 + 192, by, '메뉴로', COLORS.PANEL_BORDER, () => {
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
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '34px',
        color: hex(COLORS.BONE),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT + 1);

    bg.on('pointerover', () => {
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
    // ENTER = retry
    kb.on('keydown-ENTER', () => {
      this.transition(() => this.scene.start(SCENES.GAME, { characterId: this.summary.characterId }));
    });
    // ESC = back to menu
    kb.on('keydown-ESC', () => {
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
}
