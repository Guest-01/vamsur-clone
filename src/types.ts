/**
 * Shared type contract for the whole game. This file is the single source of
 * truth for the interfaces that the gameplay systems, entities, scenes and UI
 * implement and consume. Do NOT put runtime logic here — only types + small
 * const tables (scene keys, event names).
 *
 * Phaser is imported for TYPE usage only.
 */
import type Phaser from 'phaser';

/* ------------------------------------------------------------------ */
/* Scene keys + registry keys + event names                           */
/* ------------------------------------------------------------------ */

export const SCENES = {
  BOOT: 'Boot',
  MENU: 'Menu',
  GAME: 'Game',
  UI: 'UI',
  SHOP: 'Shop',
  GAME_OVER: 'GameOver',
} as const;

/** Events emitted on the GameScene's own EventEmitter (gameScene.events). */
export const EVENTS = {
  /** {current:number, max:number} */
  HP_CHANGED: 'hp-changed',
  /** {xp:number, xpToNext:number, level:number} */
  XP_CHANGED: 'xp-changed',
  /** {level:number, options:UpgradeOption[]} — game -> UI (gameplay is paused) */
  LEVEL_UP: 'level-up',
  /** {option:UpgradeOption} — UI -> game (player picked a card) */
  UPGRADE_CHOSEN: 'upgrade-chosen',
  /** {kills:number} */
  KILLS_CHANGED: 'kills-changed',
  /** {gold:number} */
  GOLD_CHANGED: 'gold-changed',
  /** {elapsedMs:number} emitted ~4x/sec */
  TIMER: 'timer',
  /** {owned: OwnedWeaponView[]} */
  WEAPONS_CHANGED: 'weapons-changed',
  /** {owned: OwnedItemView[]} */
  ITEMS_CHANGED: 'items-changed',
  /** {} player took damage (for HUD flash) */
  PLAYER_HIT: 'player-hit',
  /** {paused:boolean} */
  PAUSE_TOGGLED: 'pause-toggled',
  /** {victory:boolean, summary:RunSummary} */
  GAME_OVER: 'game-over',
} as const;

/** Phaser data-registry / scene-data keys. */
export const REGISTRY = {
  BEST_TIME: 'vs_best_time_ms',
  SELECTED_CHARACTER: 'vs_selected_character',
  MUTED: 'vs_muted',
  META: 'vs_meta_v1',
} as const;

/* ------------------------------------------------------------------ */
/* Player stats                                                        */
/* ------------------------------------------------------------------ */

/**
 * The complete mutable stat block for the player. Systems READ from a single
 * shared PlayerStats instance (the same object reference lives on
 * `player.stats`, `GameContext.stats`). Upgrades mutate it via
 * `GameContext.recomputeStats()`.
 */
export interface PlayerStats {
  maxHp: number;
  hpRegen: number; // hp per second
  moveSpeed: number; // px / second
  might: number; // outgoing damage multiplier (1 = 100%)
  area: number; // weapon area / size multiplier
  cooldownMult: number; // weapon cooldown multiplier, lower = faster (clamp >= 0.4)
  projectileSpeed: number; // projectile speed multiplier
  amount: number; // bonus projectile / instance count (integer, added)
  duration: number; // effect duration multiplier
  magnet: number; // pickup attraction radius in px
  armor: number; // flat damage reduction per hit
  xpGain: number; // experience multiplier
  luck: number; // rarity / drop multiplier
  critChance: number; // 0..1
  critMult: number; // crit damage multiplier
  revives: number; // number of auto-revives remaining
  dodge: number; // 0..1 chance to ignore a hit
  greed: number; // gold gain multiplier
}

/* ------------------------------------------------------------------ */
/* Content definitions (data). Implemented in src/content/*.ts         */
/* ------------------------------------------------------------------ */

export type WeaponId = string;
export type ItemId = string;
export type CharacterId = string;
export type EnemyId = string;

/** How a weapon behaves. WeaponSystem maps this tag to an implementation. */
export type WeaponBehaviorKind =
  | 'projectile-nearest' // fires N projectiles at the nearest enemy/enemies
  | 'projectile-facing' // fires N projectiles in the player's facing direction
  | 'orbit' // N objects orbit the player, damaging on contact
  | 'aura' // persistent damaging field around the player
  | 'whip' // short-lived horizontal slash to the facing side
  | 'spin' // periodic 360° cleave hitting everything around the player
  | 'lobbed'; // projectile thrown in an arc that falls on enemies

/** Icon source: a frame index in the tiny-dungeon spritesheet, or a generated texture. */
export interface IconRef {
  /** texture key; use TEXTURES.SPRITES for the dungeon sheet, or a generated key */
  texture: string;
  /** frame index for spritesheets; -1 when the texture is a standalone generated texture */
  frame: number;
}

/** Static weapon definition + per-level stat tables (length === maxLevel). */
export interface WeaponDef {
  id: WeaponId;
  name: string;
  description: string;
  behavior: WeaponBehaviorKind;
  icon: IconRef;
  maxLevel: number;
  /** optional tint applied to this weapon's projectiles / slash / aura / orbs (0xRRGGBB) */
  projectileTint?: number;
  /** rarity weight for showing up in level-up rolls (higher = more common) */
  weight: number;
  /** per-level base damage (before player.might) */
  damage: number[];
  /** per-level cooldown in ms (before player.cooldownMult) */
  cooldownMs: number[];
  /** per-level projectile / instance count (before player.amount) */
  amount: number[];
  /** per-level area / size multiplier (before player.area) */
  area: number[];
  /** per-level projectile speed in px/s (before player.projectileSpeed) */
  speed: number[];
  /** per-level pierce count (how many enemies a projectile passes through) */
  pierce: number[];
  /** per-level lifetime/duration in ms (auras, orbits, whips) */
  durationMs: number[];
  /** per-level knockback impulse in px/s (0 = none) */
  knockback: number[];
  /** short text describing what each level adds (UI), length maxLevel */
  levelText: string[];
}

/** Passive item: mutates PlayerStats. `apply` is called with the owned level. */
export interface ItemDef {
  id: ItemId;
  name: string;
  description: string;
  icon: IconRef;
  maxLevel: number;
  weight: number;
  /** Cumulatively mutate `stats` for the given owned level (1..maxLevel). */
  apply(stats: PlayerStats, level: number): void;
  /** short text describing each level (UI), length maxLevel */
  levelText: string[];
}

/** Permanent meta power-up bought with banked gold (applied to base stats). */
export interface PowerUpDef {
  id: string;
  name: string;
  description: string;
  icon: IconRef;
  maxLevel: number;
  /** cost of the NEXT level = costPerLevel * (currentLevel + 1) */
  costPerLevel: number;
  /** cumulatively apply this power-up's bonus for the owned level to `stats` */
  apply(stats: PlayerStats, level: number): void;
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  description: string;
  /** frame index in the dungeon spritesheet */
  frame: number;
  startingWeaponId: WeaponId;
  /** overrides merged over DEFAULT_STATS */
  statOverrides: Partial<PlayerStats>;
  /** one-line passive flavour shown on the select screen */
  blurb: string;
}

export type EnemyBehaviorKind = 'chase' | 'wander-chase' | 'charger';

export interface EnemyDef {
  id: EnemyId;
  name: string;
  frame: number;
  /** optional tint applied over the sprite (0xRRGGBB) */
  tint?: number;
  baseHp: number;
  contactDamage: number;
  moveSpeed: number; // px/s
  /** xp value of the gem dropped on death */
  xp: number;
  /** chance 0..1 to also drop a coin */
  goldChance: number;
  /** display scale multiplier applied on top of the global sprite scale */
  scale: number;
  behavior: EnemyBehaviorKind;
  /** 0..1, fraction of knockback ignored */
  knockbackResist: number;
  isBoss?: boolean;
  isElite?: boolean;
}

/* ------------------------------------------------------------------ */
/* Spawner wave schedule                                               */
/* ------------------------------------------------------------------ */

export interface WaveEntry {
  /** elapsed time in seconds at which this wave becomes active */
  timeSec: number;
  /** enemy ids eligible to spawn during this wave */
  enemies: EnemyId[];
  /** target number of concurrently alive enemies */
  cap: number;
  /** seconds between spawn bursts */
  spawnIntervalSec: number;
  /** enemies per burst */
  burst: number;
  /** optional one-shot boss/elite spawn id when this wave starts */
  bossId?: EnemyId;
}

/* ------------------------------------------------------------------ */
/* Run state + summary                                                 */
/* ------------------------------------------------------------------ */

export type PickupType = 'xp' | 'health' | 'gold' | 'magnet' | 'chest';

export interface RunState {
  characterId: CharacterId;
  elapsedMs: number;
  level: number;
  xp: number; // xp accumulated toward the next level
  xpToNext: number;
  kills: number;
  gold: number;
  /** owned passive items -> level */
  ownedItems: Map<ItemId, number>;
  gameOver: boolean;
  victory: boolean;
}

export interface RunSummary {
  characterId: CharacterId;
  timeMs: number;
  level: number;
  kills: number;
  gold: number;
  victory: boolean;
  weapons: OwnedWeaponView[];
  items: OwnedItemView[];
}

export interface OwnedWeaponView {
  id: WeaponId;
  level: number;
  maxLevel: number;
  icon: IconRef;
  name: string;
}

export interface OwnedItemView {
  id: ItemId;
  level: number;
  maxLevel: number;
  icon: IconRef;
  name: string;
}

/* ------------------------------------------------------------------ */
/* Level-up choices                                                    */
/* ------------------------------------------------------------------ */

export type UpgradeKind =
  | 'new-weapon'
  | 'level-weapon'
  | 'new-item'
  | 'level-item'
  | 'heal'
  | 'gold';

export interface UpgradeOption {
  id: string; // WeaponId | ItemId | 'heal' | 'gold'
  kind: UpgradeKind;
  name: string;
  description: string;
  icon: IconRef;
  /** resulting level for weapon/item, or the amount for heal/gold */
  level: number;
  maxLevel: number;
  isWeapon: boolean;
  /** border colour by rarity tier (0xRRGGBB) */
  rarityColor: number;
  /** "Lv 2" style tag, or "NEW" */
  tag: string;
}

/* ------------------------------------------------------------------ */
/* Entity structural types (avoid importing concrete classes here)     */
/* ------------------------------------------------------------------ */

/** Extra members the Player class adds on top of an Arcade Sprite. */
export interface PlayerLike {
  stats: PlayerStats;
  /** unit-ish vector of the last meaningful movement (defaults to {1,0}) */
  facing: Phaser.Math.Vector2;
  hp: number;
  isAlive: boolean;
  takeDamage(amount: number): void;
  heal(amount: number): void;
}
export type PlayerSprite = Phaser.Physics.Arcade.Sprite & PlayerLike;

/** Extra members the Enemy class adds on top of an Arcade Sprite. */
export interface EnemyLike {
  def: EnemyDef;
  hp: number;
  maxHp: number;
  /** apply damage; `from` is the hit source position for knockback direction */
  takeDamage(amount: number, from?: { x: number; y: number }, knockback?: number): void;
}
export type EnemySprite = Phaser.Physics.Arcade.Sprite & EnemyLike;

/** Extra members the Pickup class adds. */
export interface PickupLike {
  pickupType: PickupType;
  value: number;
}
export type PickupSprite = Phaser.Physics.Arcade.Sprite & PickupLike;

/* ------------------------------------------------------------------ */
/* System interfaces                                                   */
/* ------------------------------------------------------------------ */

export interface IWeaponSystem {
  /** add a brand new weapon at level 1; returns false if already owned. */
  addWeapon(id: WeaponId): boolean;
  levelUpWeapon(id: WeaponId): void;
  hasWeapon(id: WeaponId): boolean;
  getLevel(id: WeaponId): number; // 0 if not owned
  ownedCount(): number;
  getOwned(): Array<{ id: WeaponId; level: number; def: WeaponDef }>;
  update(time: number, delta: number): void;
}

export interface IExperienceSystem {
  /** add raw xp (xpGain multiplier applied internally); may queue level-ups. */
  addXp(amount: number): void;
  xpForLevel(level: number): number;
}

export interface IUpgradeSystem {
  /** roll up to `count` distinct upgrade options for the level-up screen. */
  rollOptions(count: number): UpgradeOption[];
  /** apply a chosen option (adds/levels weapon or item, heals, etc.). */
  apply(option: UpgradeOption): void;
  /** snapshot of owned passive items for the HUD tray / run summary. */
  getItemViews(): OwnedItemView[];
}

export interface IEnemySpawner {
  update(time: number, delta: number): void;
}

/* ------------------------------------------------------------------ */
/* GameContext — the integration glue passed into every system/entity  */
/* ------------------------------------------------------------------ */

/**
 * Built by the GameScene and handed to every system & entity so they never
 * import each other directly. Holds shared object references, query helpers
 * and mutation actions.
 */
export interface GameContext {
  scene: Phaser.Scene; // the GameScene
  player: PlayerSprite;
  enemies: Phaser.Physics.Arcade.Group;
  projectiles: Phaser.Physics.Arcade.Group;
  pickups: Phaser.Physics.Arcade.Group;
  /** live, shared with player.stats; mutated by recomputeStats() */
  stats: PlayerStats;
  run: RunState;
  /** the GameScene's own event emitter (also used for UI <-> game comms) */
  events: Phaser.Events.EventEmitter;
  rng: Phaser.Math.RandomDataGenerator;

  // --- systems (assigned by GameScene right after construction) ---
  weaponSystem: IWeaponSystem;
  experienceSystem: IExperienceSystem;
  upgradeSystem: IUpgradeSystem;

  // --- queries ---
  getNearestEnemy(x: number, y: number, maxDist?: number): EnemySprite | null;
  getEnemiesInRadius(x: number, y: number, radius: number): EnemySprite[];

  // --- actions ---
  damageEnemy(
    enemy: EnemySprite,
    amount: number,
    opts?: { knockback?: number; crit?: boolean }
  ): void;
  spawnXpGem(x: number, y: number, value: number): void;
  spawnPickup(x: number, y: number, type: PickupType, value?: number): void;
  addXp(amount: number): void;
  addGold(amount: number): void;
  addKill(): void;
  /** recompute player stats from character base + owned items */
  recomputeStats(): void;
  /** called once per level gained; GameScene queues + shows the choice UI */
  queueLevelUp(): void;
  shakeCamera(intensity?: number, durationMs?: number): void;
  /** spawn floating combat text (damage numbers, etc.) */
  popText(x: number, y: number, text: string, color?: number): void;
}
