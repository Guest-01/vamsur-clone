import Phaser from 'phaser';
import { SHEET, TEXTURES } from '../config/assets';
import { COLORS, GAME, SCORE } from '../config/balance';
import { SCENES, REGISTRY } from '../types';
import { TextureFactory } from '../gfx/TextureFactory';

/**
 * Loads the CC0 dungeon spritesheet, generates all procedural textures, then
 * hands off to the menu. Shows an in-canvas progress bar during the (tiny) load.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SCENES.BOOT);
  }

  preload(): void {
    const { width, height } = this.scale;
    const cx = width / 2;
    const cy = height / 2;

    this.add.text(cx, cy - 40, '영원한 밤의 묘지', {
      fontFamily: 'Cinzel, "Noto Serif KR", serif',
      fontSize: '28px',
      color: '#c9a24b',
    }).setOrigin(0.5);

    const barW = 320;
    const barX = cx - barW / 2;
    const barY = cy + 10;
    const border = this.add.rectangle(cx, barY, barW + 6, 18, 0x000000, 0.6).setStrokeStyle(1, COLORS.PANEL_BORDER);
    const bar = this.add.rectangle(barX, barY, 1, 12, COLORS.GOLD).setOrigin(0, 0.5);

    this.load.on('progress', (p: number) => {
      bar.width = barW * p;
    });
    this.load.once('complete', () => {
      border.destroy();
      bar.destroy();
    });

    this.load.spritesheet(SHEET.KEY, SHEET.URL, {
      frameWidth: SHEET.FRAME_W,
      frameHeight: SHEET.FRAME_H,
      margin: 0,
      spacing: 0,
    });
  }

  create(): void {
    TextureFactory.generateAll(this);

    this.migrateScoreFormula();

    // remove the static HTML loader now that the canvas is live
    const loader = document.getElementById('boot-loader');
    if (loader) loader.style.display = 'none';

    // sanity-guard: ensure the sheet loaded (fallback handled by texture gen)
    if (!this.textures.exists(TEXTURES.SPRITES)) {
      this.add
        .text(GAME.WIDTH / 2, GAME.HEIGHT / 2, 'asset load failed', { color: '#ff4444' })
        .setOrigin(0.5);
    }

    this.scene.start(SCENES.MENU);
  }

  /**
   * One-time best-score migration. When the score formula is rescaled its
   * FORMULA_VERSION is bumped, and a record set under the old scale is no longer
   * comparable (an old ~50k victory could never be beaten by a new ~5k one). So
   * the first boot whose stored version is older wipes BEST_SCORE and stamps the
   * new version — after which the version matches and this never fires again, so
   * the record is reset exactly once, not every launch. BEST_TIME is untouched
   * (survival time didn't change scale). Runs at boot before the menu reads the
   * record; the in-memory registry mirror starts empty each page load, so
   * clearing localStorage alone is sufficient.
   */
  private migrateScoreFormula(): void {
    try {
      const raw = window.localStorage.getItem(REGISTRY.SCORE_FORMULA_VER);
      const stored = raw !== null ? parseInt(raw, 10) : 1; // absent = pre-versioning (v1)
      if (!Number.isFinite(stored) || stored < SCORE.FORMULA_VERSION) {
        window.localStorage.removeItem(REGISTRY.BEST_SCORE);
        window.localStorage.setItem(REGISTRY.SCORE_FORMULA_VER, String(SCORE.FORMULA_VERSION));
      }
    } catch {
      /* storage unavailable — nothing persisted, nothing to migrate */
    }
  }
}
