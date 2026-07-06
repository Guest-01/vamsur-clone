import Phaser from 'phaser';

import { SCENES, REGISTRY } from '../types';
import type { CharacterDef, IconRef, PlayerStats } from '../types';
import { TEXTURES, FRAMES } from '../config/assets';
import {
  COLORS,
  GAME,
  DEPTH,
  ENTITY_SCALE,
  DEFAULT_STATS,
} from '../config/balance';
import { CHARACTERS } from '../content/characters';
import { WEAPONS } from '../content/weapons';
import { ENEMIES } from '../content/enemies';
import { HelpOverlay } from '../ui/HelpOverlay';
import { MetaState } from '../state/MetaState';

/* ------------------------------------------------------------------ */
/* Small style helpers (shared look used by Menu + GameOver alike)     */
/* ------------------------------------------------------------------ */

/** Convert a 0xRRGGBB number into a `#rrggbb` css string for canvas text. */
function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

/** A single idle enemy that lazily wanders across the menu backdrop. */
interface Wanderer {
  spr: Phaser.GameObjects.Sprite;
  vx: number;
  vy: number;
  retargetAt: number;
}

/**
 * MenuScene — the atmospheric title + character-select screen.
 *
 * Renders a tiled dungeon floor with a vignette, drifting dust and a couple of
 * idle enemies for life, the gothic title, the three playable characters as
 * framed portraits, the best survival time, controls hint and credit. ENTER or
 * clicking "Descend" starts a run with the highlighted character.
 */
export class MenuScene extends Phaser.Scene {
  /** Index of the currently highlighted character. */
  private selected = 0;
  /** Per-character portrait card containers (for selection styling). */
  private cards: Phaser.GameObjects.Container[] = [];
  private cardFrames: Phaser.GameObjects.Rectangle[] = [];
  /** the ▼ arrow shown above the currently selected card */
  private selMarker!: Phaser.GameObjects.Text;
  /** y of the top edge of the character cards (for placing the marker) */
  private cardTopY = 0;

  /** Live detail panel objects (rebuilt when the selection changes). */
  private detailName!: Phaser.GameObjects.Text;
  private detailDesc!: Phaser.GameObjects.Text;
  private detailBlurb!: Phaser.GameObjects.Text;
  private detailWeapon!: Phaser.GameObjects.Text;
  private detailStats!: Phaser.GameObjects.Text;
  private weaponIcon!: Phaser.GameObjects.Image;

  private bg!: Phaser.GameObjects.TileSprite;
  private wanderers: Wanderer[] = [];
  private help!: HelpOverlay;
  /** transient "this character is locked" hint shown on a blocked descend. */
  private lockHint?: Phaser.GameObjects.Text;
  /** live width captured at build time; used to throttle resize restarts. */
  private lastW = 0;

  constructor() {
    super(SCENES.MENU);
  }

  create(): void {
    const W = this.scale.width; // live (landscape-responsive) width
    const H = GAME.HEIGHT; // fixed design height (1080)
    this.lastW = W;

    MetaState.load();

    // Restore the last picked character if we have one.
    const savedId = this.registry.get(REGISTRY.SELECTED_CHARACTER) as string | undefined;
    const savedIdx = CHARACTERS.findIndex((c) => c.id === savedId);
    if (savedIdx >= 0) this.selected = savedIdx;

    this.buildBackdrop(W, H);
    this.buildWanderers(W, H);
    this.buildTitle(W);
    this.buildCharacterCards(W, H);
    this.buildDetailPanel(W, H);
    this.help = new HelpOverlay(this);
    this.buildFooter(W, H);

    this.refreshSelection();
    this.bindInput();

    // Landscape-responsive: rebuild the whole layout when the live width changes
    // (device rotation / window resize). A restart is the simplest correct
    // re-layout here; the selection persists via the registry.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize, this);
    });

    // gentle fade-in for polish
    this.cameras.main.fadeIn(450, 7, 7, 12);
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
    this.bg = this.add
      .tileSprite(0, 0, W, H, TEXTURES.BG_TILE)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.BG);

    // drifting dust motes for atmosphere
    this.add
      .particles(0, 0, TEXTURES.PARTICLE, {
        x: { min: 0, max: W },
        y: { min: 0, max: H },
        lifespan: 6000,
        speedX: { min: -8, max: 8 },
        speedY: { min: -14, max: -4 },
        scale: { min: 0.3, max: 1.0 },
        alpha: { start: 0.18, end: 0 },
        frequency: 240,
        quantity: 1,
        blendMode: Phaser.BlendModes.ADD,
        tint: COLORS.GOLD_LIGHT,
      })
      .setDepth(DEPTH.FX)
      .setScrollFactor(0);

    this.add
      .image(W / 2, H / 2, TEXTURES.VIGNETTE)
      .setDisplaySize(W, H)
      .setScrollFactor(0)
      .setDepth(DEPTH.VIGNETTE);
  }

  /** A couple of enemies idly drifting around behind the menu for life. */
  private buildWanderers(W: number, H: number): void {
    const pool = ['bat', 'zombie', 'skeleton', 'spider', 'cultist'];
    for (let i = 0; i < 5; i++) {
      const def = ENEMIES[pool[i % pool.length]];
      const x = Phaser.Math.Between(120, W - 120);
      const y = Phaser.Math.Between(280, H - 180);
      const spr = this.add
        .sprite(x, y, TEXTURES.SPRITES, def.frame)
        .setScale(ENTITY_SCALE * def.scale)
        .setDepth(DEPTH.ENEMY)
        .setAlpha(0.55);
      if (def.tint !== undefined) spr.setTint(def.tint);

      // soft shadow under each
      const shadow = this.add
        .image(x, y + 24 * def.scale, TEXTURES.SHADOW)
        .setDepth(DEPTH.SHADOW)
        .setAlpha(0.3)
        .setScale(def.scale);

      // subtle idle bob
      this.tweens.add({
        targets: spr,
        y: y - 8,
        duration: Phaser.Math.Between(900, 1500),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });
      // keep the shadow glued to the sprite
      spr.on('destroy', () => shadow.destroy());

      this.wanderers.push({
        spr,
        vx: Phaser.Math.FloatBetween(-22, 22),
        vy: Phaser.Math.FloatBetween(-14, 14),
        retargetAt: 0,
      });
      // store shadow on the sprite's data so update can follow it
      spr.setData('shadow', shadow);
    }
  }

  /* ----------------------------- title ---------------------------- */

  private buildTitle(W: number): void {
    const title = this.add
      .text(W / 2, 116, '영원한 밤의 묘지', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '80px',
        color: hex(COLORS.GOLD_LIGHT),
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT)
      .setShadow(0, 6, '#000000', 16, true, true);

    // faint living glow on the title
    this.tweens.add({
      targets: title,
      alpha: { from: 0.82, to: 1 },
      duration: 2200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    this.add
      .text(W / 2, 192, 'Crypt of the Eternal Night — 끝없이 밀려드는 어둠 속에서 살아남아라', {
        fontFamily: 'Cinzel, serif',
        fontSize: '28px',
        color: hex(COLORS.PARCHMENT),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT)
      .setAlpha(0.85);
  }

  /* ----------------------- character cards ------------------------ */

  private buildCharacterCards(W: number, H: number): void {
    const n = CHARACTERS.length;
    const cardW = 264;
    const gap = 56;
    const totalW = n * cardW + (n - 1) * gap;
    const startX = W / 2 - totalW / 2 + cardW / 2;
    const cy = 392;
    this.cardTopY = cy - 296 / 2;

    CHARACTERS.forEach((char, i) => {
      const cx = startX + i * (cardW + gap);
      const container = this.add.container(cx, cy).setDepth(DEPTH.POPTEXT);

      const panel = this.add
        .rectangle(0, 0, cardW, 296, COLORS.PANEL, 0.92)
        .setStrokeStyle(4, COLORS.PANEL_BORDER);
      const frame = this.add
        .rectangle(0, 0, cardW, 296)
        .setStrokeStyle(6, COLORS.GOLD)
        .setVisible(false);

      const portrait = this.add
        .image(0, -56, TEXTURES.SPRITES, char.frame)
        .setScale(ENTITY_SCALE * 4.8);
      // gentle idle bob on the portrait
      this.tweens.add({
        targets: portrait,
        y: portrait.y - 8,
        duration: 1300 + i * 130,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.inOut',
      });

      const name = this.add
        .text(0, 72, char.name, {
          fontFamily: 'Cinzel, serif',
          fontStyle: '700',
          fontSize: '34px',
          color: hex(COLORS.BONE),
        })
        .setOrigin(0.5);

      const hpStat = this.statLine(char);
      const role = this.add
        .text(0, 114, hpStat, {
          fontFamily: 'Cinzel, serif',
          fontStyle: '700',
          fontSize: '26px',
          color: hex(COLORS.PARCHMENT),
          align: 'center',
        })
        .setOrigin(0.5);

      container.add([panel, frame, portrait, name, role]);

      // locked characters: darken the portrait, overlay a lock + unlock cost.
      if (!MetaState.isCharacterUnlocked(char.id)) {
        portrait.setTint(0x55505e);
        const lock = this.add
          .text(0, -56, '🔒', {
            fontFamily: 'sans-serif',
            fontSize: '64px',
          })
          .setOrigin(0.5);
        const cost = MetaState.characterUnlockCost(char.id) ?? 0;
        const costTxt = this.add
          .text(0, 138, `🔒 ${cost}`, {
            fontFamily: 'Cinzel, serif',
            fontStyle: '700',
            fontSize: '24px',
            color: hex(COLORS.GOLD_LIGHT),
          })
          .setOrigin(0.5);
        container.add([lock, costTxt]);
      }

      // interactivity: click to select, double-effect to descend
      panel.setInteractive({ useHandCursor: true });
      panel.on('pointerover', () => {
        if (this.selected !== i) {
          container.setScale(1.04);
          container.setAlpha(0.8);
        }
      });
      panel.on('pointerout', () => {
        if (this.selected !== i) {
          container.setScale(1);
          container.setAlpha(0.45);
        }
      });
      panel.on('pointerdown', () => {
        if (this.selected === i) {
          this.descend();
        } else {
          this.selected = i;
          this.refreshSelection();
        }
      });

      this.cards.push(container);
      this.cardFrames.push(frame);
    });

    // ▼ marker that hovers above the selected card and slides between cards as
    // you change selection — the clear "this is what you're picking" cue.
    this.selMarker = this.add
      .text(this.cards[this.selected].x, this.cardTopY - 14, '▼', {
        fontFamily: 'sans-serif',
        fontSize: '48px',
        color: hex(COLORS.GOLD_LIGHT),
      })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH.POPTEXT + 2);
    this.tweens.add({
      targets: this.selMarker,
      scale: { from: 1, to: 1.25 },
      duration: 520,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  /** One-line role descriptor for a character card. */
  private statLine(char: CharacterDef): string {
    const hp = char.statOverrides.maxHp ?? DEFAULT_STATS.maxHp;
    const spd = char.statOverrides.moveSpeed ?? DEFAULT_STATS.moveSpeed;
    return `HP ${hp}  SPD ${spd}`;
  }

  /* ----------------------- detail panel --------------------------- */

  private buildDetailPanel(W: number, H: number): void {
    const py = 720;
    const pw = 1240;
    const ph = 232;

    this.add
      .rectangle(W / 2, py, pw, ph, COLORS.PANEL, 0.9)
      .setStrokeStyle(4, COLORS.PANEL_BORDER)
      .setDepth(DEPTH.POPTEXT);

    const left = W / 2 - pw / 2 + 48;
    const top = py - ph / 2 + 32;

    this.detailName = this.add
      .text(left, top, '', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '44px',
        color: hex(COLORS.GOLD_LIGHT),
      })
      .setDepth(DEPTH.POPTEXT);

    this.detailDesc = this.add
      .text(left, top + 64, '', {
        fontFamily: 'Cinzel, serif',
        fontSize: '26px',
        color: hex(COLORS.PARCHMENT),
        wordWrap: { width: pw - 96 },
      })
      .setDepth(DEPTH.POPTEXT);

    this.detailBlurb = this.add
      .text(left, top + 124, '', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '24px',
        color: hex(COLORS.GOLD),
      })
      .setDepth(DEPTH.POPTEXT);

    // starting-weapon icon + label, right side of the panel
    const wx = W / 2 + pw / 2 - 240;
    this.weaponIcon = this.add
      .image(wx, py - 4, TEXTURES.SPRITES, 0)
      .setScale(ENTITY_SCALE * 3.2)
      .setDepth(DEPTH.POPTEXT);
    this.detailWeapon = this.add
      .text(wx + 56, py - 30, '', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '24px',
        color: hex(COLORS.BONE),
        align: 'left',
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.POPTEXT);

    this.detailStats = this.add
      .text(wx + 56, py + 14, '', {
        fontFamily: 'Cinzel, serif',
        fontSize: '22px',
        color: hex(COLORS.PARCHMENT),
        align: 'left',
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.POPTEXT);
  }

  /* -------------------------- footer ------------------------------ */

  private buildFooter(W: number, H: number): void {
    // best survival time
    const best = this.loadBestMs();
    const bestStr = best > 0 ? `최고 생존 ${formatTime(best)}` : '최고 생존 기록 없음';
    this.add
      .text(W / 2, 864, bestStr, {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '30px',
        color: hex(COLORS.GOLD),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT);

    // "Descend" prompt — pulsing call to action
    const descend = this.add
      .text(W / 2, 940, '◆  ENTER / 클릭하여 강림  ◆', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '40px',
        color: hex(COLORS.BONE),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT)
      .setInteractive({ useHandCursor: true });
    descend.on('pointerover', () => descend.setColor(hex(COLORS.GOLD_LIGHT)));
    descend.on('pointerout', () => descend.setColor(hex(COLORS.BONE)));
    descend.on('pointerdown', () => this.descend());
    this.tweens.add({
      targets: descend,
      scale: { from: 1, to: 1.06 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    // controls hint
    this.add
      .text(W / 2, 1012, 'WASD / 방향키 이동   •   자동 공격   •   ESC 일시정지   •   ← → 캐릭터 선택', {
        fontFamily: 'Cinzel, serif',
        fontSize: '24px',
        color: hex(COLORS.PARCHMENT),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT);

    // guide / how-to-play button (also opens with the H key)
    const guide = this.add
      .text(W - 40, 56, '? 가이드  (H)', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '26px',
        color: hex(COLORS.PARCHMENT),
      })
      .setOrigin(1, 0.5)
      .setDepth(DEPTH.POPTEXT)
      .setInteractive({ useHandCursor: true });
    guide.on('pointerover', () => guide.setColor(hex(COLORS.GOLD_LIGHT)));
    guide.on('pointerout', () => guide.setColor(hex(COLORS.PARCHMENT)));
    guide.on('pointerdown', () => this.help.show());

    // shop button (top-left, mirrors the guide button; also opens with B)
    const shop = this.add
      .text(40, 56, '⚒ 상점  (B)', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '26px',
        color: hex(COLORS.PARCHMENT),
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.POPTEXT)
      .setInteractive({ useHandCursor: true });
    shop.on('pointerover', () => shop.setColor(hex(COLORS.GOLD_LIGHT)));
    shop.on('pointerout', () => shop.setColor(hex(COLORS.PARCHMENT)));
    shop.on('pointerdown', () => this.openShop());

    // banked gold readout (top-left, under the shop button)
    this.add
      .image(58, 108, TEXTURES.SPRITES, FRAMES.COINS)
      .setScale(ENTITY_SCALE * 1.5)
      .setDepth(DEPTH.POPTEXT);
    this.add
      .text(84, 108, `${MetaState.gold}`, {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '28px',
        color: hex(COLORS.GOLD_LIGHT),
      })
      .setOrigin(0, 0.5)
      .setDepth(DEPTH.POPTEXT);

    // unofficial fan-project disclaimer (bottom-left)
    this.add
      .text(16, H - 12, 'Vampire Survivors에서 영감받은 비공식·비영리 팬 프로젝트 (poncle과 무관)', {
        fontFamily: 'Cinzel, serif',
        fontSize: '16px',
        color: hex(COLORS.TEXT_DIM),
      })
      .setOrigin(0, 1)
      .setDepth(DEPTH.POPTEXT)
      .setAlpha(0.65);

    // CC0 credit
    this.add
      .text(W - 16, H - 12, 'Art: Kenney — CC0', {
        fontFamily: '"Press Start 2P"',
        fontSize: '16px',
        color: hex(COLORS.TEXT_DIM),
      })
      .setOrigin(1, 1)
      .setDepth(DEPTH.POPTEXT)
      .setAlpha(0.7);
  }

  /* --------------------------- input ------------------------------ */

  private bindInput(): void {
    const kb = this.input.keyboard;
    if (!kb) return;

    kb.on('keydown-LEFT', () => this.move(-1));
    kb.on('keydown-A', () => this.move(-1));
    kb.on('keydown-RIGHT', () => this.move(1));
    kb.on('keydown-D', () => this.move(1));
    kb.on('keydown-ENTER', () => this.descend());
    kb.on('keydown-SPACE', () => this.descend());
    kb.on('keydown-H', () => this.help.toggle());
    kb.on('keydown-B', () => this.openShop());
    kb.on('keydown-ESC', () => {
      if (this.help.isVisible()) this.help.hide();
    });
  }

  /** Fade out and open the meta shop (guard while the guide is open). */
  private openShop(): void {
    if (this.help?.isVisible()) return;
    this.input.enabled = false;
    this.cameras.main.fadeOut(280, 7, 7, 12);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(SCENES.SHOP);
    });
  }

  private move(dir: number): void {
    if (this.help?.isVisible()) return;
    const n = CHARACTERS.length;
    this.selected = (this.selected + dir + n) % n;
    this.refreshSelection();
  }

  /* ----------------------- selection redraw ----------------------- */

  private refreshSelection(): void {
    this.cards.forEach((card, i) => {
      const on = i === this.selected;
      this.cardFrames[i].setVisible(on);
      // dim the unselected cards so the picked one clearly stands out
      card.setAlpha(on ? 1 : 0.45);
      this.tweens.add({
        targets: card,
        scale: on ? 1.14 : 1,
        duration: 160,
        ease: 'Back.out',
      });
    });

    // slide the ▼ marker above the newly selected card
    if (this.selMarker) {
      this.tweens.add({
        targets: this.selMarker,
        x: this.cards[this.selected].x,
        duration: 180,
        ease: 'Quad.Out',
      });
    }

    const char = CHARACTERS[this.selected];
    this.registry.set(REGISTRY.SELECTED_CHARACTER, char.id);

    this.detailName.setText(char.name);
    this.detailDesc.setText(char.description);
    this.detailBlurb.setText(char.blurb);

    const weapon = WEAPONS[char.startingWeaponId];
    if (weapon) {
      this.applyIcon(this.weaponIcon, weapon.icon, ENTITY_SCALE * 3.2);
      this.detailWeapon.setText(weapon.name);
      this.detailStats.setText(this.deltaText(char.statOverrides));
    }
  }

  /** Build a short "stat delta vs default" string for the selected character. */
  private deltaText(over: Partial<PlayerStats>): string {
    const parts: string[] = [];
    const fmt = (label: string, v: number, base: number, pct = false, sign = true) => {
      const d = v - base;
      if (Math.abs(d) < 1e-6) return;
      const num = pct ? `${Math.round(d * 100)}%` : `${Math.round(d)}`;
      parts.push(`${label} ${sign && d > 0 ? '+' : ''}${num}`);
    };
    fmt('HP', over.maxHp ?? DEFAULT_STATS.maxHp, DEFAULT_STATS.maxHp);
    fmt('SPD', over.moveSpeed ?? DEFAULT_STATS.moveSpeed, DEFAULT_STATS.moveSpeed);
    fmt('MGT', over.might ?? DEFAULT_STATS.might, DEFAULT_STATS.might, true);
    fmt('CRIT', over.critChance ?? DEFAULT_STATS.critChance, DEFAULT_STATS.critChance, true);
    return parts.slice(0, 3).join('  ');
  }

  /**
   * Point an Image at an IconRef. When `icon.frame === -1` the texture is a
   * standalone generated texture (no frame); otherwise it is a sheet frame.
   */
  private applyIcon(img: Phaser.GameObjects.Image, icon: IconRef, sheetScale: number): void {
    if (icon.frame === -1) {
      img.setTexture(icon.texture);
      // generated icons are drawn @48px; bring them to roughly sheet-icon size
      img.setScale((sheetScale * 16) / Math.max(img.width, 1));
    } else {
      img.setTexture(icon.texture, icon.frame);
      img.setScale(sheetScale);
    }
  }

  /* -------------------------- transition -------------------------- */

  private descend(): void {
    // Don't start a run while the guide is open (ENTER/click should close it).
    if (this.help?.isVisible()) return;
    const char = CHARACTERS[this.selected];
    // Block starting a run with a character that hasn't been unlocked yet.
    if (!MetaState.isCharacterUnlocked(char.id)) {
      this.flashLockedHint();
      return;
    }
    this.input.enabled = false;
    this.cameras.main.fadeOut(320, 7, 7, 12);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(SCENES.GAME, { characterId: char.id });
    });
  }

  /** Briefly flash a hint when the player tries to start as a locked hero. */
  private flashLockedHint(): void {
    this.lockHint?.destroy();
    this.lockHint = this.add
      .text(this.scale.width / 2, 900, '🔒 상점에서 해금하세요', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '30px',
        color: hex(COLORS.BLOOD_LIGHT),
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.POPTEXT + 3);
    this.tweens.add({
      targets: this.lockHint,
      alpha: { from: 1, to: 0 },
      y: '-=30',
      duration: 1500,
      ease: 'Quad.Out',
      onComplete: () => {
        this.lockHint?.destroy();
        this.lockHint = undefined;
      },
    });
  }

  /* ----------------------------- best ----------------------------- */

  private loadBestMs(): number {
    // prefer the Phaser registry mirror, fall back to localStorage.
    const reg = this.registry.get(REGISTRY.BEST_TIME);
    if (typeof reg === 'number' && reg > 0) return reg;
    try {
      const raw = window.localStorage.getItem(REGISTRY.BEST_TIME);
      const n = raw ? parseInt(raw, 10) : 0;
      return Number.isFinite(n) ? n : 0;
    } catch {
      return 0;
    }
  }

  /* ----------------------------- loop ----------------------------- */

  update(_time: number, delta: number): void {
    // slowly pan the floor for a sense of descent
    this.bg.tilePositionX += delta * 0.004;
    this.bg.tilePositionY += delta * 0.012;

    const dt = delta / 1000;
    const W = this.scale.width;
    const H = GAME.HEIGHT;
    for (const w of this.wanderers) {
      const s = w.spr;
      if (!s.active) continue;
      // occasionally pick a new drift direction
      if (_time >= w.retargetAt) {
        w.vx = Phaser.Math.FloatBetween(-24, 24);
        w.vy = Phaser.Math.FloatBetween(-16, 16);
        w.retargetAt = _time + Phaser.Math.Between(1500, 3500);
      }
      s.x += w.vx * dt;
      s.y += w.vy * dt;
      // wrap softly inside the playfield
      if (s.x < 80) w.vx = Math.abs(w.vx);
      if (s.x > W - 80) w.vx = -Math.abs(w.vx);
      if (s.y < 260) w.vy = Math.abs(w.vy);
      if (s.y > H - 160) w.vy = -Math.abs(w.vy);
      if (w.vx !== 0) s.setFlipX(w.vx < 0);

      const shadow = s.getData('shadow') as Phaser.GameObjects.Image | undefined;
      if (shadow) shadow.setPosition(s.x, s.y + 28);
    }
  }
}

/** Format milliseconds as mm:ss. Exported for reuse by GameOverScene. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
