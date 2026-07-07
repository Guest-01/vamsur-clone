/**
 * Asset keys + spritesheet frame indices.
 *
 * The art is Kenney's "Tiny Dungeon" (CC0) — a 12x11 grid of 16x16 tiles packed
 * with no spacing into `tilemap_packed.png`. A frame index is `row * 12 + col`.
 * The indices below were identified visually from the packed sheet.
 *
 * `TEXTURES.*` that are NOT the sheet are procedural textures generated at boot
 * by `src/gfx/TextureFactory.ts`. Every key listed here MUST exist by the time
 * gameplay starts.
 */

export const SHEET = {
  KEY: 'tiles',
  URL: 'assets/sprites/tilemap_packed.png',
  FRAME_W: 16,
  FRAME_H: 16,
} as const;

export const TEXTURES = {
  /** the Kenney tiny-dungeon spritesheet (use with FRAMES.*) */
  SPRITES: SHEET.KEY,

  // --- generated: 1x1 white pixel for bars / solid rects ---
  PIXEL: 'gen-pixel',

  // --- generated: xp gems (tinted at runtime, 3 size tiers) ---
  GEM_S: 'gen-gem-s',
  GEM_M: 'gen-gem-m',
  GEM_L: 'gen-gem-l',

  // --- generated: fx ---
  PARTICLE: 'gen-particle', // soft round dot
  SPARK: 'gen-spark', // small bright streak
  AURA: 'gen-aura', // radial gradient disc (tinted at runtime)
  RING: 'gen-ring', // hollow ring (targeting / magnet pulse)
  BOLT: 'gen-bolt', // magic bolt projectile
  ORB: 'gen-orb', // orbiting orb
  SLASH: 'gen-slash', // melee slash arc (greatsword cyclone blades)
  LASH: 'gen-lash', // whip cord — long, thin, tapers from handle end to a fine tip
  SHADOW: 'gen-shadow', // soft ellipse drop-shadow under entities
  KNIFE: 'gen-knife', // thrown knife projectile (crisp)
  SPEAR: 'gen-spear', // thrown spear/lance projectile (crisp, longer than the knife)
  BOOMERANG: 'gen-boomerang', // spinning returning blade (projectile + icon)
  MINE: 'gen-mine', // planted proximity mine (world sprite)
  PICKUP_MAGNET: 'gen-pickup-magnet', // gold horseshoe — the vacuum floor drop
  // (distinct from the red ICON_MAGNET used by the passive item)

  // --- generated: background + overlays ---
  BG_TILE: 'gen-bgtile', // 64x64 tileable dark dungeon floor
  VIGNETTE: 'gen-vignette', // radial darkening overlay

  // --- generated: passive-item icons (16x16 logical, drawn @4x) ---
  ICON_HEART: 'gen-ic-heart',
  ICON_BOOT: 'gen-ic-boot',
  ICON_WING: 'gen-ic-wing',
  ICON_MAGNET: 'gen-ic-magnet',
  ICON_CLOVER: 'gen-ic-clover',
  ICON_STAR: 'gen-ic-star',
  ICON_SHIELD: 'gen-ic-shield',
  ICON_FIST: 'gen-ic-fist', // might / damage
  ICON_HOURGLASS: 'gen-ic-hourglass', // cooldown
  ICON_ECHO: 'gen-ic-echo', // projectile amount
  ICON_CLOAK: 'gen-ic-cloak', // dodge
  ICON_LEAF: 'gen-ic-leaf', // hp regen
  ICON_COIN: 'gen-ic-coin', // gold coin (sheet frame 82 reads as a barrel)
  ICON_MIRROR: 'gen-ic-mirror', // hand mirror (Mirror of Fate)

  // --- generated: weapon icons for weapons with no fitting sheet frame ---
  ICON_LIGHTNING: 'gen-ic-lightning', // jagged bolt (chain lightning)
  ICON_BOOMERANG: 'gen-ic-boomerang', // bent throwing blade
  ICON_MINE: 'gen-ic-mine', // spiked orb with a lit fuse eye
  ICON_FANG: 'gen-ic-fang', // blood drop + fangs (leech)
} as const;

/** Named frame indices into the tiny-dungeon spritesheet. */
export const FRAMES = {
  // characters
  KNIGHT: 96,
  MAGE: 84,
  ROGUE: 98,
  ELF: 112,
  CLERIC: 99, // long-haired figure
  WARRIOR: 87, // horned-helm viking

  // enemies
  ZOMBIE: 108, // green ghoul
  DEMON: 110, // red imp
  CULTIST: 111, // hooded figure
  SKELETON: 121, // pale skull
  SPIDER: 122,
  BAT: 120, // brown swarm-thing
  SKULL_CRAWLER: 124,
  MIMIC: 92, // toothy face — used for elite/boss

  // weapons (icons + some projectile sprites)
  DAGGER: 103,
  SWORD: 104,
  SWORD_GOLD: 105,
  SWORD_RED: 107,
  AXE: 118,
  HAMMER: 117,
  WAND_PINK: 129,
  WHIP: 130,
  WAND_BLUE: 131,

  // items / pickups
  POTION_RED: 115,
  POTION_GREEN: 114,
  POTION_BLUE: 116,
  BOTTLE: 113,
  SHIELD: 102,
  COINS: 82,
  CHEST: 89, // closed treasure chest (41 was a wall-alcove tile, not a chest)
} as const;

export type FrameName = keyof typeof FRAMES;
