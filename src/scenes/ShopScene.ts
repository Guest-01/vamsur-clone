import Phaser from 'phaser';

import { SCENES } from '../types';
import type { IconRef } from '../types';
import { TEXTURES, FRAMES } from '../config/assets';
import { COLORS, GAME, DEPTH, ENTITY_SCALE } from '../config/balance';
import { POWERUPS } from '../content/powerups';
import { CHARACTERS } from '../content/characters';
import { WEAPONS } from '../content/weapons';
import { MetaState } from '../state/MetaState';

/** Convert a 0xRRGGBB number into a `#rrggbb` css string for canvas text. */
function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

/** One unlockable entry (character or weapon) shown in the UNLOCKS section. */
interface UnlockEntry {
  kind: 'char' | 'weapon';
  id: string;
  name: string;
  icon: IconRef;
  cost: number;
}

/**
 * ShopScene — the persistent meta shop.
 *
 * Spend banked gold (see {@link MetaState}) on permanent power-up levels and on
 * unlocking the expansion characters / weapons. Same gothic look as the menu:
 * tiled floor + vignette, Cinzel headings, framed panels and gold accents.
 * Purchases rebuild the dynamic content so levels / costs / affordability all
 * update immediately.
 */
export class ShopScene extends Phaser.Scene {
  /** Container holding everything rebuilt on each purchase. */
  private content!: Phaser.GameObjects.Container;
  /** Live banked-gold amount label (top-right). */
  private goldText!: Phaser.GameObjects.Text;

  constructor() {
    super(SCENES.SHOP);
  }

  create(): void {
    MetaState.load();
    const W = GAME.WIDTH;
    const H = GAME.HEIGHT;

    this.buildBackdrop(W, H);
    this.buildTitle(W);
    this.buildGold(W);
    this.buildBackButton(W, H);

    this.content = this.add
      .container(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT);

    this.rebuild();
    this.refreshGold();
    this.bindInput();

    this.cameras.main.fadeIn(350, 7, 7, 12);
  }

  /* --------------------------- backdrop --------------------------- */

  private buildBackdrop(W: number, H: number): void {
    this.add
      .tileSprite(0, 0, W, H, TEXTURES.BG_TILE)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.BG);

    // dark wash so the many framed cells read clearly over the floor
    this.add
      .rectangle(0, 0, W, H, 0x05040a, 0.5)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.BG + 1);

    this.add
      .image(W / 2, H / 2, TEXTURES.VIGNETTE)
      .setDisplaySize(W, H)
      .setScrollFactor(0)
      .setDepth(DEPTH.VIGNETTE);
  }

  /* ----------------------------- title ---------------------------- */

  private buildTitle(W: number): void {
    this.add
      .text(W / 2, 72, '상점', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '60px',
        color: hex(COLORS.GOLD_LIGHT),
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT)
      .setShadow(0, 5, '#000000', 14, true, true);

    this.add
      .text(W / 2, 124, '쌓아둔 골드로 영구 강화를 구입하고 새 영웅·무기를 해금하라', {
        fontFamily: 'Cinzel, serif',
        fontSize: '22px',
        color: hex(COLORS.PARCHMENT),
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT)
      .setAlpha(0.82);
  }

  /* ------------------------- banked gold -------------------------- */

  private buildGold(W: number): void {
    this.add
      .image(W - 184, 72, TEXTURES.SPRITES, FRAMES.COINS)
      .setScale(ENTITY_SCALE * 1.7)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT);

    this.goldText = this.add
      .text(W - 154, 72, '0', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '36px',
        color: hex(COLORS.GOLD_LIGHT),
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT);
  }

  /** Refresh the banked-gold readout (call after every purchase). */
  private refreshGold(): void {
    this.goldText.setText(`${MetaState.gold}`);
  }

  /** Brief red flash on the gold readout to signal "not enough gold". */
  private denyFeedback(): void {
    this.goldText.setColor(hex(COLORS.BLOOD_LIGHT));
    this.tweens.add({
      targets: this.goldText,
      scale: { from: 1, to: 1.12 },
      duration: 110,
      yoyo: true,
      ease: 'Sine.inOut',
      onComplete: () => this.goldText.setColor(hex(COLORS.GOLD_LIGHT)),
    });
  }

  /* ----------------------- dynamic content ------------------------ */

  /** Destroy and redraw the power-up grid + unlock list. */
  private rebuild(): void {
    this.content.removeAll(true);
    const W = GAME.WIDTH;

    this.sectionHeader(W, '강화  (POWER-UPS)', 158);
    this.buildPowerups(W);

    this.sectionHeader(W, '해금  (UNLOCKS)', 646);
    this.buildUnlocks(W, 646);
  }

  /** A left-aligned section heading with an underline, in the content layer. */
  private sectionHeader(W: number, label: string, y: number): void {
    const left = 56;
    const header = this.add
      .text(left, y, label, {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '32px',
        color: hex(COLORS.GOLD),
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT);
    const line = this.add
      .rectangle(left, y + 26, W - left * 2, 2, COLORS.PANEL_BORDER, 1)
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT);
    this.content.add([header, line]);
  }

  /* --------------------------- power-ups -------------------------- */

  private buildPowerups(W: number): void {
    const defs = Object.values(POWERUPS);
    const cols = 4;
    const cellW = 440;
    const cellH = 120;
    const colGap = 24;
    const rowGap = 22;
    const totalW = cols * cellW + (cols - 1) * colGap;
    const startX = W / 2 - totalW / 2 + cellW / 2;
    const gridTop = 196;

    defs.forEach((def, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = startX + col * (cellW + colGap);
      const cy = gridTop + cellH / 2 + row * (cellH + rowGap);
      this.buildPowerupCell(def, cx, cy, cellW, cellH);
    });
  }

  private buildPowerupCell(
    def: (typeof POWERUPS)[string],
    cx: number,
    cy: number,
    cellW: number,
    cellH: number
  ): void {
    const level = MetaState.getPowerupLevel(def.id);
    const cost = MetaState.powerupCost(def.id);
    const maxed = cost === null;
    const affordable = cost !== null && MetaState.gold >= cost;

    const panel = this.add
      .rectangle(cx, cy, cellW, cellH, COLORS.PANEL, 0.92)
      .setStrokeStyle(3, COLORS.PANEL_BORDER)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT);
    this.content.add(panel);

    // icon (left)
    const icon = this.add
      .image(cx - cellW / 2 + 52, cy, TEXTURES.PIXEL)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);
    this.applyIcon(icon, def.icon, ENTITY_SCALE * 2.6);
    this.content.add(icon);

    const textLeft = cx - cellW / 2 + 98;

    const name = this.add
      .text(textLeft, cy - 34, def.name, {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '24px',
        color: hex(maxed ? COLORS.GOLD_LIGHT : COLORS.BONE),
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);

    const lvl = this.add
      .text(textLeft, cy + 2, `Lv ${level}/${def.maxLevel}`, {
        fontFamily: 'Cinzel, serif',
        fontSize: '19px',
        color: hex(COLORS.PARCHMENT),
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);
    this.content.add([name, lvl]);

    // pips
    this.buildPips(textLeft, cy + 32, level, def.maxLevel);

    // cost / MAX (right)
    if (maxed) {
      const max = this.add
        .text(cx + cellW / 2 - 28, cy, 'MAX', {
          fontFamily: 'Cinzel, serif',
          fontStyle: '700',
          fontSize: '28px',
          color: hex(COLORS.GOLD_LIGHT),
        })
        .setOrigin(1, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH.POPTEXT + 1);
      this.content.add(max);
    } else {
      const coin = this.add
        .image(cx + cellW / 2 - 96, cy, TEXTURES.SPRITES, FRAMES.COINS)
        .setScale(ENTITY_SCALE * 0.95)
        .setScrollFactor(0)
        .setDepth(DEPTH.POPTEXT + 1);
      const costTxt = this.add
        .text(cx + cellW / 2 - 76, cy, `${cost}`, {
          fontFamily: 'Cinzel, serif',
          fontStyle: '700',
          fontSize: '26px',
          color: hex(affordable ? COLORS.GOLD_LIGHT : COLORS.BLOOD_LIGHT),
        })
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH.POPTEXT + 1);
      coin.setAlpha(affordable ? 1 : 0.5);
      this.content.add([coin, costTxt]);
    }

    // hit area over the whole cell
    const zone = this.add
      .zone(cx, cy, cellW, cellH)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: !maxed });
    zone.on('pointerover', () => panel.setStrokeStyle(3, COLORS.GOLD));
    zone.on('pointerout', () => panel.setStrokeStyle(3, COLORS.PANEL_BORDER));
    zone.on('pointerdown', () => this.tryBuyPowerup(def.id));
    this.content.add(zone);
  }

  /** Row of `max` level pips (filled = owned) starting at left edge x. */
  private buildPips(x: number, y: number, level: number, max: number): void {
    const pw = 16;
    const ph = 9;
    const gap = 5;
    for (let i = 0; i < max; i++) {
      const filled = i < level;
      const pip = this.add
        .rectangle(x + i * (pw + gap), y, pw, ph, filled ? COLORS.GOLD : COLORS.PANEL_LIGHT, 1)
        .setOrigin(0, 0.5)
        .setStrokeStyle(1, COLORS.PANEL_BORDER)
        .setScrollFactor(0)
        .setDepth(DEPTH.POPTEXT + 1);
      this.content.add(pip);
    }
  }

  private tryBuyPowerup(id: string): void {
    if (MetaState.buyPowerup(id)) {
      this.rebuild();
      this.refreshGold();
    } else {
      this.denyFeedback();
    }
  }

  /* ---------------------------- unlocks --------------------------- */

  private buildUnlocks(W: number, headerY: number): void {
    const entries: UnlockEntry[] = [];

    for (const c of CHARACTERS) {
      if (MetaState.isCharacterUnlocked(c.id)) continue;
      const cost = MetaState.characterUnlockCost(c.id);
      if (cost === null) continue;
      entries.push({
        kind: 'char',
        id: c.id,
        name: c.name,
        icon: { texture: TEXTURES.SPRITES, frame: c.frame },
        cost,
      });
    }
    for (const w of Object.values(WEAPONS)) {
      if (MetaState.isWeaponUnlocked(w.id)) continue;
      const cost = MetaState.weaponUnlockCost(w.id);
      if (cost === null) continue;
      entries.push({ kind: 'weapon', id: w.id, name: w.name, icon: w.icon, cost });
    }

    if (entries.length === 0) {
      const note = this.add
        .text(W / 2, headerY + 120, '✦  모두 해금됨  ✦', {
          fontFamily: 'Cinzel, serif',
          fontStyle: '700',
          fontSize: '30px',
          color: hex(COLORS.GOLD),
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH.POPTEXT + 1)
        .setAlpha(0.85);
      this.content.add(note);
      return;
    }

    const n = entries.length;
    const cellW = 288;
    const cellH = 176;
    const gap = 20;
    const totalW = n * cellW + (n - 1) * gap;
    const startX = W / 2 - totalW / 2 + cellW / 2;
    const cy = headerY + 132;

    entries.forEach((e, i) => {
      const cx = startX + i * (cellW + gap);
      this.buildUnlockCell(e, cx, cy, cellW, cellH);
    });
  }

  private buildUnlockCell(
    e: UnlockEntry,
    cx: number,
    cy: number,
    cellW: number,
    cellH: number
  ): void {
    const affordable = MetaState.gold >= e.cost;

    const panel = this.add
      .rectangle(cx, cy, cellW, cellH, COLORS.PANEL, 0.92)
      .setStrokeStyle(3, COLORS.PANEL_BORDER)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT);
    this.content.add(panel);

    const portrait = this.add
      .image(cx, cy - 44, TEXTURES.PIXEL)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);
    this.applyIcon(portrait, e.icon, ENTITY_SCALE * 3.0);
    this.content.add(portrait);

    const name = this.add
      .text(cx, cy + 28, e.name, {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '24px',
        color: hex(COLORS.BONE),
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);

    const cost = this.add
      .text(cx, cy + 62, `🔒 ${e.cost}`, {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '24px',
        color: hex(affordable ? COLORS.GOLD_LIGHT : COLORS.BLOOD_LIGHT),
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);
    this.content.add([name, cost]);

    const zone = this.add
      .zone(cx, cy, cellW, cellH)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => panel.setStrokeStyle(3, COLORS.GOLD));
    zone.on('pointerout', () => panel.setStrokeStyle(3, COLORS.PANEL_BORDER));
    zone.on('pointerdown', () => this.tryUnlock(e));
    this.content.add(zone);
  }

  private tryUnlock(e: UnlockEntry): void {
    const ok = e.kind === 'char' ? MetaState.unlockCharacter(e.id) : MetaState.unlockWeapon(e.id);
    if (ok) {
      this.rebuild();
      this.refreshGold();
    } else {
      this.denyFeedback();
    }
  }

  /* ----------------------------- back ----------------------------- */

  private buildBackButton(W: number, H: number): void {
    const w = 300;
    const h = 64;
    const x = W / 2;
    const y = H - 56;
    const c = this.add.container(x, y).setScrollFactor(0).setDepth(DEPTH.POPTEXT + 1);

    const bg = this.add.graphics();
    const draw = (hot: boolean) => {
      bg.clear();
      bg.fillStyle(hot ? COLORS.PANEL_LIGHT : COLORS.PANEL, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      bg.lineStyle(3, COLORS.GOLD, hot ? 1 : 0.8).strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    };
    draw(false);

    const txt = this.add
      .text(0, 0, '뒤로  (ESC)', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '26px',
        color: hex(COLORS.BONE),
      })
      .setOrigin(0.5);

    const zone = this.add.zone(0, 0, w, h).setOrigin(0.5).setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      draw(true);
      txt.setColor(hex(COLORS.GOLD_LIGHT));
    });
    zone.on('pointerout', () => {
      draw(false);
      txt.setColor(hex(COLORS.BONE));
    });
    zone.on('pointerdown', () => this.goBack());

    c.add([bg, txt, zone]);
  }

  /* ----------------------------- input ---------------------------- */

  private bindInput(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    kb.on('keydown-ESC', () => this.goBack());
  }

  private goBack(): void {
    this.input.enabled = false;
    this.cameras.main.fadeOut(280, 7, 7, 12);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(SCENES.MENU);
    });
  }

  /* ---------------------------- helpers --------------------------- */

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
}
