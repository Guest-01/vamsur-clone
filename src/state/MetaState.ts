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
import { POWERUPS } from '../content/powerups';

interface MetaSave {
  gold: number;
  powerups: Record<string, number>; // powerup id -> owned level
  characters: string[]; // unlocked character ids
  weapons: string[]; // unlocked weapon ids
}

/** Unlocked from the start (the original game); the rest is shop-unlockable. */
const DEFAULT_CHARS = ['knight', 'mage', 'rogue'];
const DEFAULT_WEAPONS = ['whip', 'wand', 'knife', 'axe', 'sanctuary', 'orbit'];

/** One-time gold cost to unlock the expansion characters / weapons. */
export const CHAR_UNLOCK_COST: Record<string, number> = {
  cleric: 350,
  warrior: 350,
};
export const WEAPON_UNLOCK_COST: Record<string, number> = {
  greatsword: 150,
  spear: 150,
  runebolt: 200,
  miasma: 200,
};

function defaults(): MetaSave {
  return {
    gold: 0,
    powerups: {},
    characters: [...DEFAULT_CHARS],
    weapons: [...DEFAULT_WEAPONS],
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
          characters: Array.isArray(p.characters) ? p.characters.slice() : [...DEFAULT_CHARS],
          weapons: Array.isArray(p.weapons) ? p.weapons.slice() : [...DEFAULT_WEAPONS],
        };
      }
    } catch {
      /* corrupt / unavailable storage — keep defaults */
    }
    // Defaults are always unlocked, even if an older save lacked them.
    for (const c of DEFAULT_CHARS) if (!this.data.characters.includes(c)) this.data.characters.push(c);
    for (const w of DEFAULT_WEAPONS) if (!this.data.weapons.includes(w)) this.data.weapons.push(w);
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

  /** Apply every owned power-up to a (base) stat block. */
  applyPowerups(stats: PlayerStats): void {
    this.load();
    for (const id of Object.keys(this.data.powerups)) {
      const def = POWERUPS[id];
      const lvl = this.data.powerups[id];
      if (def && lvl > 0) def.apply(stats, lvl);
    }
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
