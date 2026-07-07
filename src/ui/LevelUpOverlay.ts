import Phaser from 'phaser';
import { SCENES, EVENTS } from '../types';
import type { UpgradeOption, IconRef } from '../types';
import { TEXTURES } from '../config/assets';
import { COLORS, GAME, DEPTH } from '../config/balance';
import { Sound } from '../audio/Sound';

/**
 * Level-up choice overlay built inside the (never-paused) UIScene. The GameScene
 * pauses itself and emits EVENTS.LEVEL_UP { level, options }; we present one
 * rarity-bordered card per option. Selecting a card emits EVENTS.UPGRADE_CHOSEN
 * back on the GameScene's emitter and hides the overlay.
 *
 * Designed to be shown again immediately (chained level-ups / chest rolls):
 * every show() rebuilds the cards from scratch and re-arms input.
 */
export class LevelUpOverlay {
  private readonly scene: Phaser.Scene;
  /** the GameScene's event emitter (UI <-> game comms). */
  private readonly gameEvents: Phaser.Events.EventEmitter;

  /** root container; lives for the lifetime of the overlay, toggled visible. */
  private readonly root: Phaser.GameObjects.Container;
  private readonly dim: Phaser.GameObjects.Rectangle;
  private readonly glow: Phaser.GameObjects.Image;
  private readonly banner: Phaser.GameObjects.Text;
  private readonly bannerSub: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;

  /** reroll button chrome (hidden when no charges remain this run). */
  private readonly rerollBtn: Phaser.GameObjects.Container;
  private readonly rerollBg: Phaser.GameObjects.Graphics;
  private readonly rerollLabel: Phaser.GameObjects.Text;
  private readonly rerollZone: Phaser.GameObjects.Zone;

  /** per-show card state. */
  private cards: CardView[] = [];
  private options: UpgradeOption[] = [];
  private rerollsLeft = 0;
  private selectedIndex = 0;
  private visible = false;
  /** guards against double-selecting before hide completes. */
  private locked = false;

  private keyHandler?: (ev: KeyboardEvent) => void;

  constructor(scene: Phaser.Scene, gameEvents: Phaser.Events.EventEmitter) {
    this.scene = scene;
    this.gameEvents = gameEvents;

    // Landscape-responsive: horizontal layout uses the LIVE width; relayout()
    // re-centres for the current width on every show(). Height is fixed (1080).
    const cx = scene.scale.width / 2;

    this.root = scene.add.container(0, 0);
    this.root.setScrollFactor(0).setDepth(DEPTH.POPTEXT + 30).setVisible(false);

    // Full-screen dim with a faint golden centre (set via a 2-layer overlay).
    this.dim = scene.add
      .rectangle(cx, GAME.HEIGHT / 2, scene.scale.width, GAME.HEIGHT, 0x05040a, 0.78)
      .setScrollFactor(0);
    this.root.add(this.dim);

    // Golden vignette pulse layer (multiplicative-feel via additive blend).
    this.glow = scene.add
      .image(cx, GAME.HEIGHT / 2, TEXTURES.VIGNETTE)
      .setDisplaySize(scene.scale.width, GAME.HEIGHT)
      .setTint(COLORS.GOLD)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.12)
      .setScrollFactor(0);
    this.root.add(this.glow);

    // "LEVEL UP!" gothic banner.
    this.banner = scene.add
      .text(cx, 140, 'LEVEL UP!', {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '88px',
        color: '#f0d896',
        stroke: '#1a1208',
        strokeThickness: 12,
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.root.add(this.banner);

    this.bannerSub = scene.add
      .text(cx, 220, '', {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '22px',
        color: '#c9a24b',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.root.add(this.bannerSub);

    this.hint = scene.add
      .text(cx, GAME.HEIGHT - 52, '1 / 2 / 3  ·  ←  →  ·  ENTER', {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '16px',
        color: '#9a8f78',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.root.add(this.hint);

    // Reroll button between the cards and the hint line. Only visible while
    // the run has charges left (Mirror of Fate shop power-up).
    this.rerollBtn = scene.add.container(cx, GAME.HEIGHT - 118).setScrollFactor(0);
    this.rerollBg = scene.add.graphics();
    this.rerollLabel = scene.add
      .text(0, 0, '', {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '26px',
        color: '#f0d896',
      })
      .setOrigin(0.5);
    this.rerollZone = scene.add
      .zone(0, 0, 10, 10)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    this.rerollZone.on('pointerover', () => this.drawRerollBg(true));
    this.rerollZone.on('pointerout', () => this.drawRerollBg(false));
    this.rerollZone.on('pointerdown', () => this.requestReroll());
    this.rerollBtn.add([this.rerollBg, this.rerollLabel, this.rerollZone]);
    this.root.add(this.rerollBtn);
  }

  /** Whether the overlay is currently on screen. */
  isVisible(): boolean {
    return this.visible;
  }

  /** Present a fresh set of option cards (rebuilt every call). */
  show(level: number, options: UpgradeOption[], rerollsLeft = 0): void {
    this.destroyCards();
    this.options = options;
    this.rerollsLeft = rerollsLeft;
    this.selectedIndex = 0;
    this.visible = true;
    this.locked = false;

    this.relayout(); // re-centre the static chrome for the current live width
    this.bannerSub.setText(`Lv ${level}  —  강화를 선택하세요`);
    this.updateRerollButton();
    this.root.setVisible(true);

    this.buildCards(options);
    this.highlight(0);
    this.armKeyboard();

    // entrance: banner pop + cards rise/fade in (staggered).
    this.banner.setScale(0.6);
    this.scene.tweens.add({
      targets: this.banner,
      scale: 1,
      duration: 260,
      ease: 'Back.Out',
    });
    this.cards.forEach((card, i) => {
      card.container.setAlpha(0);
      const targetY = card.baseY;
      card.container.y = targetY + 72;
      this.scene.tweens.add({
        targets: card.container,
        y: targetY,
        alpha: 1,
        duration: 220,
        delay: 60 + i * 70,
        ease: 'Cubic.Out',
      });
    });
  }

  /** Hide and tear down input + cards. */
  hide(): void {
    this.visible = false;
    this.disarmKeyboard();
    this.root.setVisible(false);
    this.destroyCards();
  }

  /** Fully dispose (called on scene shutdown). */
  destroy(): void {
    this.disarmKeyboard();
    this.destroyCards();
    this.root.destroy();
  }

  /**
   * Re-centre the always-on chrome (dim, golden glow, banner + hint) for the
   * current LIVE width. Called on every show() so a device rotation / resize
   * that happened while the overlay was hidden is reflected next time it opens.
   */
  private relayout(): void {
    const w = this.scene.scale.width;
    const cx = w / 2;
    this.dim.setPosition(cx, GAME.HEIGHT / 2).setSize(w, GAME.HEIGHT);
    this.glow.setPosition(cx, GAME.HEIGHT / 2).setDisplaySize(w, GAME.HEIGHT);
    this.banner.setX(cx);
    this.bannerSub.setX(cx);
    this.hint.setX(cx);
    this.rerollBtn.setX(cx);
  }

  /* --------------------------------------------------------------- */
  /* Reroll button                                                    */
  /* --------------------------------------------------------------- */

  /** Sync the reroll button to the remaining charge count (hide at 0). */
  private updateRerollButton(): void {
    if (this.rerollsLeft <= 0) {
      this.rerollBtn.setVisible(false);
      return;
    }
    this.rerollLabel.setText(`⟳  새로고침 (R)  ·  남은 ${this.rerollsLeft}회`);
    this.rerollZone.setSize(this.rerollLabel.width + 64, 56);
    this.rerollZone.setInteractive({ useHandCursor: true });
    this.drawRerollBg(false);
    this.rerollBtn.setVisible(true);
  }

  private drawRerollBg(hot: boolean): void {
    const w = this.rerollLabel.width + 64;
    const h = 56;
    this.rerollBg.clear();
    this.rerollBg
      .fillStyle(hot ? COLORS.PANEL_LIGHT : COLORS.PANEL, 0.95)
      .fillRoundedRect(-w / 2, -h / 2, w, h, 12);
    this.rerollBg
      .lineStyle(3, COLORS.GOLD, hot ? 1 : 0.75)
      .strokeRoundedRect(-w / 2, -h / 2, w, h, 12);
  }

  /**
   * Spend a reroll charge. The GameScene answers synchronously with a fresh
   * LEVEL_UP event, which re-enters show() and rebuilds the cards.
   */
  private requestReroll(): void {
    if (!this.visible || this.locked || this.rerollsLeft <= 0) return;
    Sound.play('reroll');
    this.gameEvents.emit(EVENTS.REROLL_REQUESTED, {});
  }

  /* --------------------------------------------------------------- */
  /* Card construction                                               */
  /* --------------------------------------------------------------- */

  private buildCards(options: UpgradeOption[]): void {
    const n = options.length;
    const cardW = 440;
    const cardH = 600;
    const gap = 52;
    const totalW = n * cardW + (n - 1) * gap;
    const startX = this.scene.scale.width / 2 - totalW / 2 + cardW / 2;
    const baseY = GAME.HEIGHT / 2 + 36;

    for (let i = 0; i < n; i++) {
      const opt = options[i];
      const x = startX + i * (cardW + gap);
      const card = this.makeCard(opt, i, x, baseY, cardW, cardH);
      this.cards.push(card);
    }
  }

  private makeCard(
    opt: UpgradeOption,
    index: number,
    x: number,
    y: number,
    w: number,
    h: number
  ): CardView {
    const scene = this.scene;
    const container = scene.add.container(x, y).setScrollFactor(0);
    this.root.add(container);

    // panel background (rounded rect with rarity border).
    const bg = scene.add.graphics();
    this.drawCardBg(bg, w, h, opt.rarityColor, false);
    container.add(bg);

    // top accent ribbon coloured by rarity.
    const ribbon = scene.add
      .rectangle(0, -h / 2 + 14, w - 32, 12, opt.rarityColor, 1)
      .setOrigin(0.5);
    container.add(ribbon);

    // tag pill (NEW / Lv N) top-right.
    const tagText = scene.add
      .text(w / 2 - 28, -h / 2 + 44, opt.tag, {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '16px',
        color: '#0a0a12',
      })
      .setOrigin(1, 0.5);
    const tagBg = scene.add
      .rectangle(
        tagText.x - tagText.width / 2,
        tagText.y,
        tagText.width + 24,
        32,
        opt.rarityColor,
        1
      )
      .setOrigin(0.5);
    container.add(tagBg);
    container.add(tagText);

    // icon framed box.
    const iconBoxY = -h / 2 + 140;
    const iconBox = scene.add.graphics();
    iconBox.fillStyle(0x0c0a14, 1).fillRoundedRect(-60, iconBoxY - 60, 120, 120, 16);
    iconBox.lineStyle(4, opt.rarityColor, 0.8).strokeRoundedRect(-60, iconBoxY - 60, 120, 120, 16);
    container.add(iconBox);

    const icon = this.makeIcon(opt.icon, 0, iconBoxY, 80);
    container.add(icon);

    // name (Cinzel heading).
    const name = scene.add
      .text(0, iconBoxY + 104, opt.name, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '36px',
        color: '#e8e0d0',
        align: 'center',
        wordWrap: { width: w - 48 },
      })
      .setOrigin(0.5, 0);
    container.add(name);

    // type subtitle (weapon / passive).
    const typeLabel = opt.isWeapon ? '무기' : '아이템';
    const sub = scene.add
      .text(0, iconBoxY + 168, typeLabel, {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '16px',
        color: '#9a8f78',
      })
      .setOrigin(0.5, 0);
    container.add(sub);

    // description.
    const desc = scene.add
      .text(0, iconBoxY + 208, opt.description, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontSize: '26px',
        color: '#c9bfa8',
        align: 'center',
        wordWrap: { width: w - 60 },
        lineSpacing: 4,
      })
      .setOrigin(0.5, 0);
    container.add(desc);

    // level pips along the bottom (skip for heal/gold fallbacks).
    if (opt.maxLevel > 1 && (opt.isWeapon || opt.kind === 'new-item' || opt.kind === 'level-item')) {
      const pips = this.makePips(opt.level, opt.maxLevel, opt.rarityColor, h / 2 - 44, w);
      pips.forEach((p) => container.add(p));
    }

    // interactivity: hover scale + click select. Use a hit zone covering the card.
    const zone = scene.add
      .zone(0, 0, w, h)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    container.add(zone);

    zone.on('pointerover', () => {
      if (!this.locked && this.selectedIndex !== index) {
        Sound.play('uiHover');
        this.highlight(index);
      }
    });
    zone.on('pointerdown', () => this.select(index));

    return {
      container,
      bg,
      ribbon,
      baseY: y,
      width: w,
      height: h,
      rarityColor: opt.rarityColor,
    };
  }

  /** Build a row of pip dots (filled up to `level`). Returns objects to add. */
  private makePips(
    level: number,
    maxLevel: number,
    color: number,
    yLocal: number,
    cardW: number
  ): Phaser.GameObjects.GameObject[] {
    const out: Phaser.GameObjects.GameObject[] = [];
    // cap visual pips so very long weapons (maxLevel 8) still fit.
    const shown = Math.min(maxLevel, 8);
    const r = 8;
    const gap = 10;
    const totalW = shown * (r * 2) + (shown - 1) * gap;
    const startX = -totalW / 2 + r;
    for (let i = 0; i < shown; i++) {
      const px = startX + i * (r * 2 + gap);
      const filled = i < level;
      const dot = this.scene.add.graphics();
      if (filled) {
        dot.fillStyle(color, 1).fillCircle(px, yLocal, r);
        dot.lineStyle(2, 0x000000, 0.4).strokeCircle(px, yLocal, r);
      } else {
        dot.fillStyle(0x000000, 0.4).fillCircle(px, yLocal, r);
        dot.lineStyle(2, color, 0.45).strokeCircle(px, yLocal, r);
      }
      out.push(dot);
    }
    return out;
  }

  /** Make an icon image honoring the frame===-1 (standalone texture) rule. */
  private makeIcon(icon: IconRef, x: number, y: number, targetSize: number): Phaser.GameObjects.Image {
    let img: Phaser.GameObjects.Image;
    if (icon.frame >= 0) {
      img = this.scene.add.image(x, y, icon.texture, icon.frame);
    } else {
      img = this.scene.add.image(x, y, icon.texture);
    }
    // scale to fit the target box (sheet frames are 16px; generated icons ~48px).
    const base = Math.max(img.width, img.height) || 16;
    img.setScale(targetSize / base);
    img.setScrollFactor(0);
    return img;
  }

  private drawCardBg(
    g: Phaser.GameObjects.Graphics,
    w: number,
    h: number,
    rarityColor: number,
    hot: boolean
  ): void {
    g.clear();
    const left = -w / 2;
    const top = -h / 2;
    // drop shadow
    g.fillStyle(0x000000, 0.45).fillRoundedRect(left + 8, top + 12, w, h, 24);
    // body
    g.fillStyle(hot ? COLORS.PANEL_LIGHT : COLORS.PANEL, 1).fillRoundedRect(left, top, w, h, 24);
    // inner subtle gradient-ish band
    g.fillStyle(0x000000, 0.18).fillRoundedRect(left, top + h * 0.45, w, h * 0.55, 24);
    // rarity border (thicker when hot)
    g.lineStyle(hot ? 8 : 5, rarityColor, hot ? 1 : 0.85).strokeRoundedRect(left, top, w, h, 24);
  }

  /* --------------------------------------------------------------- */
  /* Selection + input                                               */
  /* --------------------------------------------------------------- */

  private highlight(index: number): void {
    if (index < 0 || index >= this.cards.length) return;
    this.selectedIndex = index;
    this.cards.forEach((card, i) => {
      const hot = i === index;
      this.drawCardBg(card.bg, card.width, card.height, card.rarityColor, hot);
      this.scene.tweens.add({
        targets: card.container,
        scale: hot ? 1.06 : 1,
        duration: 120,
        ease: 'Quad.Out',
      });
    });
  }

  private select(index: number): void {
    if (this.locked || !this.visible) return;
    if (index < 0 || index >= this.options.length) return;
    this.locked = true;
    Sound.play('uiConfirm');
    this.highlight(index);

    const option = this.options[index];
    const card = this.cards[index];

    // little confirm pop on the chosen card, then resolve.
    this.scene.tweens.add({
      targets: card.container,
      scale: 1.14,
      duration: 90,
      yoyo: true,
      ease: 'Quad.Out',
      onComplete: () => this.resolve(option),
    });
  }

  /**
   * Commit a choice. We MUST tear down the current presentation BEFORE emitting:
   * the GameScene applies the upgrade synchronously and, for chained level-ups /
   * chests, re-emits EVENTS.LEVEL_UP (→ our show()) inside this same call stack.
   * If we hid AFTER emitting we'd wipe the freshly-shown next screen.
   */
  private resolve(option: UpgradeOption): void {
    // hide visuals + detach input, but DON'T flip `visible` off yet — show()
    // (possibly fired by the emit below) will set it back to true.
    this.disarmKeyboard();
    this.destroyCards();
    this.visible = false;
    this.root.setVisible(false);

    // Now notify the game. If this chains into another level-up, show() runs
    // synchronously here and re-activates the overlay with new cards.
    this.gameEvents.emit(EVENTS.UPGRADE_CHOSEN, { option });
  }

  private armKeyboard(): void {
    this.disarmKeyboard();
    const handler = (ev: KeyboardEvent) => {
      if (!this.visible || this.locked) return;
      switch (ev.key) {
        case '1':
          this.select(0);
          break;
        case '2':
          this.select(1);
          break;
        case '3':
          this.select(2);
          break;
        case 'ArrowLeft':
        case 'a':
        case 'A':
          if (this.selectedIndex > 0) Sound.play('uiHover');
          this.highlight(Math.max(0, this.selectedIndex - 1));
          break;
        case 'ArrowRight':
        case 'd':
        case 'D':
          if (this.selectedIndex < this.cards.length - 1) Sound.play('uiHover');
          this.highlight(Math.min(this.cards.length - 1, this.selectedIndex + 1));
          break;
        case 'Enter':
        case ' ':
          this.select(this.selectedIndex);
          break;
        case 'r':
        case 'R':
          this.requestReroll();
          break;
        default:
          return;
      }
      ev.preventDefault();
    };
    this.keyHandler = handler;
    // Listen on the DOM so this works regardless of which scene "owns" input
    // focus (the GameScene is paused; the UIScene's keyboard plugin is fine but
    // a window listener is the most robust for an overlay).
    window.addEventListener('keydown', handler);
  }

  private disarmKeyboard(): void {
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler);
      this.keyHandler = undefined;
    }
  }

  private destroyCards(): void {
    for (const card of this.cards) {
      card.container.destroy(); // destroys all children (bg, texts, zone, pips)
    }
    this.cards = [];
    this.options = [];
  }
}

interface CardView {
  container: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  ribbon: Phaser.GameObjects.Rectangle;
  baseY: number;
  width: number;
  height: number;
  rarityColor: number;
}
