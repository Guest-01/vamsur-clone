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
  // Hand-tuned discount for the first few levels: the single starting weapon
  // makes minute 0-1.5 the weakest stretch of the run, so the second/third
  // pick arrives sooner (was 19/31/43 via the formula below).
  const EARLY = [8, 14, 22, 30];
  if (level <= EARLY.length) return EARLY[level - 1];
  if (level <= 20) return Math.floor(8 + (level - 1) * 9 + Math.pow(level, 1.55));
  // linear tail continuing FROM the level-20 cost (282). The old constant here
  // (170) sat far below it, so the cost per level DROPPED at 21+ and late-run
  // level-ups sped back up — one more reason the endgame felt free.
  return Math.floor(282 + (level - 20) * 24);
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

/**
 * Enemy HP multiplier as a function of elapsed minutes.
 *
 * The quadratic term matters: player DPS grows multiplicatively (weapon level
 * × might × cooldown × amount), so a near-linear curve (the old min^1.4×0.05)
 * collapsed after ~4 minutes. Slightly under the old curve before ~2min
 * (easier early game), well above it late: ×3.2 @4min, ×7.1 @8min (was ×4.7).
 */
export function hpScale(elapsedMs: number): number {
  const min = elapsedMs / 60000;
  return 1 + min * 0.32 + min * min * 0.055;
}

/** Enemy contact-damage multiplier as a function of elapsed minutes. */
export function damageScale(elapsedMs: number): number {
  const min = elapsedMs / 60000;
  // gentle super-linear tail: ×1.8 @4min, ×2.8 @8min (was ×2.3 @8min) — by
  // then armor/dodge/maxHp have scaled too, so late hits must sting more.
  return 1 + min * 0.15 + Math.pow(min, 1.5) * 0.025;
}

/** Enemy move-speed multiplier as a function of elapsed minutes. */
export function speedScale(elapsedMs: number): number {
  const min = elapsedMs / 60000;
  return 1 + min * 0.04;
}

/* ------------------------------------------------------------------ */
/* Champions — randomly promoted spawns that spike the mid/late game   */
/* ------------------------------------------------------------------ */

/**
 * Chance for a regular wave spawn to be promoted to a champion (gold-tinted,
 * ×CHAMPION.HP_MULT hp, big gem on death). Zero for the first 3 minutes —
 * champions exist to punctuate the stretch where raw hordes stop threatening.
 */
export function championChance(elapsedMs: number): number {
  const min = elapsedMs / 60000;
  if (min < 3) return 0;
  return Math.min(0.06, 0.02 + (min - 3) * 0.008);
}

/** Stat multipliers applied over the base def when promoting a champion. */
export const CHAMPION = {
  HP_MULT: 5,
  DMG_MULT: 1.5,
  XP_MULT: 6,
  SCALE_MULT: 1.35,
  /** flat bonus, clamped to 0.9 (champions shrug off most knockback) */
  KNOCKBACK_RESIST_BONUS: 0.3,
  /** champions are worth looting: high flat coin chance */
  GOLD_CHANCE: 0.8,
  /** gold tint replaces the base def tint so promotions read at a glance */
  TINT: 0xffc94a,
} as const;

/* ------------------------------------------------------------------ */
/* Hard mode — the Curse Contract                                      */
/* ------------------------------------------------------------------ */

/** Highest selectable curse level. */
export const MAX_CURSE = 7;

/**
 * Per-run multipliers for the chosen curse level (0 = base game). Unlocked one
 * level at a time: beating curse N unlocks N+1 (see MetaState.maxCurseCleared).
 * Retuned upward (was hp +20%/dmg +10% per level) — the old max curse barely
 * outpaced a mid-game shop build; +35% hp and a speed creep per level bite.
 */
export function curseMults(level: number): {
  enemyHp: number;
  enemyDmg: number;
  enemySpeed: number;
  cap: number;
  gold: number;
  xp: number;
} {
  const c = Math.max(0, level);
  return {
    enemyHp: 1 + 0.35 * c,
    enemyDmg: 1 + 0.15 * c,
    enemySpeed: 1 + 0.04 * c,
    cap: 1 + 0.12 * c,
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
  /** max enemies in the pool — must cover the worst-case concurrent cap:
   *  final wave 270 × curse-7 cap mult 1.84 + blood-moon bonus 40 ≈ 537. */
  POOL_SIZE: 560,
} as const;
