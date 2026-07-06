import Phaser from 'phaser';

import { SCENES } from '../types';
import type { ConsumableDef, IconRef } from '../types';
import { TEXTURES } from '../config/assets';
import { COLORS, GAME, DEPTH, ENTITY_SCALE, RARITY } from '../config/balance';
import { POWERUPS, CONSUMABLES } from '../content/powerups';
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
  /** live width captured at build time; used to throttle resize restarts. */
  private lastW = 0;

  constructor() {
    super(SCENES.SHOP);
  }

  create(): void {
    MetaState.load();
    const W = this.scale.width; // live (landscape-responsive) width
    const H = GAME.HEIGHT; // fixed design height (1080)
    this.lastW = W;

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

    // Landscape-responsive: a restart re-centers the whole shop for the new
    // width (rotation / resize); purchases already persist in MetaState.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    });

    this.cameras.main.fadeIn(350, 7, 7, 12);
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
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
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
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
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
      .image(W - 184, 72, TEXTURES.ICON_COIN)
      .setScale(1.1)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT);

    this.goldText = this.add
      .text(W - 154, 72, '0', {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
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

  /** Brief green pulse on the gold readout when a refund pays out. */
  private gainFeedback(): void {
    this.goldText.setColor('#9fe89f');
    this.tweens.add({
      targets: this.goldText,
      scale: { from: 1, to: 1.12 },
      duration: 110,
      yoyo: true,
      ease: 'Sine.inOut',
      onComplete: () => this.goldText.setColor(hex(COLORS.GOLD_LIGHT)),
    });
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
    const W = this.scale.width;

    this.sectionHeader(W, '강화  (POWER-UPS)', 158);
    this.buildRefundAllButton(W, 158);
    const gridBottom = this.buildPowerups(W);

    // The unlock section sits below however tall the power-up grid came out
    // (the grid row count depends on the live width).
    const unlocksY = Math.max(646, gridBottom + 56);
    this.sectionHeader(W, '해금  (UNLOCKS)', unlocksY);
    this.buildUnlocks(W, unlocksY);
  }

  /** A left-aligned section heading with an underline, in the content layer. */
  private sectionHeader(W: number, label: string, y: number, hint?: string): void {
    const left = 56;
    const header = this.add
      .text(left, y, label, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
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

    // optional right-aligned usage hint on the same line
    if (hint) {
      const h = this.add
        .text(W - left, y + 2, hint, {
          fontFamily: 'Cinzel, "Noto Serif KR", serif',
          fontSize: '18px',
          color: hex(COLORS.TEXT_DIM),
        })
        .setOrigin(1, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH.POPTEXT);
      this.content.add(h);
    }
  }

  /* --------------------------- power-ups -------------------------- */

  /** Lay out the power-up grid; returns the grid's bottom Y. */
  private buildPowerups(W: number): number {
    const defs = Object.values(POWERUPS);
    // One-shot consumables share the grid but get visually distinct cells
    // (purple border + "1회성" badge) so they read as a different kind of buy.
    const consumables = Object.values(CONSUMABLES);
    const total = defs.length + consumables.length;
    const margin = 56;
    const colGap = 24;
    // Fit as many columns as the live width allows at a comfortable minimum
    // cell width (the power-up list outgrew the old fixed 4x3 grid).
    const usable = W - margin * 2;
    const cols = Phaser.Math.Clamp(Math.floor((usable + colGap) / (300 + colGap)), 3, 6);
    const cellW = Math.min(440, Math.floor((usable - (cols - 1) * colGap) / cols));
    const rows = Math.ceil(total / cols);
    // Taller cells make room for the per-power-up description + refund button;
    // compress if a future longer list ever pushes past 3 rows.
    const cellH = rows <= 3 ? 140 : 112;
    const rowGap = rows <= 3 ? 20 : 14;
    const totalW = cols * cellW + (cols - 1) * colGap;
    const startX = W / 2 - totalW / 2 + cellW / 2;
    const gridTop = 196;

    for (let i = 0; i < total; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const cx = startX + col * (cellW + colGap);
      const cy = gridTop + cellH / 2 + row * (cellH + rowGap);
      if (i < defs.length) {
        this.buildPowerupCell(defs[i], cx, cy, cellW, cellH);
      } else {
        this.buildConsumableCell(consumables[i - defs.length], cx, cy, cellW, cellH);
      }
    }

    return gridTop + rows * (cellH + rowGap) - rowGap;
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
      .image(cx - cellW / 2 + 46, cy, TEXTURES.PIXEL)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);
    this.applyIcon(icon, def.icon, ENTITY_SCALE * 2.3);
    this.content.add(icon);

    const textLeft = cx - cellW / 2 + 86;
    const rightEdge = cx + cellW / 2 - 24;

    // --- row 1: name (left) + cost / MAX (right) ---
    const name = this.add
      .text(textLeft, cy - 44, def.name, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '22px',
        color: hex(maxed ? COLORS.GOLD_LIGHT : COLORS.BONE),
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);
    this.content.add(name);

    if (maxed) {
      const max = this.add
        .text(rightEdge, cy - 44, 'MAX', {
          fontFamily: 'Cinzel, "Noto Serif KR", serif',
          fontStyle: '700',
          fontSize: '24px',
          color: hex(COLORS.GOLD_LIGHT),
        })
        .setOrigin(1, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH.POPTEXT + 1);
      this.content.add(max);
    } else {
      const costTxt = this.add
        .text(rightEdge, cy - 44, `${cost}`, {
          fontFamily: 'Cinzel, "Noto Serif KR", serif',
          fontStyle: '700',
          fontSize: '24px',
          color: hex(affordable ? COLORS.GOLD_LIGHT : COLORS.BLOOD_LIGHT),
        })
        .setOrigin(1, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH.POPTEXT + 1);
      const coin = this.add
        .image(rightEdge - costTxt.width - 20, cy - 44, TEXTURES.ICON_COIN)
        .setScale(0.55)
        .setScrollFactor(0)
        .setDepth(DEPTH.POPTEXT + 1)
        .setAlpha(affordable ? 1 : 0.5);
      this.content.add([costTxt, coin]);
    }

    // --- row 2: short effect description (full width) ---
    const desc = this.add
      .text(textLeft, cy - 24, def.description, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontSize: '16px',
        color: hex(COLORS.PARCHMENT),
        wordWrap: { width: cellW - 110 },
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1)
      .setAlpha(0.85);
    this.content.add(desc);

    // --- row 3: pips (left) + Lv (mid-right) + refund button (right) ---
    const rowY = cy + 42;
    this.buildPips(textLeft, rowY, level, def.maxLevel);

    const btnX = cx + cellW / 2 - 40;
    const lvl = this.add
      .text(btnX - 28, rowY, `Lv ${level}/${def.maxLevel}`, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontSize: '17px',
        color: hex(COLORS.PARCHMENT),
      })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);
    this.content.add(lvl);

    // hit area over the whole cell = buy
    const zone = this.add
      .zone(cx, cy, cellW, cellH)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: !maxed });
    zone.on('pointerover', () => panel.setStrokeStyle(3, COLORS.GOLD));
    zone.on('pointerout', () => panel.setStrokeStyle(3, COLORS.PANEL_BORDER));
    zone.on('pointerdown', () => this.tryBuyPowerup(def.id));
    this.content.add(zone);

    // Refund button LAST: inside a Container the input priority follows the
    // add order (depth is ignored for container children), so the minus zone
    // must come after the buy zone or the buy zone swallows its clicks.
    if (level > 0) this.buildRefundButton(btnX, rowY, def.id);
  }

  /** Small "−" square that refunds one owned level at full price. */
  private buildRefundButton(x: number, y: number, id: string): void {
    const s = 30;
    const bg = this.add.graphics().setScrollFactor(0).setDepth(DEPTH.POPTEXT + 2);
    const draw = (hot: boolean): void => {
      bg.clear();
      bg.fillStyle(hot ? COLORS.BLOOD : COLORS.PANEL_LIGHT, hot ? 0.85 : 1)
        .fillRoundedRect(x - s / 2, y - s / 2, s, s, 7);
      bg.lineStyle(2, COLORS.BLOOD_LIGHT, 1).strokeRoundedRect(x - s / 2, y - s / 2, s, s, 7);
    };
    draw(false);

    const minus = this.add
      .text(x, y - 1, '−', {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '24px',
        color: hex(COLORS.BLOOD_LIGHT),
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 3);

    const zone = this.add
      .zone(x, y, s + 6, s + 6)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 3)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => {
      draw(true);
      minus.setColor('#ffffff');
    });
    zone.on('pointerout', () => {
      draw(false);
      minus.setColor(hex(COLORS.BLOOD_LIGHT));
    });
    zone.on('pointerdown', () => this.tryRefundPowerup(id));
    this.content.add([bg, minus, zone]);
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

  private tryRefundPowerup(id: string): void {
    if (MetaState.refundPowerup(id)) {
      this.rebuild();
      this.refreshGold();
      this.gainFeedback();
    } else {
      this.denyFeedback();
    }
  }

  /**
   * "전체 환불" button on the POWER-UPS header line, with the usage hint to its
   * left. Two-step confirm: the first click arms it (label changes for 2.5s),
   * the second click refunds every owned level at full price.
   */
  private buildRefundAllButton(W: number, y: number): void {
    const right = W - 56;
    const w = 150;
    const h = 38;
    const bx = right - w / 2;

    const hint = this.add
      .text(right - w - 24, y + 2, '셀 클릭 = 구매   ·   − = 1레벨 환불 (전액)', {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontSize: '18px',
        color: hex(COLORS.TEXT_DIM),
      })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT);
    this.content.add(hint);

    const bg = this.add.graphics().setScrollFactor(0).setDepth(DEPTH.POPTEXT + 1);
    const draw = (hot: boolean, armed: boolean): void => {
      bg.clear();
      bg.fillStyle(armed ? COLORS.BLOOD : hot ? COLORS.PANEL_LIGHT : COLORS.PANEL, armed ? 0.85 : 1)
        .fillRoundedRect(bx - w / 2, y - h / 2, w, h, 9);
      bg.lineStyle(2, COLORS.BLOOD_LIGHT, hot || armed ? 1 : 0.75)
        .strokeRoundedRect(bx - w / 2, y - h / 2, w, h, 9);
    };
    draw(false, false);

    const label = this.add
      .text(bx, y, '전체 환불', {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '20px',
        color: hex(COLORS.BLOOD_LIGHT),
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 2);

    let armed = false;
    let disarmTimer: Phaser.Time.TimerEvent | undefined;
    const disarm = (): void => {
      armed = false;
      // guard: a purchase/refund rebuild may have destroyed these objects
      if (!label.scene) return;
      label.setText('전체 환불').setColor(hex(COLORS.BLOOD_LIGHT));
      draw(false, false);
    };

    const zone = this.add
      .zone(bx, y, w, h)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    zone.on('pointerover', () => draw(true, armed));
    zone.on('pointerout', () => draw(false, armed));
    zone.on('pointerdown', () => {
      if (!armed) {
        armed = true;
        label.setText('한 번 더 클릭').setColor('#ffffff');
        draw(true, true);
        disarmTimer = this.time.delayedCall(2500, disarm);
      } else {
        disarmTimer?.remove();
        const total = MetaState.refundAllPowerups();
        if (total > 0) {
          this.rebuild();
          this.refreshGold();
          this.gainFeedback();
        } else {
          disarm();
          this.denyFeedback();
        }
      }
    });
    this.content.add([bg, label, zone]);
  }

  /* -------------------------- consumables ------------------------- */

  /**
   * A one-shot consumable cell. Visually distinct from power-ups: purple
   * (RARE) border, a "1회성" corner badge, the effect text instead of level
   * pips, and a "준비됨" state while one is held (max 1 at a time).
   */
  private buildConsumableCell(
    def: ConsumableDef,
    cx: number,
    cy: number,
    cellW: number,
    cellH: number
  ): void {
    const held = MetaState.hasConsumable(def.id);
    const affordable = MetaState.gold >= def.cost;
    const accent = RARITY.RARE; // purple — the consumable signature colour
    const accentHot = 0xd0a6ff;

    const panel = this.add
      .rectangle(cx, cy, cellW, cellH, COLORS.PANEL, 0.92)
      .setStrokeStyle(3, accent)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT);
    this.content.add(panel);

    // "1회성" badge pinned to the cell's top-right corner.
    const badgeText = this.add
      .text(cx + cellW / 2 - 14, cy - cellH / 2 + 16, '1회성', {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '15px',
        color: '#0a0a12',
      })
      .setOrigin(1, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 2);
    const badgeBg = this.add
      .rectangle(
        badgeText.x - badgeText.width / 2,
        badgeText.y,
        badgeText.width + 18,
        24,
        accent,
        1
      )
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);
    this.content.add([badgeBg, badgeText]);

    // icon (left)
    const icon = this.add
      .image(cx - cellW / 2 + 46, cy, TEXTURES.PIXEL)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);
    this.applyIcon(icon, def.icon, ENTITY_SCALE * 2.3);
    this.content.add(icon);

    const textLeft = cx - cellW / 2 + 86;
    const rightEdge = cx + cellW / 2 - 24;

    // --- row 1: name ---
    const name = this.add
      .text(textLeft, cy - 44, def.name, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '22px',
        color: hex(held ? COLORS.GOLD_LIGHT : accentHot),
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);
    this.content.add(name);

    // --- row 2: effect / state description ---
    const desc = this.add
      .text(textLeft, cy - 24, held ? '준비됨 · 다음 런에 자동 사용' : def.description, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontSize: '16px',
        color: hex(COLORS.PARCHMENT),
        wordWrap: { width: cellW - 110 },
      })
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1)
      .setAlpha(0.9);
    this.content.add(desc);

    // --- row 3: cost / held state (bottom-right) ---
    if (held) {
      const ready = this.add
        .text(rightEdge, cy + 42, '✦ 준비됨', {
          fontFamily: 'Cinzel, "Noto Serif KR", serif',
          fontStyle: '700',
          fontSize: '22px',
          color: hex(COLORS.GOLD_LIGHT),
        })
        .setOrigin(1, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH.POPTEXT + 1);
      this.content.add(ready);
    } else {
      const costTxt = this.add
        .text(rightEdge, cy + 42, `${def.cost}`, {
          fontFamily: 'Cinzel, "Noto Serif KR", serif',
          fontStyle: '700',
          fontSize: '24px',
          color: hex(affordable ? COLORS.GOLD_LIGHT : COLORS.BLOOD_LIGHT),
        })
        .setOrigin(1, 0.5)
        .setScrollFactor(0)
        .setDepth(DEPTH.POPTEXT + 1);
      const coin = this.add
        .image(rightEdge - costTxt.width - 20, cy + 42, TEXTURES.ICON_COIN)
        .setScale(0.55)
        .setScrollFactor(0)
        .setDepth(DEPTH.POPTEXT + 1)
        .setAlpha(affordable ? 1 : 0.5);
      this.content.add([costTxt, coin]);
    }

    const zone = this.add
      .zone(cx, cy, cellW, cellH)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: !held });
    zone.on('pointerover', () => panel.setStrokeStyle(3, accentHot));
    zone.on('pointerout', () => panel.setStrokeStyle(3, accent));
    zone.on('pointerdown', () => this.tryBuyConsumable(def.id, held));
    this.content.add(zone);
  }

  private tryBuyConsumable(id: string, held: boolean): void {
    if (held) return; // already stocked — nothing to buy
    if (MetaState.buyConsumable(id)) {
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
          fontFamily: 'Cinzel, "Noto Serif KR", serif',
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
    const cellH = 168;
    const gap = 20;
    const totalW = n * cellW + (n - 1) * gap;
    const startX = W / 2 - totalW / 2 + cellW / 2;
    // Sits right under the header; compact enough to clear the back button
    // even when a tall power-up grid pushed the whole section down.
    const cy = headerY + 116;

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
      .image(cx, cy - 40, TEXTURES.PIXEL)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);
    this.applyIcon(portrait, e.icon, ENTITY_SCALE * 3.0);
    this.content.add(portrait);

    const name = this.add
      .text(cx, cy + 24, e.name, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '24px',
        color: hex(COLORS.BONE),
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 1);

    const cost = this.add
      .text(cx, cy + 56, `🔒 ${e.cost}`, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
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
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
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
