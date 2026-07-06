/**
 * UpgradeSystem — builds the level-up choice cards and applies the chosen one.
 *
 * It is the single authority that turns the player's owned weapons/items + the
 * content registries into a set of `UpgradeOption` cards, and routes a chosen
 * card back into the weapon system / run state. Like every gameplay module it
 * speaks only through the GameContext.
 */
import Phaser from 'phaser';
import type {
  GameContext,
  IUpgradeSystem,
  ItemDef,
  ItemId,
  OwnedItemView,
  UpgradeKind,
  UpgradeOption,
  WeaponDef,
  WeaponId,
} from '../types';
import { EVENTS } from '../types';
import { WEAPONS } from '../content/weapons';
import { ITEMS } from '../content/items';
import { MetaState } from '../state/MetaState';
import { RUN, RARITY } from '../config/balance';
import { TEXTURES, FRAMES } from '../config/assets';

/** A weighted candidate before it is materialised into a full UpgradeOption. */
interface Candidate {
  kind: UpgradeKind;
  id: string;
  /** the resulting level after applying (next level) */
  level: number;
  weight: number;
}

export class UpgradeSystem implements IUpgradeSystem {
  private ctx: GameContext;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  /* ----------------------------------------------------------------- */
  /* Rolling options                                                   */
  /* ----------------------------------------------------------------- */

  /**
   * Roll up to `count` DISTINCT, weighted upgrade options. Builds the candidate
   * pool from four sources (level owned weapon, take new weapon, level owned
   * item, take new item) honouring the slot caps, weights each candidate (with
   * a gentle early bias toward brand-new picks and a luck nudge), and draws
   * distinct entries by weighted sampling without replacement. Falls back to
   * heal/gold options when the pool is exhausted (everything maxed/capped).
   */
  rollOptions(count: number): UpgradeOption[] {
    const candidates = this.buildCandidates();

    const chosen: Candidate[] = [];
    // Weighted draw without replacement: pick one, remove it, repeat.
    const pool = candidates.slice();
    while (chosen.length < count && pool.length > 0) {
      const idx = this.weightedPick(pool);
      chosen.push(pool[idx]);
      pool.splice(idx, 1);
    }

    const options = chosen.map((c) => this.toOption(c));

    // If the live pool could not fill all the slots (early game with few
    // weapons, or late game fully maxed), pad with fallbacks so the player
    // always gets a meaningful choice.
    if (options.length < count) {
      const fallbacks = this.fallbackOptions(count - options.length);
      for (const f of fallbacks) options.push(f);
    }

    return options;
  }

  /** Assemble every currently-valid upgrade candidate. */
  private buildCandidates(): Candidate[] {
    const out: Candidate[] = [];
    const ws = this.ctx.weaponSystem;
    const run = this.ctx.run;
    const luck = this.ctx.stats.luck;

    // Early-game "new pick" bias: shrinks as the run goes on (by level).
    const newBias = run.level <= 6 ? 1.5 : run.level <= 12 ? 1.25 : 1.0;

    // --- level up an owned weapon ---
    for (const view of ws.getOwned()) {
      if (view.level < view.def.maxLevel) {
        out.push({
          kind: 'level-weapon',
          id: view.id,
          level: view.level + 1,
          weight: view.def.weight,
        });
      }
    }

    // --- take a brand-new weapon (only if a slot is free) ---
    if (ws.ownedCount() < RUN.MAX_WEAPONS) {
      for (const id of Object.keys(WEAPONS)) {
        if (!ws.hasWeapon(id) && MetaState.isWeaponUnlocked(id)) {
          const def = WEAPONS[id];
          out.push({
            kind: 'new-weapon',
            id,
            level: 1,
            weight: def.weight * newBias,
          });
        }
      }
    }

    // --- level up an owned item ---
    run.ownedItems.forEach((level, id) => {
      const def = ITEMS[id];
      if (def && level < def.maxLevel) {
        out.push({
          kind: 'level-item',
          id,
          level: level + 1,
          weight: def.weight,
        });
      }
    });

    // --- take a brand-new item (only if a slot is free) ---
    if (run.ownedItems.size < RUN.MAX_ITEMS) {
      for (const id of Object.keys(ITEMS)) {
        if (!run.ownedItems.has(id)) {
          const def = ITEMS[id];
          out.push({
            kind: 'new-item',
            id,
            level: 1,
            weight: def.weight * newBias,
          });
        }
      }
    }

    // Luck biases the roll toward the more exciting options — brand-new weapons
    // and items, plus upgrades that are CLOSE TO MAX (milestone picks) — instead
    // of uniform filler. At luck 1 the distribution is unchanged. (The previous
    // code multiplied every weight equally, which left the probabilities
    // untouched — i.e. luck did nothing.)
    const luckBoost = luck - 1;
    if (luckBoost !== 0) {
      for (const c of out) {
        let desirability: number;
        if (c.kind === 'new-weapon' || c.kind === 'new-item') {
          desirability = 1;
        } else {
          const def = c.kind === 'level-weapon' ? WEAPONS[c.id] : ITEMS[c.id];
          desirability = def ? c.level / def.maxLevel : 0;
        }
        c.weight *= 1 + luckBoost * desirability;
      }
    }

    return out;
  }

  /** Index of a weighted random pick from `pool` (uses the run RNG). */
  private weightedPick(pool: Candidate[]): number {
    let total = 0;
    for (const c of pool) total += c.weight;
    if (total <= 0) return this.ctx.rng.between(0, pool.length - 1);

    let roll = this.ctx.rng.frac() * total;
    for (let i = 0; i < pool.length; i++) {
      roll -= pool[i].weight;
      if (roll <= 0) return i;
    }
    return pool.length - 1;
  }

  /** Materialise a candidate into the full UpgradeOption the UI renders. */
  private toOption(c: Candidate): UpgradeOption {
    const isWeapon = c.kind === 'new-weapon' || c.kind === 'level-weapon';
    const def: WeaponDef | ItemDef = isWeapon ? WEAPONS[c.id] : ITEMS[c.id];
    const isNew = c.kind === 'new-weapon' || c.kind === 'new-item';

    // Description: the next level's flavour text when levelling, base
    // description when it's a brand new pick. levelText is indexed by level-1.
    const levelText = def.levelText[c.level - 1];
    const description = isNew ? def.description : levelText ?? def.description;

    return {
      id: c.id,
      kind: c.kind,
      name: def.name,
      description,
      icon: def.icon,
      level: c.level,
      maxLevel: def.maxLevel,
      isWeapon,
      rarityColor: this.rarityFor(c, def),
      tag: isNew ? 'NEW' : `Lv ${c.level}`,
    };
  }

  /**
   * Choose a rarity-tier border colour. Brand-new picks read as RARE (exciting),
   * the level that maxes a piece reads LEGENDARY (a milestone), other level-ups
   * climb COMMON -> UNCOMMON with their level.
   */
  private rarityFor(c: Candidate, def: WeaponDef | ItemDef): number {
    if (c.level >= def.maxLevel) return RARITY.LEGENDARY;
    if (c.kind === 'new-weapon' || c.kind === 'new-item') return RARITY.RARE;
    if (c.level >= Math.ceil(def.maxLevel * 0.6)) return RARITY.UNCOMMON;
    return RARITY.COMMON;
  }

  /**
   * Fallback cards when no real upgrades remain (or to top up a short pool):
   * a heal (restore 30% of max HP) and a gold bonus. `level` carries the
   * effect magnitude (heal % as a whole number for display; gold amount).
   */
  private fallbackOptions(count: number): UpgradeOption[] {
    const out: UpgradeOption[] = [];
    const stats = this.ctx.stats;

    const heal: UpgradeOption = {
      id: 'heal',
      kind: 'heal',
      name: 'Sanguine Draught',
      description: '최대 체력의 30%를 회복한다.',
      icon: { texture: TEXTURES.SPRITES, frame: FRAMES.POTION_RED },
      level: Math.round(stats.maxHp * 0.3),
      maxLevel: 1,
      isWeapon: false,
      rarityColor: RARITY.COMMON,
      tag: '회복',
    };

    const goldAmount = 10 + this.ctx.run.level * 2;
    const gold: UpgradeOption = {
      id: 'gold',
      kind: 'gold',
      name: 'Cursed Gold',
      description: `${goldAmount} 골드를 획득한다.`,
      icon: { texture: TEXTURES.ICON_COIN, frame: -1 },
      level: goldAmount,
      maxLevel: 1,
      isWeapon: false,
      rarityColor: RARITY.UNCOMMON,
      tag: '골드',
    };

    const choices = [heal, gold];
    for (let i = 0; i < count; i++) out.push(choices[i % choices.length]);
    return out;
  }

  /* ----------------------------------------------------------------- */
  /* Applying a chosen option                                          */
  /* ----------------------------------------------------------------- */

  /** Apply a chosen card. Dispatches by kind; emits the relevant change event. */
  apply(option: UpgradeOption): void {
    const ctx = this.ctx;
    const run = ctx.run;
    const player = ctx.player;

    switch (option.kind) {
      case 'new-weapon':
        ctx.weaponSystem.addWeapon(option.id as WeaponId);
        break;

      case 'level-weapon':
        ctx.weaponSystem.levelUpWeapon(option.id as WeaponId);
        break;

      case 'new-item':
        this.applyItem(option.id as ItemId, 1);
        break;

      case 'level-item': {
        const current = run.ownedItems.get(option.id as ItemId) ?? 0;
        this.applyItem(option.id as ItemId, current + 1);
        break;
      }

      case 'heal':
        // option.level holds the heal amount computed at roll time.
        player.heal(option.level);
        break;

      case 'gold':
        // option.level holds the gold amount computed at roll time.
        ctx.addGold(option.level);
        break;
    }
  }

  /**
   * Set an item to `level`, recompute stats, and emit ITEMS_CHANGED. If the
   * recompute raised maxHp (e.g. Hollow Heart), top the player's current HP up
   * by exactly that delta so the new headroom is granted as healing rather than
   * just raising the ceiling.
   */
  private applyItem(id: ItemId, level: number): void {
    const ctx = this.ctx;
    const prevMaxHp = ctx.stats.maxHp;

    ctx.run.ownedItems.set(id, level);
    ctx.recomputeStats();

    const delta = ctx.stats.maxHp - prevMaxHp;
    if (delta > 0) {
      ctx.player.hp = Math.min(ctx.stats.maxHp, ctx.player.hp + delta);
    }

    ctx.events.emit(EVENTS.ITEMS_CHANGED, { owned: this.getItemViews() });
  }

  /* ----------------------------------------------------------------- */
  /* Views for HUD / run summary                                       */
  /* ----------------------------------------------------------------- */

  /** Snapshot of owned passive items for the HUD tray / end-of-run summary. */
  getItemViews(): OwnedItemView[] {
    const views: OwnedItemView[] = [];
    this.ctx.run.ownedItems.forEach((level, id) => {
      const def = ITEMS[id];
      if (!def || level <= 0) return;
      views.push({
        id,
        level,
        maxLevel: def.maxLevel,
        icon: def.icon,
        name: def.name,
      });
    });
    return views;
  }
}

// Keep the mandated `import Phaser` referenced (RNG/types flow through ctx).
void Phaser;
