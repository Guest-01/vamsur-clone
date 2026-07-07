import Phaser from 'phaser';
import { SCENES } from '../types';
import type { OwnedWeaponView, OwnedItemView, IconRef, PlayerStats } from '../types';
import { GAME, COLORS, DEPTH, DEFAULT_STATS } from '../config/balance';
import { Sound } from '../audio/Sound';

/** Snapshot of the current run state used to render the pause summary. */
export interface PauseSummary {
  level: number;
  kills: number;
  gold: number;
  elapsedMs: number;
  hp: number;
  maxHp: number;
  /** live player stat block (shared by reference with the game) */
  stats: PlayerStats;
  weapons: OwnedWeaponView[];
  items: OwnedItemView[];
}

/** signed percent vs the 1.0 baseline (1.25 -> "+25%", 0.85 -> "-15%"). */
function signedPct(v: number): string {
  const p = Math.round((v - 1) * 100);
  return `${p >= 0 ? '+' : ''}${p}%`;
}

/** trim to at most `digits` decimals, dropping trailing zeros. */
function trimDec(v: number, digits: number): string {
  return `${parseFloat(v.toFixed(digits))}`;
}

/** Every PlayerStats entry: key, Korean label, value formatter (grid order). */
const STAT_ROWS: ReadonlyArray<readonly [keyof PlayerStats, string, (v: number) => string]> = [
  ['maxHp', '최대 체력', (v) => `${Math.round(v)}`],
  ['hpRegen', '체력 재생', (v) => `${trimDec(v, 1)}/초`],
  ['moveSpeed', '이동 속도', (v) => `${Math.round(v)}`],
  ['might', '공격력', signedPct],
  ['area', '공격 범위', signedPct],
  ['cooldownMult', '쿨다운', signedPct], // lower is better: -15% reads as faster
  ['projectileSpeed', '탄환 속도', signedPct],
  ['amount', '투사체 추가', (v) => `+${v}`],
  ['magnet', '자석 범위', (v) => `${Math.round(v)}`],
  ['armor', '방어력', (v) => `${Math.round(v)}`],
  ['xpGain', '경험치 획득', signedPct],
  ['luck', '행운', signedPct],
  ['critChance', '치명타 확률', (v) => `${Math.round(v * 100)}%`],
  ['critMult', '치명타 피해', (v) => `×${trimDec(v, 2)}`],
  ['revives', '부활', (v) => `${v}회`],
  ['dodge', '회피', (v) => `${Math.round(v * 100)}%`],
  ['greed', '골드 획득', signedPct],
  ['rerolls', '리롤', (v) => `${v}회`],
];

/**
 * Pause screen built inside the UIScene. Shown on EVENTS.PAUSE_TOGGLED {paused}.
 * The GameScene pauses itself; the UIScene (never paused) resumes it via
 * this.scene.resume(SCENES.GAME). ESC is handled in the UIScene which calls
 * resume() here.
 */
export class PauseOverlay {
  private readonly scene: Phaser.Scene;
  private readonly root: Phaser.GameObjects.Container;
  /** dynamic content rebuilt every show(): icons, lists, etc. */
  private body?: Phaser.GameObjects.Container;
  private visible = false;

  // Static chrome kept around so relayout() can re-centre it for the live width.
  private readonly dim: Phaser.GameObjects.Rectangle;
  private readonly panel: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly resumeBtn: Phaser.GameObjects.Container;
  private readonly helpBtn: Phaser.GameObjects.Container;
  private readonly quitBtn: Phaser.GameObjects.Container;

  /** callback the UIScene supplies to actually resume the game. */
  private onResume: () => void = () => {};
  /** callback the UIScene supplies to open the guide overlay. */
  private onHelp: () => void = () => {};

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // The panel graphics is drawn around this FIXED reference centre; relayout()
    // then shifts the whole panel object's x to the live centre on each show().
    const cx = GAME.WIDTH / 2;
    const cy = GAME.HEIGHT / 2;

    this.root = scene.add.container(0, 0);
    this.root.setScrollFactor(0).setDepth(DEPTH.POPTEXT + 20).setVisible(false);

    // dim
    this.dim = scene.add
      .rectangle(cx, cy, GAME.WIDTH, GAME.HEIGHT, 0x05040a, 0.8)
      .setScrollFactor(0);
    this.root.add(this.dim);

    // central panel
    const panelW = 1420;
    const panelH = 800;
    this.panel = scene.add.graphics();
    this.panel.fillStyle(0x000000, 0.5).fillRoundedRect(cx - panelW / 2 + 10, cy - panelH / 2 + 14, panelW, panelH, 28);
    this.panel.fillStyle(COLORS.PANEL, 0.98).fillRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 28);
    this.panel.lineStyle(6, COLORS.PANEL_BORDER, 1).strokeRoundedRect(cx - panelW / 2, cy - panelH / 2, panelW, panelH, 28);
    this.root.add(this.panel);

    // "PAUSED" heading
    this.title = scene.add
      .text(cx, cy - panelH / 2 + 88, 'PAUSED', {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '80px',
        color: '#e8e0d0',
        stroke: '#1a1208',
        strokeThickness: 10,
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.root.add(this.title);

    // buttons (resume / guide / quit)
    const by = cy + panelH / 2 - 88;
    this.resumeBtn = this.makeButton(cx - 340, by, '재개', COLORS.GOLD, () => {
      this.resume();
    });
    this.helpBtn = this.makeButton(cx, by, '가이드', COLORS.PARCHMENT, () => {
      this.onHelp();
    });
    this.quitBtn = this.makeButton(cx + 340, by, '메뉴로', COLORS.BLOOD, () => {
      this.quit();
    });
    this.root.add(this.resumeBtn);
    this.root.add(this.helpBtn);
    this.root.add(this.quitBtn);
  }

  /**
   * Re-centre the static chrome (dim, panel, title, buttons) for the current
   * LIVE width. The panel graphics was drawn around GAME.WIDTH/2, so shifting
   * its object x by (liveCx - GAME.WIDTH/2) re-centres it without a redraw.
   */
  private relayout(): void {
    const w = this.scene.scale.width;
    const cx = w / 2;
    this.dim.setPosition(cx, GAME.HEIGHT / 2).setSize(w, GAME.HEIGHT);
    this.panel.x = cx - GAME.WIDTH / 2;
    this.title.setX(cx);
    this.resumeBtn.setX(cx - 340);
    this.helpBtn.setX(cx);
    this.quitBtn.setX(cx + 340);
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** Provide the resume callback (the UIScene wires this to scene.resume). */
  setOnResume(cb: () => void): void {
    this.onResume = cb;
  }

  /** Provide the callback that opens the guide overlay. */
  setOnHelp(cb: () => void): void {
    this.onHelp = cb;
  }

  show(summary: PauseSummary): void {
    this.relayout(); // re-centre chrome for the current live width first
    this.rebuildBody(summary);
    this.visible = true;
    this.root.setVisible(true);
    this.root.setAlpha(0);
    this.scene.tweens.add({ targets: this.root, alpha: 1, duration: 160, ease: 'Quad.Out' });
  }

  hide(): void {
    this.visible = false;
    this.root.setVisible(false);
  }

  /** Resume the game (button + ESC both route here). */
  resume(): void {
    if (!this.visible) return;
    // The button's own click already played; the rate limiter coalesces them.
    Sound.play('uiClick');
    this.hide();
    this.onResume();
  }

  private quit(): void {
    this.hide();
    this.scene.scene.stop(SCENES.GAME);
    this.scene.scene.start(SCENES.MENU);
  }

  destroy(): void {
    this.root.destroy();
  }

  /* --------------------------------------------------------------- */
  /* Build summary                                                   */
  /* --------------------------------------------------------------- */

  private rebuildBody(s: PauseSummary): void {
    if (this.body) this.body.destroy();
    const scene = this.scene;
    const cx = scene.scale.width / 2; // live width: keep the body centred
    const cy = GAME.HEIGHT / 2;
    const body = scene.add.container(0, 0).setScrollFactor(0);
    this.body = body;
    this.root.add(body);

    // Two-column body: run summary + gear on the left half, stat grid right.
    const panelW = 1420;
    const leftCx = cx - panelW / 4; // centre of the left half
    const left = cx - panelW / 2 + 68;

    // --- stat summary row (time / level / kills / gold) ---
    const statsY = cy - 192;
    const mmss = this.formatTime(s.elapsedMs);
    const statLine = `시간 ${mmss}    레벨 ${s.level}    처치 ${s.kills}    골드 ${s.gold}`;
    const stats = scene.add
      .text(leftCx, statsY, statLine, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '26px',
        color: '#c9a24b',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    body.add(stats);

    const hpLine = scene.add
      .text(leftCx, statsY + 38, `HP  ${Math.ceil(s.hp)} / ${Math.round(s.maxHp)}`, {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
        fontSize: '20px',
        color: '#e24b58',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    body.add(hpLine);

    // --- weapons row ---
    const wLabelY = cy - 104;
    body.add(this.sectionLabel(left, wLabelY, '무기'));
    this.iconRow(body, left, wLabelY + 52, s.weapons);

    // --- items row ---
    const iLabelY = cy + 12;
    body.add(this.sectionLabel(left, iLabelY, '아이템'));
    if (s.items.length === 0) {
      body.add(
        scene.add
          .text(left, iLabelY + 52, '없음', {
            fontFamily: 'Cinzel, "Noto Serif KR", serif',
            fontSize: '28px',
            color: '#9a8f78',
          })
          .setOrigin(0, 0.5)
          .setScrollFactor(0)
      );
    } else {
      this.iconRow(body, left, iLabelY + 52, s.items);
    }

    // --- full player stat grid (right half) ---
    const gridX = cx + 48;
    body.add(this.sectionLabel(gridX, statsY, '스탯'));
    this.statGrid(body, gridX, statsY + 52, s.stats);
  }

  /**
   * 2-column grid of every PlayerStats entry. Values that differ from
   * DEFAULT_STATS render gold so buffed/spent stats pop at a glance.
   */
  private statGrid(
    parent: Phaser.GameObjects.Container,
    x: number,
    y0: number,
    stats: PlayerStats
  ): void {
    const colW = 316;
    const rowH = 44;
    const rows = 9;
    for (let i = 0; i < STAT_ROWS.length; i++) {
      const [key, label, fmt] = STAT_ROWS[i];
      const colX = x + Math.floor(i / rows) * colW;
      const y = y0 + (i % rows) * rowH;

      parent.add(
        this.scene.add
          .text(colX, y, label, {
            fontFamily: 'Cinzel, "Noto Serif KR", serif',
            fontStyle: '700',
            fontSize: '22px',
            color: '#d8c9a0',
          })
          .setOrigin(0, 0.5)
          .setScrollFactor(0)
      );

      const v = stats[key];
      // epsilon compare: item math can leave float noise on the multipliers
      const changed = Math.abs(v - DEFAULT_STATS[key]) > 1e-9;
      parent.add(
        this.scene.add
          .text(colX + colW - 36, y, fmt(v), {
            fontFamily: '"Press Start 2P", Galmuri11, monospace',
            fontSize: '18px',
            color: changed ? '#f0d896' : '#9a8f78',
          })
          .setOrigin(1, 0.5)
          .setScrollFactor(0)
      );
    }
  }

  private sectionLabel(x: number, y: number, text: string): Phaser.GameObjects.Text {
    return this.scene.add
      .text(x, y, text, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '32px',
        color: '#d8c9a0',
      })
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
  }

  /** Draw a horizontal row of framed icon slots with a level badge. */
  private iconRow(
    parent: Phaser.GameObjects.Container,
    startX: number,
    y: number,
    views: Array<OwnedWeaponView | OwnedItemView>
  ): void {
    const slot = 80;
    const gap = 16;
    for (let i = 0; i < views.length; i++) {
      const v = views[i];
      const x = startX + slot / 2 + i * (slot + gap);
      const cell = this.scene.add.container(x, y).setScrollFactor(0);

      const box = this.scene.add.graphics();
      box.fillStyle(0x0c0a14, 1).fillRoundedRect(-slot / 2, -slot / 2, slot, slot, 12);
      const maxed = v.level >= v.maxLevel;
      box
        .lineStyle(4, maxed ? COLORS.GOLD : COLORS.PANEL_BORDER, 1)
        .strokeRoundedRect(-slot / 2, -slot / 2, slot, slot, 12);
      cell.add(box);

      const icon = this.makeIcon(v.icon, 0, -4, 52);
      cell.add(icon);

      // level text bottom-right, on a small backing chip so it stays legible
      // over any icon colour.
      const lvlLabel = maxed ? 'MAX' : `${v.level}`;
      const lvl = this.scene.add
        .text(0, 0, lvlLabel, {
          fontFamily: '"Press Start 2P", Galmuri11, monospace',
          fontSize: maxed ? '15px' : '18px',
          color: maxed ? '#f0d896' : '#e8e0d0',
        })
        .setOrigin(1, 1)
        .setScrollFactor(0);
      const chipX = slot / 2 - 1;
      const chipY = slot / 2 - 1;
      const chip = this.scene.add
        .rectangle(chipX, chipY, lvl.width + 8, lvl.height + 4, 0x0a0a12, 0.82)
        .setOrigin(1, 1)
        .setScrollFactor(0);
      lvl.setPosition(chipX - 4, chipY - 2);
      cell.add(chip);
      cell.add(lvl);

      parent.add(cell);
    }
  }

  private makeIcon(icon: IconRef, x: number, y: number, targetSize: number): Phaser.GameObjects.Image {
    let img: Phaser.GameObjects.Image;
    if (icon.frame >= 0) {
      img = this.scene.add.image(x, y, icon.texture, icon.frame);
    } else {
      img = this.scene.add.image(x, y, icon.texture);
    }
    const base = Math.max(img.width, img.height) || 16;
    img.setScale(targetSize / base).setScrollFactor(0);
    return img;
  }

  private makeButton(
    x: number,
    y: number,
    label: string,
    accent: number,
    onClick: () => void
  ): Phaser.GameObjects.Container {
    const scene = this.scene;
    const w = 320;
    const h = 88;
    const c = scene.add.container(x, y).setScrollFactor(0);

    const bg = scene.add.graphics();
    const draw = (hot: boolean) => {
      bg.clear();
      bg.fillStyle(hot ? COLORS.PANEL_LIGHT : COLORS.PANEL, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 16);
      bg.lineStyle(4, accent, hot ? 1 : 0.8).strokeRoundedRect(-w / 2, -h / 2, w, h, 16);
    };
    draw(false);
    c.add(bg);

    const txt = scene.add
      .text(0, 0, label, {
        fontFamily: 'Cinzel, "Noto Serif KR", serif',
        fontStyle: '700',
        fontSize: '36px',
        color: '#e8e0d0',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    c.add(txt);

    const zone = scene.add.zone(0, 0, w, h).setOrigin(0.5).setInteractive({ useHandCursor: true });
    c.add(zone);

    zone.on('pointerover', () => {
      Sound.play('uiHover');
      draw(true);
      scene.tweens.add({ targets: c, scale: 1.05, duration: 100, ease: 'Quad.Out' });
    });
    zone.on('pointerout', () => {
      draw(false);
      scene.tweens.add({ targets: c, scale: 1, duration: 100, ease: 'Quad.Out' });
    });
    zone.on('pointerdown', () => {
      Sound.play('uiClick');
      onClick();
    });

    return c;
  }

  private formatTime(ms: number): string {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}
