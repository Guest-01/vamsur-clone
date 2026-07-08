/**
 * MetaState — cross-run persistent progression (a "meta layer").
 *
 * Holds the banked gold, purchased power-up levels, and unlocked characters /
 * weapons, persisted to localStorage. This is infrastructure (like the registry
 * / localStorage), not an in-run gameplay module, so scenes may import it
 * directly. It is a process-wide singleton (`MetaState`).
 */
import type { PlayerStats } from '../types';
import { REGISTRY } from '../types';
import { POWERUPS, CONSUMABLES } from '../content/powerups';

interface MetaSave {
  gold: number;
  powerups: Record<string, number>; // powerup id -> owned level
  consumables: Record<string, number>; // consumable id -> held count (0 or 1)
  characters: string[]; // unlocked character ids
  weapons: string[]; // unlocked weapon ids
  /** highest curse level beaten; -1 = base game not yet cleared */
  maxCurseCleared: number;
}

/** Unlocked from the start (the original game); the rest is shop-unlockable. */
const DEFAULT_CHARS = ['knight', 'mage', 'rogue'];
const DEFAULT_WEAPONS = ['whip', 'wand', 'knife', 'axe', 'sanctuary', 'orbit'];

/**
 * One-time gold cost to unlock the expansion characters / weapons. Nudged up
 * ~30% (chars 350→450, weapons across four tiers) so the content chase lasts a
 * few runs instead of being cleared in the first ~2: at the previous prices the
 * whole locked roster (2,500g) fell to ~1.5 runs of income, so new weapons
 * stopped gating almost immediately.
 */
export const CHAR_UNLOCK_COST: Record<string, number> = {
  cleric: 450,
  warrior: 450,
};
export const WEAPON_UNLOCK_COST: Record<string, number> = {
  greatsword: 200,
  spear: 200,
  runebolt: 260,
  miasma: 260,
  lightning: 330,
  boomerang: 330,
  mine: 400,
  leech: 400,
};

function defaults(): MetaSave {
  return {
    gold: 0,
    powerups: {},
    consumables: {},
    characters: [...DEFAULT_CHARS],
    weapons: [...DEFAULT_WEAPONS],
    maxCurseCleared: -1,
  };
}

class Meta {
  private data: MetaSave = defaults();
  private loaded = false;

  /** Lazy-load from localStorage (safe to call repeatedly). */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = window.localStorage.getItem(REGISTRY.META);
      if (raw) {
        const p = JSON.parse(raw) as Partial<MetaSave>;
        this.data = {
          gold: typeof p.gold === 'number' && p.gold >= 0 ? p.gold : 0,
          powerups: p.powerups && typeof p.powerups === 'object' ? p.powerups : {},
          consumables: p.consumables && typeof p.consumables === 'object' ? p.consumables : {},
          characters: Array.isArray(p.characters) ? p.characters.slice() : [...DEFAULT_CHARS],
          weapons: Array.isArray(p.weapons) ? p.weapons.slice() : [...DEFAULT_WEAPONS],
          maxCurseCleared:
            typeof p.maxCurseCleared === 'number' && p.maxCurseCleared >= -1
              ? Math.floor(p.maxCurseCleared)
              : -1,
        };
      }
    } catch {
      /* corrupt / unavailable storage — keep defaults */
    }
    // Defaults are always unlocked, even if an older save lacked them.
    for (const c of DEFAULT_CHARS) if (!this.data.characters.includes(c)) this.data.characters.push(c);
    for (const w of DEFAULT_WEAPONS) if (!this.data.weapons.includes(w)) this.data.weapons.push(w);
    // Prune power-up ids that no longer exist (the shop list was curated down);
    // stale levels would otherwise linger in the save forever.
    for (const id of Object.keys(this.data.powerups)) {
      if (!POWERUPS[id]) delete this.data.powerups[id];
    }
  }

  private save(): void {
    try {
      window.localStorage.setItem(REGISTRY.META, JSON.stringify(this.data));
    } catch {
      /* ignore unavailable storage */
    }
  }

  /* ----------------------------- gold ----------------------------- */

  get gold(): number {
    this.load();
    return this.data.gold;
  }

  /** Bank gold earned during a run. */
  addGold(n: number): void {
    this.load();
    this.data.gold = Math.max(0, this.data.gold + Math.round(n));
    this.save();
  }

  /** Spend `n` gold if affordable; returns whether the purchase happened. */
  spend(n: number): boolean {
    this.load();
    if (n < 0 || this.data.gold < n) return false;
    this.data.gold -= n;
    this.save();
    return true;
  }

  /* --------------------------- power-ups -------------------------- */

  getPowerupLevel(id: string): number {
    this.load();
    return this.data.powerups[id] ?? 0;
  }

  /** Cost of the next level, or null if maxed / unknown. */
  powerupCost(id: string): number | null {
    const def = POWERUPS[id];
    if (!def) return null;
    const lvl = this.getPowerupLevel(id);
    if (lvl >= def.maxLevel) return null;
    return def.costPerLevel * (lvl + 1);
  }

  buyPowerup(id: string): boolean {
    const cost = this.powerupCost(id);
    if (cost === null) return false;
    if (!this.spend(cost)) return false;
    this.data.powerups[id] = this.getPowerupLevel(id) + 1;
    this.save();
    return true;
  }

  /** Gold returned by refunding the TOP owned level (full price), or null. */
  powerupRefund(id: string): number | null {
    const def = POWERUPS[id];
    if (!def) return null;
    const lvl = this.getPowerupLevel(id);
    if (lvl <= 0) return null;
    return def.costPerLevel * lvl; // what that level cost when bought
  }

  /** Refund one level of a power-up at full price. */
  refundPowerup(id: string): boolean {
    const refund = this.powerupRefund(id);
    if (refund === null) return false;
    this.data.powerups[id] = this.getPowerupLevel(id) - 1;
    this.data.gold += refund;
    this.save();
    return true;
  }

  /**
   * Refund EVERY owned power-up level at full price (sum of what each level
   * cost: costPerLevel × (1+2+…+level)). Returns the gold paid back.
   */
  refundAllPowerups(): number {
    this.load();
    let total = 0;
    for (const id of Object.keys(this.data.powerups)) {
      const def = POWERUPS[id];
      const lvl = this.data.powerups[id];
      if (!def || lvl <= 0) continue;
      total += (def.costPerLevel * lvl * (lvl + 1)) / 2;
      this.data.powerups[id] = 0;
    }
    if (total > 0) {
      this.data.gold += total;
      this.save();
    }
    return total;
  }

  /** Apply every owned power-up to a (base) stat block. */
  applyPowerups(stats: PlayerStats): void {
    this.load();
    for (const id of Object.keys(this.data.powerups)) {
      const def = POWERUPS[id];
      const lvl = this.data.powerups[id];
      if (def && lvl > 0) def.apply(stats, lvl);
    }
  }

  /* --------------------------- hard mode -------------------------- */

  /** Highest curse level beaten (-1 = base game not yet cleared). */
  get maxCurseCleared(): number {
    this.load();
    return this.data.maxCurseCleared;
  }

  /** Record a victory at the given curse level (raises the unlock ceiling). */
  recordVictory(curse: number): void {
    this.load();
    if (curse > this.data.maxCurseCleared) {
      this.data.maxCurseCleared = curse;
      this.save();
    }
  }

  /* -------------------------- consumables ------------------------- */

  /** Whether a one-shot consumable is currently held (waiting for a run). */
  hasConsumable(id: string): boolean {
    this.load();
    return (this.data.consumables[id] ?? 0) > 0;
  }

  /** Buy a consumable. Only one of each can be held at a time. */
  buyConsumable(id: string): boolean {
    const def = CONSUMABLES[id];
    if (!def || this.hasConsumable(id)) return false;
    if (!this.spend(def.cost)) return false;
    this.data.consumables[id] = 1;
    this.save();
    return true;
  }

  /** Consume a held consumable (called at run start). Returns whether held. */
  consumeConsumable(id: string): boolean {
    if (!this.hasConsumable(id)) return false;
    this.data.consumables[id] = 0;
    this.save();
    return true;
  }

  /* ---------------------------- unlocks --------------------------- */

  isCharacterUnlocked(id: string): boolean {
    this.load();
    return this.data.characters.includes(id);
  }
  characterUnlockCost(id: string): number | null {
    if (this.isCharacterUnlocked(id)) return null;
    return CHAR_UNLOCK_COST[id] ?? null;
  }
  unlockCharacter(id: string): boolean {
    const cost = this.characterUnlockCost(id);
    if (cost === null) return false;
    if (!this.spend(cost)) return false;
    this.data.characters.push(id);
    this.save();
    return true;
  }

  isWeaponUnlocked(id: string): boolean {
    this.load();
    return this.data.weapons.includes(id);
  }
  weaponUnlockCost(id: string): number | null {
    if (this.isWeaponUnlocked(id)) return null;
    return WEAPON_UNLOCK_COST[id] ?? null;
  }
  unlockWeapon(id: string): boolean {
    const cost = this.weaponUnlockCost(id);
    if (cost === null) return false;
    if (!this.spend(cost)) return false;
    this.data.weapons.push(id);
    this.save();
    return true;
  }

  /** Wipe all meta progress (used by a shop "reset" button if present). */
  reset(): void {
    this.data = defaults();
    this.loaded = true;
    this.save();
  }
}

export const MetaState = new Meta();
