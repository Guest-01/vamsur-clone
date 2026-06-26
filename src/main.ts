import Phaser from 'phaser';

// Bundle the webfonts (offline-safe; no CDN dependency at runtime).
import '@fontsource/press-start-2p';
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/700.css';

import { GAME } from './config/balance';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { GameOverScene } from './scenes/GameOverScene';
import { ShopScene } from './scenes/ShopScene';

/** Wait for the pixel + display fonts so canvas text renders correctly. */
async function waitForFonts(): Promise<void> {
  if (!('fonts' in document)) return;
  try {
    await Promise.all([
      (document as any).fonts.load('16px "Press Start 2P"'),
      (document as any).fonts.load('16px "Cinzel"'),
      (document as any).fonts.load('700 16px "Cinzel"'),
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
    width: GAME.WIDTH,
    height: GAME.HEIGHT,
    backgroundColor: '#07070c',
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'arcade',
      arcade: { gravity: { x: 0, y: 0 }, debug: false },
    },
    scene: [BootScene, MenuScene, GameScene, UIScene, GameOverScene, ShopScene],
  };

  // eslint-disable-next-line no-new
  new Phaser.Game(config);
}

waitForFonts().then(startGame);
