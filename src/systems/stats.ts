import type { CharacterDef, ItemId, PlayerStats } from '../types';
import { DEFAULT_STATS, STAT_CLAMP } from '../config/balance';
import { ITEMS } from '../content/items';
import { MetaState } from '../state/MetaState';

function clampStats(s: PlayerStats): void {
  if (s.cooldownMult < STAT_CLAMP.COOLDOWN_MULT_MIN) s.cooldownMult = STAT_CLAMP.COOLDOWN_MULT_MIN;
  if (s.moveSpeed > STAT_CLAMP.MOVE_SPEED_MAX) s.moveSpeed = STAT_CLAMP.MOVE_SPEED_MAX;
  if (s.dodge > 0.8) s.dodge = 0.8;
  if (s.critChance > 1) s.critChance = 1;
}

/** Fresh stat block = defaults overlaid with the character's overrides. */
export function createBaseStats(character: CharacterDef): PlayerStats {
  const s: PlayerStats = { ...DEFAULT_STATS, ...character.statOverrides };
  MetaState.applyPowerups(s);
  clampStats(s);
  return s;
}

/**
 * Recompute `target` IN PLACE (preserving the object reference shared by
 * player.stats / GameContext.stats) from the character base + owned items.
 */
export function recomputeStats(
  target: PlayerStats,
  character: CharacterDef,
  ownedItems: Map<ItemId, number>
): void {
  Object.assign(target, DEFAULT_STATS, character.statOverrides);
  MetaState.applyPowerups(target);
  ownedItems.forEach((level, id) => {
    const def = ITEMS[id];
    if (def && level > 0) def.apply(target, level);
  });
  clampStats(target);
}
