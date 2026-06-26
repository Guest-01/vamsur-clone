import Phaser from 'phaser';
import { GAME, COLORS, DEPTH } from '../config/balance';

/** One titled block of guide text. */
interface Section {
  header: string;
  body: string[];
}

const LEFT: Section[] = [
  {
    header: '목표',
    body: [
      '8분간 살아남으면 승리한다. 자동 공격으로 적을 처치해 경험치를 모으고, 레벨업으로 점점 강해진다. 후반에는 강력한 보스가 나타난다.',
    ],
  },
  {
    header: '조작',
    body: [
      '이동      —   W A S D  /  방향키',
      '공격      —   자동 (무기마다 방식이 다르다)',
      '강화 선택  —   1  2  3   ·   ← →   ·   Enter',
      '일시정지   —   ESC',
    ],
  },
  {
    header: '성장',
    body: [
      '보석을 주워 경험치를 채우면 레벨업한다. 레벨업마다 카드 3장 중 하나를 골라 새 무기를 얻거나, 가진 무기·아이템을 강화한다. (무기·아이템 각각 최대 6종)',
    ],
  },
];

const RIGHT: Section[] = [
  {
    header: '획득물',
    body: [
      '보석 — 경험치 (밝을수록 큰 값)',
      '붉은 포션 — 체력 회복',
      '동전 — 골드',
      '보물상자 — 정예가 떨굼, 즉시 강화',
      '자석 — 화면의 보석을 모두 흡수',
    ],
  },
  {
    header: '적',
    body: [
      '시간이 지날수록 적의 수·체력·피해가 늘어난다. 정예는 보물상자를, 보스는 큰 보상을 남긴다.',
    ],
  },
  {
    header: '팁',
    body: [
      '· 계속 움직여 포위를 피하라',
      '· 자력을 올리면 보석 수급이 편하다',
      '· 쿨다운·위력은 어떤 빌드에도 강하다',
      '· 행운(Clover)은 새 무기·고급 강화 등장률 ↑',
      '· 무기 하나를 끝까지 키우는 집중 빌드도 강력',
    ],
  },
];

const GLOSSARY: Section[] = [
  {
    header: '스탯 용어',
    body: [
      '위력 (Might·MGT) — 모든 피해 배율',
      '범위 (Area) — 무기 크기·반경',
      '쿨다운 (Cooldown) — 공격 간격 ↓',
      '개수 (Amount) — 투사체·효과 수',
      '투사체속도 (Speed) — 날아가는 속도',
      '지속 (Duration) — 효과 지속시간',
      '자력 (Magnet) — 보석 흡수 범위',
      '방어 (Armor) — 받는 피해 감소',
      '재생 (Recovery) — 초당 체력 회복',
      '치명타 (Crit·CRIT) — 추가 피해 확률·배율',
      '회피 (Dodge) — 피해 무효 확률',
      '행운 (Luck) — 좋은 강화 등장률 ↑',
      '경험치 (Growth) — 획득 경험치 ↑',
      '부활 (Revive) — 사망 시 되살아남',
    ],
  },
];

/**
 * Reusable "How to play" guide. Built once, toggled with show()/hide(). Used by
 * both the MenuScene (press H / button) and, during a run, by the PauseOverlay
 * (가이드 button). The host scene routes the close key (ESC/H); a visible 닫기
 * button is provided too. Depth sits above the pause + level-up overlays.
 */
export class HelpOverlay {
  private readonly scene: Phaser.Scene;
  private readonly root: Phaser.GameObjects.Container;
  private visible = false;
  private onCloseCb?: () => void;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    // The panel + columns are built lazily in build() (called from show()) so
    // they are centred for whatever the LIVE width is at the time of opening.
    this.root = scene.add
      .container(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.POPTEXT + 40)
      .setVisible(false);
  }

  /**
   * (Re)build the full panel centred for the current LIVE width. Cheap enough to
   * run on every show(); a prior build's objects are cleared first so repeated
   * opens (and post-rotation re-centring) stay correct.
   */
  private build(): void {
    const scene = this.scene;
    this.root.removeAll(true);

    const cx = scene.scale.width / 2; // live width: re-centre horizontally
    const cy = GAME.HEIGHT / 2; // fixed design height (1080)

    // backdrop
    const dim = scene.add
      .rectangle(cx, cy, scene.scale.width, GAME.HEIGHT, 0x05040a, 0.86)
      .setScrollFactor(0)
      // interactive so it swallows clicks (otherwise they fall through to the
      // menu's character cards underneath, which are interactive).
      .setInteractive();
    this.root.add(dim);

    // panel (three columns: how-to-play / world+tips / stat glossary)
    const pw = 1600;
    const ph = 940;
    const panel = scene.add.graphics();
    panel.fillStyle(0x000000, 0.5).fillRoundedRect(cx - pw / 2 + 6, cy - ph / 2 + 8, pw, ph, 18);
    panel.fillStyle(COLORS.PANEL, 0.98).fillRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 18);
    panel.lineStyle(4, COLORS.PANEL_BORDER, 1).strokeRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 18);
    this.root.add(panel);

    const top = cy - ph / 2;
    const left = cx - pw / 2;

    // title
    const title = scene.add
      .text(cx, top + 60, '플레이 가이드', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '56px',
        color: '#f0d896',
        stroke: '#1a1208',
        strokeThickness: 6,
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.root.add(title);

    // divider under the title
    const divY = top + 110;
    const colTop = divY + 36;

    // three-column geometry
    const pad = 56;
    const gap = 40;
    const colW = (pw - 2 * pad - 2 * gap) / 3;
    const wrapW = colW - 12;
    const c1 = left + pad;
    const c2 = c1 + colW + gap;
    const c3 = c2 + colW + gap;

    const div = scene.add.graphics();
    div.lineStyle(2, COLORS.PANEL_BORDER, 1).lineBetween(left + 60, divY, left + pw - 60, divY);
    // two vertical dividers between the three columns
    const vdTop = divY + 20;
    const vdBot = top + ph - 110;
    div.lineBetween(c1 + colW + gap / 2, vdTop, c1 + colW + gap / 2, vdBot);
    div.lineBetween(c2 + colW + gap / 2, vdTop, c2 + colW + gap / 2, vdBot);
    this.root.add(div);

    // columns: how-to-play / world + tips / stat glossary
    this.renderColumn(c1, colTop, wrapW, LEFT);
    this.renderColumn(c2, colTop, wrapW, RIGHT);
    this.renderColumn(c3, colTop, wrapW, GLOSSARY);

    // close button + hint
    this.makeCloseButton(cx, top + ph - 56);
    const hint = scene.add
      .text(cx, top + ph - 22, 'ESC 또는 H 키로 닫기', {
        fontFamily: 'Cinzel, serif',
        fontSize: '22px',
        color: '#9a8f78',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    this.root.add(hint);
  }

  /* --------------------------------------------------------------- */

  setOnClose(cb: () => void): void {
    this.onCloseCb = cb;
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.build(); // (re)build centred for the current live width
    this.visible = true;
    this.root.setVisible(true).setAlpha(0);
    this.scene.tweens.add({ targets: this.root, alpha: 1, duration: 160, ease: 'Quad.Out' });
  }

  hide(): void {
    this.visible = false;
    this.root.setVisible(false);
  }

  toggle(): void {
    if (this.visible) this.close();
    else this.show();
  }

  private close(): void {
    this.hide();
    this.onCloseCb?.();
  }

  destroy(): void {
    this.root.destroy();
  }

  /* --------------------------------------------------------------- */

  /** Stack a column of sections from `startY`, advancing by real text height. */
  private renderColumn(x: number, startY: number, wrapW: number, sections: Section[]): void {
    let y = startY;
    for (const sec of sections) {
      const header = this.scene.add
        .text(x, y, sec.header, {
          fontFamily: 'Cinzel, serif',
          fontStyle: '700',
          fontSize: '30px',
          color: '#c9a24b',
        })
        .setOrigin(0, 0)
        .setScrollFactor(0);
      this.root.add(header);
      y += header.height + 12;

      for (const line of sec.body) {
        const t = this.scene.add
          .text(x + 6, y, line, {
            fontFamily: 'Cinzel, serif',
            fontSize: '22px',
            color: '#d8c9a0',
            wordWrap: { width: wrapW },
            lineSpacing: 4,
          })
          .setOrigin(0, 0)
          .setScrollFactor(0);
        this.root.add(t);
        y += t.height + 8;
      }
      y += 26; // gap between sections
    }
  }

  private makeCloseButton(x: number, y: number): void {
    const scene = this.scene;
    const w = 220;
    const h = 56;
    const c = scene.add.container(x, y).setScrollFactor(0);

    const bg = scene.add.graphics();
    const draw = (hot: boolean) => {
      bg.clear();
      bg.fillStyle(hot ? COLORS.PANEL_LIGHT : COLORS.PANEL, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 10);
      bg.lineStyle(3, COLORS.GOLD, hot ? 1 : 0.8).strokeRoundedRect(-w / 2, -h / 2, w, h, 10);
    };
    draw(false);
    c.add(bg);

    const txt = scene.add
      .text(0, 0, '닫기', {
        fontFamily: 'Cinzel, serif',
        fontStyle: '700',
        fontSize: '24px',
        color: '#e8e0d0',
      })
      .setOrigin(0.5)
      .setScrollFactor(0);
    c.add(txt);

    const zone = scene.add.zone(0, 0, w, h).setOrigin(0.5).setInteractive({ useHandCursor: true });
    c.add(zone);
    zone.on('pointerover', () => {
      draw(true);
      txt.setColor('#f0d896');
    });
    zone.on('pointerout', () => {
      draw(false);
      txt.setColor('#e8e0d0');
    });
    zone.on('pointerdown', () => this.close());

    this.root.add(c);
  }
}
