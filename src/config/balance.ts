/**
 * Central balance / tuning constants and curve functions.
 * Pure data + pure functions only (no Phaser, no side effects).
 */
import type { PlayerStats } from '../types';

/**
 * Internal render resolution (the backing-store size; FIT-scaled to the window).
 * This is the 2x "design space": the world camera renders at zoom 2 so the
 * field-of-view matches a 960x540 view, but everything is rasterised at full
 * 1080p sharpness instead of being upscaled from a 540p buffer.
 */
export const GAME = {
  WIDTH: 1920,
  HEIGHT: 1080,
} as const;

/** World camera zoom — keeps the 960x540-equivalent field of view at 2x res. */
export const CAMERA_ZOOM = 2;

/** Global display scale applied to 16px sheet sprites (16 -> 32 world px). */
export const ENTITY_SCALE = 2;

/** z-ordering. */
export const DEPTH = {
  BG: 0,
  SHADOW: 5,
  PICKUP: 10,
  CORPSE: 12,
  ENEMY: 20,
  PLAYER: 25,
  PROJECTILE: 30,
  FX: 40,
  POPTEXT: 50,
  VIGNETTE: 90,
} as const;

/** Gothic palette. */
export const COLORS = {
  GOLD: 0xc9a24b,
  GOLD_LIGHT: 0xf0d896,
  BLOOD: 0xb02436,
  BLOOD_LIGHT: 0xe24b58,
  BONE: 0xe8e0d0,
  PARCHMENT: 0xd8c9a0,
  PANEL: 0x161420,
  PANEL_LIGHT: 0x241f30,
  PANEL_BORDER: 0x4a3f2a,
  XP_BAR: 0x49b0ff,
  XP_BAR_DARK: 0x1c4a78,
  HP_BAR: 0xc0303a,
  HP_BAR_DARK: 0x471216,
  SHADOW: 0x000000,
  TEXT: 0xe8e0d0,
  TEXT_DIM: 0x9a8f78,
  ENEMY_FLASH: 0xffffff,
  GEM_S: 0x49b0ff, // blue (small)
  GEM_M: 0x49ff8a, // green (medium)
  GEM_L: 0xff5bd0, // magenta (large)
} as const;

/** Rarity tier border colours for level-up cards. */
export const RARITY = {
  COMMON: 0x8a8a9a,
  UNCOMMON: 0x49b0ff,
  RARE: 0xb066ff,
  LEGENDARY: 0xf0a83c,
} as const;

/** Baseline player stats before character overrides + items. */
export const DEFAULT_STATS: PlayerStats = {
  maxHp: 100,
  hpRegen: 0.5,
  moveSpeed: 165,
  might: 1,
  area: 1,
  cooldownMult: 1,
  projectileSpeed: 1,
  amount: 0,
  duration: 1,
  magnet: 80,
  armor: 0,
  xpGain: 1,
  luck: 1,
  critChance: 0.05,
  critMult: 2,
  revives: 0,
  dodge: 0,
  greed: 1,
  rerolls: 0,
};

/** Clamp helpers used when applying stats. */
export const STAT_CLAMP = {
  COOLDOWN_MULT_MIN: 0.4,
  MOVE_SPEED_MAX: 420,
} as const;

/* ------------------------------------------------------------------ */
/* Experience curve                                                    */
/* ------------------------------------------------------------------ */

/** XP required to advance FROM `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  // gentle early ramp so the demo levels quickly, then steepens.
  if (level <= 1) return 8;
  if (level <= 20) return Math.floor(8 + (level - 1) * 9 + Math.pow(level, 1.55));
  return Math.floor(170 + (level - 20) * 24);
}

/* ------------------------------------------------------------------ */
/* XP gem tiers                                                        */
/* ------------------------------------------------------------------ */

export const GEM_TIERS = {
  /** value < MED_AT -> small blue gem; < LARGE_AT -> green; else magenta */
  MED_AT: 5,
  LARGE_AT: 20,
} as const;

/* ------------------------------------------------------------------ */
/* Player combat feel                                                  */
/* ------------------------------------------------------------------ */

export const PLAYER = {
  /** invulnerability window after taking a hit (ms) */
  IFRAME_MS: 600,
  /** body radius (logical px, pre-scale) for movement collisions */
  BODY_RADIUS: 5,
  /** how long the hurt tint/flash lasts (ms) */
  HURT_FLASH_MS: 120,
  /** spawn position */
  START_X: 0,
  START_Y: 0,
} as const;

/* ------------------------------------------------------------------ */
/* Pickups                                                             */
/* ------------------------------------------------------------------ */

export const PICKUP = {
  /** speed (px/s) gems fly toward player once within magnet radius */
  MAGNET_SPEED: 520,
  /** acceleration applied while homing */
  MAGNET_ACCEL: 1400,
  /** auto-collect radius regardless of magnet stat */
  GRAB_RADIUS: 22,
  HEALTH_HEAL: 30,
  GOLD_VALUE: 4,
  /** chest grants this many upgrade rolls */
  CHEST_ROLLS: 1,
  /** per-kill chance to drop a health potion / a vacuum magnet */
  HEALTH_DROP: 0.008,
  MAGNET_DROP: 0.0015,
} as const;

/* ------------------------------------------------------------------ */
/* Difficulty scaling over time                                        */
/* ------------------------------------------------------------------ */

/** Enemy HP multiplier as a function of elapsed minutes. */
export function hpScale(elapsedMs: number): number {
  const min = elapsedMs / 60000;
  return 1 + min * 0.35 + Math.pow(min, 1.4) * 0.05;
}

/** Enemy contact-damage multiplier as a function of elapsed minutes. */
export function damageScale(elapsedMs: number): number {
  const min = elapsedMs / 60000;
  return 1 + min * 0.12;
}

/** Enemy move-speed multiplier as a function of elapsed minutes. */
export function speedScale(elapsedMs: number): number {
  const min = elapsedMs / 60000;
  return 1 + min * 0.04;
}

/* ------------------------------------------------------------------ */
/* Hard mode — the Curse Contract                                      */
/* ------------------------------------------------------------------ */

/** Highest selectable curse level. */
export const MAX_CURSE = 5;

/**
 * Per-run multipliers for the chosen curse level (0 = base game). Unlocked one
 * level at a time: beating curse N unlocks N+1 (see MetaState.maxCurseCleared).
 */
export function curseMults(level: number): {
  enemyHp: number;
  enemyDmg: number;
  cap: number;
  gold: number;
  xp: number;
} {
  const c = Math.max(0, level);
  return {
    enemyHp: 1 + 0.2 * c,
    enemyDmg: 1 + 0.1 * c,
    cap: 1 + 0.1 * c,
    gold: 1 + 0.25 * c,
    xp: 1 + 0.15 * c,
  };
}

/* ------------------------------------------------------------------ */
/* Run length                                                          */
/* ------------------------------------------------------------------ */

export const RUN = {
  /** survive this long to win (ms). */
  SURVIVE_MS: 8 * 60 * 1000,
  /** number of cards offered on level-up */
  LEVELUP_CHOICES: 3,
  /** weapon slot cap (VS-style) */
  MAX_WEAPONS: 6,
  /** passive item slot cap */
  MAX_ITEMS: 6,
} as const;

/** Spawn ring geometry: enemies appear just outside the view. */
export const SPAWN = {
  /** radius beyond the screen half-diagonal where enemies appear */
  RING_PAD: 90,
  /** despawn enemies that wander this far from the player */
  DESPAWN_DIST: 1400,
  /** max enemies in the pool */
  POOL_SIZE: 400,
} as const;
