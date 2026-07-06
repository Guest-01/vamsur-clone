import Phaser from 'phaser';

// Bundle the webfonts (offline-safe; no CDN dependency at runtime).
import '@fontsource/press-start-2p';
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/700.css';
// Korean glyphs (both SIL OFL): Noto Serif KR pairs with Cinzel for display
// text; Galmuri11 pairs with Press Start 2P for pixel text. Galmuri is
// registered manually from the single woff2 we use — importing the package
// css would bundle every face (plus ttf fallbacks) into the build.
import '@fontsource/noto-serif-kr/400.css';
import '@fontsource/noto-serif-kr/700.css';
import galmuri11Url from 'galmuri/dist/Galmuri11.woff2';

import { GAME } from './config/balance';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { GameOverScene } from './scenes/GameOverScene';
import { ShopScene } from './scenes/ShopScene';

/**
 * Landscape-first responsive scaling: the design HEIGHT is fixed at 1080, and
 * the design WIDTH is set to match the screen's (clamped) landscape aspect, so
 * Scale.FIT fills the screen edge-to-edge with no letterbox in landscape. All
 * UI is anchored to the LIVE width (`this.scale.width`); the height never
 * changes, so vertical layout is stable. Portrait is handled by the CSS
 * "rotate your device" overlay in index.html.
 */
const BASE_HEIGHT = GAME.HEIGHT; // 1080
const MIN_AR = 16 / 9; // never narrower than 16:9 (portrait clamps up to this)
const MAX_AR = 21 / 9; // cap ultra-wide so the world doesn't get too zoomed-out

function designWidth(): number {
  const w = window.innerWidth || BASE_HEIGHT * MIN_AR;
  const h = window.innerHeight || BASE_HEIGHT;
  const ar = Phaser.Math.Clamp(w / h, MIN_AR, MAX_AR);
  return Math.round(BASE_HEIGHT * ar);
}

/** Wait for the pixel + display fonts so canvas text renders correctly. */
async function waitForFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    // Register the Galmuri11 face from its bundled woff2 (see imports above).
    const galmuri = new FontFace('Galmuri11', `url(${galmuri11Url}) format('woff2')`);
    (document as any).fonts.add(await galmuri.load());
    await Promise.all([
      (document as any).fonts.load('16px "Press Start 2P"'),
      (document as any).fonts.load('16px "Cinzel"'),
      (document as any).fonts.load('700 16px "Cinzel"'),
      // A Korean sample string pulls in the right unicode-range subsets.
      (document as any).fonts.load('16px "Noto Serif KR"', '가나다'),
      (document as any).fonts.load('700 16px "Noto Serif KR"', '가나다'),
    ]);
    await (document as any).fonts.ready;
  } catch {
    /* fall back to system fonts */
  }
}

function startGame(): void {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: 'game',
    width: designWidth(),
    height: BASE_HEIGHT,
    backgroundColor: '#07070c',
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: {
      activePointers: 3, // multitouch: joystick + on-screen buttons at once
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scene: [BootScene, MenuScene, GameScene, UIScene, GameOverScene, ShopScene],
  };

  const game = new Phaser.Game(config);

  // Keep the design size in sync with the screen aspect (fluid width). FIT then
  // fills the screen; scenes receive the Scale 'resize' event and re-lay-out.
  let pending = 0;
  const apply = (): void => {
    pending = 0;
    game.scale.setGameSize(designWidth(), BASE_HEIGHT);
  };
  const onResize = (): void => {
    if (!pending) pending = window.requestAnimationFrame(apply);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  // Block the long-press context menu on touch devices.
  window.addEventListener('contextmenu', (e) => e.preventDefault());
}

waitForFonts().then(startGame);
