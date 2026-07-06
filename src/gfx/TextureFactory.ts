/**
 * Generates every procedural texture referenced by TEXTURES.* (the keys that
 * are not the dungeon spritesheet). Called once from BootScene.create().
 *
 * Crisp shapes use Graphics.generateTexture(); soft/gradient textures are drawn
 * on a raw <canvas> and registered with textures.addCanvas() for portability.
 */
import Phaser from 'phaser';
import { TEXTURES } from '../config/assets';
import { COLORS, GAME } from '../config/balance';

function rgba(c: number, a: number): string {
  const r = (c >> 16) & 0xff;
  const g = (c >> 8) & 0xff;
  const b = c & 0xff;
  return `rgba(${r},${g},${b},${a})`;
}

export class TextureFactory {
  static generateAll(scene: Phaser.Scene): void {
    this.pixel(scene);
    this.gems(scene);
    this.softDot(scene, TEXTURES.PARTICLE, 24, 0xffffff);
    this.spark(scene);
    this.aura(scene);
    this.ring(scene);
    this.bolt(scene);
    this.orb(scene);
    this.slash(scene);
    this.shadow(scene);
    this.knife(scene);
    this.bgTile(scene);
    this.vignette(scene);
    this.icons(scene);
  }

  /* --- helpers --- */

  private static gfx(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
    return scene.make.graphics({ x: 0, y: 0 }, false);
  }

  private static canvasTex(
    scene: Phaser.Scene,
    key: string,
    w: number,
    h: number,
    draw: (ctx: CanvasRenderingContext2D) => void
  ): void {
    if (scene.textures.exists(key)) scene.textures.remove(key);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    draw(ctx);
    scene.textures.addCanvas(key, canvas);
  }

  /* --- textures --- */

  private static pixel(scene: Phaser.Scene): void {
    const g = this.gfx(scene);
    g.fillStyle(0xffffff, 1).fillRect(0, 0, 1, 1);
    g.generateTexture(TEXTURES.PIXEL, 1, 1);
    g.destroy();
  }

  private static gem(scene: Phaser.Scene, key: string, size: number, color: number): void {
    const g = this.gfx(scene);
    const c = size / 2;
    // outline
    g.fillStyle(0x000000, 0.5);
    g.fillPoints(
      [
        new Phaser.Math.Vector2(c, 0),
        new Phaser.Math.Vector2(size, c),
        new Phaser.Math.Vector2(c, size),
        new Phaser.Math.Vector2(0, c),
      ],
      true
    );
    // body
    g.fillStyle(color, 1);
    const i = 1.5;
    g.fillPoints(
      [
        new Phaser.Math.Vector2(c, i),
        new Phaser.Math.Vector2(size - i, c),
        new Phaser.Math.Vector2(c, size - i),
        new Phaser.Math.Vector2(i, c),
      ],
      true
    );
    // top-left facet highlight
    g.fillStyle(0xffffff, 0.55);
    g.fillPoints(
      [
        new Phaser.Math.Vector2(c, i + 0.5),
        new Phaser.Math.Vector2(c, c),
        new Phaser.Math.Vector2(i + 1, c),
      ],
      true
    );
    g.generateTexture(key, size, size);
    g.destroy();
  }

  private static gems(scene: Phaser.Scene): void {
    this.gem(scene, TEXTURES.GEM_S, 10, COLORS.GEM_S);
    this.gem(scene, TEXTURES.GEM_M, 13, COLORS.GEM_M);
    this.gem(scene, TEXTURES.GEM_L, 17, COLORS.GEM_L);
  }

  private static softDot(scene: Phaser.Scene, key: string, size: number, color: number): void {
    this.canvasTex(scene, key, size, size, (ctx) => {
      const c = size / 2;
      const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0, rgba(color, 1));
      grad.addColorStop(0.4, rgba(color, 0.7));
      grad.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    });
  }

  private static spark(scene: Phaser.Scene): void {
    const g = this.gfx(scene);
    g.fillStyle(0xffffff, 1);
    // 4-point sparkle (two thin crossed diamonds)
    g.fillPoints(
      [new Phaser.Math.Vector2(6, 0), new Phaser.Math.Vector2(8, 6), new Phaser.Math.Vector2(6, 12), new Phaser.Math.Vector2(4, 6)],
      true
    );
    g.fillPoints(
      [new Phaser.Math.Vector2(0, 6), new Phaser.Math.Vector2(6, 4), new Phaser.Math.Vector2(12, 6), new Phaser.Math.Vector2(6, 8)],
      true
    );
    g.generateTexture(TEXTURES.SPARK, 12, 12);
    g.destroy();
  }

  private static aura(scene: Phaser.Scene): void {
    const size = 160;
    this.canvasTex(scene, TEXTURES.AURA, size, size, (ctx) => {
      const c = size / 2;
      const grad = ctx.createRadialGradient(c, c, c * 0.2, c, c, c);
      grad.addColorStop(0, 'rgba(255,255,255,0.30)');
      grad.addColorStop(0.7, 'rgba(255,255,255,0.14)');
      grad.addColorStop(0.92, 'rgba(255,255,255,0.22)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c, c, c, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private static ring(scene: Phaser.Scene): void {
    const g = this.gfx(scene);
    g.lineStyle(3, 0xffffff, 1);
    g.strokeCircle(20, 20, 17);
    g.generateTexture(TEXTURES.RING, 40, 40);
    g.destroy();
  }

  private static bolt(scene: Phaser.Scene): void {
    const w = 20;
    const h = 12;
    this.canvasTex(scene, TEXTURES.BOLT, w, h, (ctx) => {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.45, 'rgba(120,200,255,0.95)');
      grad.addColorStop(1, 'rgba(60,120,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private static orb(scene: Phaser.Scene): void {
    const size = 18;
    this.canvasTex(scene, TEXTURES.ORB, size, size, (ctx) => {
      const c = size / 2;
      const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.35, 'rgba(200,180,255,0.95)');
      grad.addColorStop(0.7, 'rgba(150,110,255,0.6)');
      grad.addColorStop(1, 'rgba(120,80,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(c, c, c, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private static slash(scene: Phaser.Scene): void {
    const w = 60;
    const h = 44;
    this.canvasTex(scene, TEXTURES.SLASH, w, h, (ctx) => {
      ctx.save();
      // crescent: big arc minus an offset arc
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(6, h / 2, h / 2 - 2, -Math.PI / 2.1, Math.PI / 2.1);
      ctx.arc(20, h / 2, h / 2 - 2, Math.PI / 2.1, -Math.PI / 2.1, true);
      ctx.closePath();
      ctx.fill();
      // soft outer glow edge
      ctx.strokeStyle = 'rgba(240,216,150,0.9)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    });
  }

  private static shadow(scene: Phaser.Scene): void {
    const w = 28;
    const h = 12;
    this.canvasTex(scene, TEXTURES.SHADOW, w, h, (ctx) => {
      const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grad.addColorStop(0, 'rgba(0,0,0,0.45)');
      grad.addColorStop(0.7, 'rgba(0,0,0,0.25)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private static knife(scene: Phaser.Scene): void {
    const g = this.gfx(scene);
    // blade points to the right (+x)
    g.fillStyle(0x6b5a3a, 1).fillRect(0, 3, 5, 2); // handle
    g.fillStyle(0xcfd6e0, 1);
    g.fillPoints(
      [
        new Phaser.Math.Vector2(5, 1),
        new Phaser.Math.Vector2(16, 4),
        new Phaser.Math.Vector2(5, 7),
      ],
      true
    );
    g.fillStyle(0xffffff, 0.8).fillRect(5, 3, 8, 1); // edge highlight
    g.generateTexture(TEXTURES.KNIFE, 16, 8);
    g.destroy();
  }

  private static bgTile(scene: Phaser.Scene): void {
    const S = 64;
    const g = this.gfx(scene);
    g.fillStyle(0x100e18, 1).fillRect(0, 0, S, S); // grout / base (dark)
    const stones = [
      { x: 1, y: 1, c: 0x1d1a28 },
      { x: 33, y: 1, c: 0x191622 },
      { x: 1, y: 33, c: 0x191622 },
      { x: 33, y: 33, c: 0x1d1a28 },
    ];
    for (const s of stones) {
      g.fillStyle(s.c, 1).fillRect(s.x, s.y, 30, 30);
      // top/left bevel
      g.fillStyle(0x262236, 1).fillRect(s.x, s.y, 30, 1);
      g.fillStyle(0x262236, 1).fillRect(s.x, s.y, 1, 30);
      // bottom/right shade
      g.fillStyle(0x0c0a12, 1).fillRect(s.x, s.y + 29, 30, 1);
      g.fillStyle(0x0c0a12, 1).fillRect(s.x + 29, s.y, 1, 30);
      // a couple of speckles (kept off the edges so tiling stays seamless)
      g.fillStyle(0x0d0b14, 1).fillRect(s.x + 8, s.y + 11, 3, 2);
      g.fillStyle(0x242031, 1).fillRect(s.x + 18, s.y + 20, 2, 2);
    }
    g.generateTexture(TEXTURES.BG_TILE, S, S);
    g.destroy();
  }

  private static vignette(scene: Phaser.Scene): void {
    const w = GAME.WIDTH;
    const h = GAME.HEIGHT;
    this.canvasTex(scene, TEXTURES.VIGNETTE, w, h, (ctx) => {
      const grad = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.32,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.72
      );
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(0,0,0,0.62)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    });
  }

  /* --- passive item icons (drawn @48px) --- */

  private static icons(scene: Phaser.Scene): void {
    const S = 48;
    const mk = (key: string, draw: (g: Phaser.GameObjects.Graphics) => void) => {
      const g = this.gfx(scene);
      draw(g);
      g.generateTexture(key, S, S);
      g.destroy();
    };
    const outline = (g: Phaser.GameObjects.Graphics) => g.lineStyle(2, 0x0a0a12, 0.9);

    // HEART
    mk(TEXTURES.ICON_HEART, (g) => {
      g.fillStyle(COLORS.BLOOD, 1);
      g.fillCircle(17, 18, 9);
      g.fillCircle(31, 18, 9);
      g.fillTriangle(9, 22, 39, 22, 24, 40);
      g.fillStyle(0xffffff, 0.35).fillCircle(15, 15, 3);
    });
    // FIST (might)
    mk(TEXTURES.ICON_FIST, (g) => {
      g.fillStyle(0xd9a86a, 1);
      g.fillRoundedRect(13, 16, 22, 20, 5);
      g.fillStyle(0xb07f45, 1);
      for (let i = 0; i < 4; i++) g.fillRect(16 + i * 5, 16, 3, 8);
      g.fillStyle(0xd9a86a, 1).fillRoundedRect(9, 20, 8, 10, 3); // thumb
    });
    // BOOT (speed)
    mk(TEXTURES.ICON_BOOT, (g) => {
      g.fillStyle(0x7a4a28, 1);
      g.fillRect(16, 8, 10, 22);
      g.fillRect(16, 26, 24, 10);
      g.fillStyle(0x4a2c18, 1).fillRect(14, 34, 28, 4);
      g.fillStyle(0xffffff, 0.25).fillRect(18, 10, 3, 18);
    });
    // HOURGLASS (cooldown)
    mk(TEXTURES.ICON_HOURGLASS, (g) => {
      g.fillStyle(COLORS.GOLD, 1);
      g.fillRect(13, 8, 22, 4);
      g.fillRect(13, 36, 22, 4);
      g.fillStyle(0xe8d7a0, 1);
      g.fillTriangle(15, 12, 33, 12, 24, 24);
      g.fillTriangle(24, 24, 15, 36, 33, 36);
      g.fillStyle(COLORS.BLOOD_LIGHT, 1).fillTriangle(19, 14, 29, 14, 24, 22);
    });
    // STAR (area / general)
    mk(TEXTURES.ICON_STAR, (g) => {
      g.fillStyle(COLORS.GOLD_LIGHT, 1);
      const cx = 24,
        cy = 24,
        r1 = 18,
        r2 = 8;
      const pts: Phaser.Math.Vector2[] = [];
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? r1 : r2;
        pts.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
      }
      g.fillPoints(pts, true);
    });
    // MAGNET
    mk(TEXTURES.ICON_MAGNET, (g) => {
      g.lineStyle(8, COLORS.BLOOD, 1);
      g.beginPath();
      g.arc(24, 22, 13, Math.PI, Math.PI * 2, false);
      g.strokePath();
      g.fillStyle(COLORS.BLOOD, 1);
      g.fillRect(11, 22, 8, 12);
      g.fillRect(29, 22, 8, 12);
      g.fillStyle(0xcfd6e0, 1);
      g.fillRect(11, 32, 8, 5);
      g.fillRect(29, 32, 8, 5);
    });
    // CLOVER (luck)
    mk(TEXTURES.ICON_CLOVER, (g) => {
      g.fillStyle(0x49b04a, 1);
      g.fillCircle(18, 18, 7);
      g.fillCircle(30, 18, 7);
      g.fillCircle(18, 30, 7);
      g.fillCircle(30, 30, 7);
      g.fillStyle(0x2f7a30, 1).fillRect(23, 24, 3, 16);
    });
    // SHIELD (armor)
    mk(TEXTURES.ICON_SHIELD, (g) => {
      g.fillStyle(0x8b94a6, 1);
      g.fillPoints(
        [
          new Phaser.Math.Vector2(24, 8),
          new Phaser.Math.Vector2(40, 13),
          new Phaser.Math.Vector2(38, 30),
          new Phaser.Math.Vector2(24, 42),
          new Phaser.Math.Vector2(10, 30),
          new Phaser.Math.Vector2(8, 13),
        ],
        true
      );
      g.fillStyle(0xb9c0cf, 1).fillPoints(
        [
          new Phaser.Math.Vector2(24, 12),
          new Phaser.Math.Vector2(24, 38),
          new Phaser.Math.Vector2(13, 28),
          new Phaser.Math.Vector2(12, 15),
        ],
        true
      );
    });
    // WING (projectile speed)
    mk(TEXTURES.ICON_WING, (g) => {
      g.fillStyle(0xeef2f7, 1);
      for (let i = 0; i < 4; i++) {
        const y = 12 + i * 6;
        g.fillTriangle(10, y, 40 - i * 5, y + 2, 12, y + 6);
      }
      g.fillStyle(0xc4ccd8, 1).fillRect(9, 11, 3, 28);
      outline(g);
    });
    // ECHO (projectile amount) — twin chevrons, the back one fainter
    mk(TEXTURES.ICON_ECHO, (g) => {
      const chevron = (x: number) => [
        new Phaser.Math.Vector2(x, 10),
        new Phaser.Math.Vector2(x + 7, 10),
        new Phaser.Math.Vector2(x + 18, 24),
        new Phaser.Math.Vector2(x + 7, 38),
        new Phaser.Math.Vector2(x, 38),
        new Phaser.Math.Vector2(x + 11, 24),
      ];
      g.fillStyle(0x9ad0ff, 0.55);
      g.fillPoints(chevron(8), true);
      g.fillStyle(0xeef2f7, 1);
      g.fillPoints(chevron(22), true);
    });
    // CLOAK (dodge) — hooded phantom with a jagged hem
    mk(TEXTURES.ICON_CLOAK, (g) => {
      g.fillStyle(0x584a86, 1);
      g.fillPoints(
        [
          new Phaser.Math.Vector2(24, 5),
          new Phaser.Math.Vector2(37, 16),
          new Phaser.Math.Vector2(39, 42),
          new Phaser.Math.Vector2(31, 35),
          new Phaser.Math.Vector2(24, 42),
          new Phaser.Math.Vector2(17, 35),
          new Phaser.Math.Vector2(9, 42),
          new Phaser.Math.Vector2(11, 16),
        ],
        true
      );
      g.fillStyle(0x0a0a12, 1).fillEllipse(24, 20, 16, 14); // hood shadow
      g.fillStyle(0xffffff, 0.18).fillCircle(15, 13, 3);
    });
    // COIN (gold) — bold gold disc with a stamped inner rim + glint. Replaces
    // the sheet's "coins" frame, which read as a barrel at small sizes.
    mk(TEXTURES.ICON_COIN, (g) => {
      g.fillStyle(0x7a5c18, 1).fillCircle(25, 26, 17); // bottom-edge shadow
      g.fillStyle(COLORS.GOLD, 1).fillCircle(24, 24, 17);
      g.fillStyle(COLORS.GOLD_LIGHT, 1).fillCircle(24, 24, 11);
      g.lineStyle(2, 0x8a6a1e, 1).strokeCircle(24, 24, 11); // stamped rim
      // centre diamond stamp
      g.fillStyle(COLORS.GOLD, 1).fillPoints(
        [
          new Phaser.Math.Vector2(24, 18),
          new Phaser.Math.Vector2(30, 24),
          new Phaser.Math.Vector2(24, 30),
          new Phaser.Math.Vector2(18, 24),
        ],
        true
      );
      g.fillStyle(0xffffff, 0.6).fillCircle(17, 16, 3); // glint
    });
    // MIRROR (fate) — gold hand mirror with a pale glass + diagonal glint
    mk(TEXTURES.ICON_MIRROR, (g) => {
      g.fillStyle(0x8a6a1e, 1).fillRoundedRect(21, 30, 6, 15, 3); // handle
      g.fillStyle(COLORS.GOLD, 1).fillCircle(24, 19, 14); // frame
      g.fillStyle(0x8fc8ea, 1).fillCircle(24, 19, 10); // glass
      g.fillStyle(0x5c93b8, 1).fillCircle(26, 21, 7); // glass depth
      g.lineStyle(3, 0xffffff, 0.75);
      g.lineBetween(19, 24, 28, 13); // glint stripe
      g.fillStyle(0xffffff, 0.85).fillCircle(20, 14, 2);
    });
    // LEAF (hp regen) — sprouting leaf with a stem
    mk(TEXTURES.ICON_LEAF, (g) => {
      g.fillStyle(0x49b04a, 1);
      g.fillPoints(
        [
          new Phaser.Math.Vector2(24, 6),
          new Phaser.Math.Vector2(36, 14),
          new Phaser.Math.Vector2(38, 27),
          new Phaser.Math.Vector2(24, 40),
          new Phaser.Math.Vector2(10, 27),
          new Phaser.Math.Vector2(12, 14),
        ],
        true
      );
      g.lineStyle(2, 0x2f7a30, 1);
      g.lineBetween(24, 10, 24, 36);
      g.lineBetween(24, 22, 32, 17);
      g.lineBetween(24, 22, 16, 17);
      g.fillStyle(0x7a4a28, 1).fillRect(22, 38, 4, 7);
    });
  }
}
