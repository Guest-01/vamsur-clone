import type { ConsumableDef, PowerUpDef } from '../types';
import { TEXTURES, FRAMES } from '../config/assets';

const sheet = (frame: number) => ({ texture: TEXTURES.SPRITES, frame });
const gen = (texture: string) => ({ texture, frame: -1 });

/**
 * Permanent power-ups bought in the shop with banked gold. Each owned level is
 * applied to the run's BASE stats at the start of every run (see
 * `systems/stats.ts` + `state/MetaState.ts`), so they make all future runs
 * stronger. Cost of the next level = `costPerLevel * (currentLevel + 1)`.
 *
 * Curated to 13 entries (was 18): weak "mini copies" of in-run items
 * (projectile speed, duration, dodge, magnet, regen) were cut, and the two
 * crit power-ups were merged into Deadly Arts, so every purchase here feels
 * distinct from what a run already offers. Stale ids in old saves are pruned
 * on load by MetaState.
 */
export const POWERUPS: Record<string, PowerUpDef> = {
  vitality: {
    id: 'vitality',
    name: '활력',
    description: '시작 최대 체력 +12 / 레벨',
    icon: gen(TEXTURES.ICON_HEART),
    maxLevel: 5,
    costPerLevel: 30,
    apply: (s, lvl) => {
      s.maxHp += 12 * lvl;
    },
  },
  power: {
    id: 'power',
    name: '위력',
    description: '시작 위력 +5% / 레벨',
    icon: gen(TEXTURES.ICON_FIST),
    maxLevel: 5,
    costPerLevel: 55,
    apply: (s, lvl) => {
      s.might += 0.05 * lvl;
    },
  },
  armor: {
    id: 'armor',
    name: '방어',
    description: '시작 방어 +1 / 레벨',
    icon: gen(TEXTURES.ICON_SHIELD),
    maxLevel: 3,
    costPerLevel: 45,
    apply: (s, lvl) => {
      s.armor += 1 * lvl;
    },
  },
  swift: {
    id: 'swift',
    name: '신속',
    description: '시작 이동속도 +6 / 레벨',
    icon: gen(TEXTURES.ICON_BOOT),
    maxLevel: 5,
    costPerLevel: 30,
    apply: (s, lvl) => {
      s.moveSpeed += 6 * lvl;
    },
  },
  haste: {
    id: 'haste',
    name: '가속',
    description: '시작 쿨다운 -4% / 레벨',
    icon: gen(TEXTURES.ICON_HOURGLASS),
    maxLevel: 5,
    costPerLevel: 55,
    apply: (s, lvl) => {
      s.cooldownMult -= 0.04 * lvl;
    },
  },
  reach: {
    id: 'reach',
    name: '범위',
    description: '시작 범위 +6% / 레벨',
    icon: gen(TEXTURES.ICON_STAR),
    maxLevel: 5,
    costPerLevel: 45,
    apply: (s, lvl) => {
      s.area += 0.06 * lvl;
    },
  },
  growth: {
    id: 'growth',
    name: '성장',
    description: '시작 경험치 획득 +5% / 레벨',
    icon: gen(TEXTURES.GEM_L),
    maxLevel: 5,
    costPerLevel: 45,
    apply: (s, lvl) => {
      s.xpGain += 0.05 * lvl;
    },
  },
  greed: {
    id: 'greed',
    name: '탐욕',
    description: '시작 골드 획득 +12% / 레벨',
    icon: gen(TEXTURES.ICON_COIN),
    maxLevel: 5,
    costPerLevel: 35,
    apply: (s, lvl) => {
      s.greed += 0.12 * lvl;
    },
  },
  fortune: {
    id: 'fortune',
    name: '행운',
    description: '시작 행운 +5% / 레벨',
    icon: gen(TEXTURES.ICON_CLOVER),
    maxLevel: 3,
    costPerLevel: 45,
    apply: (s, lvl) => {
      s.luck += 0.05 * lvl;
    },
  },
  deadlyArts: {
    id: 'deadlyArts',
    name: '살상술',
    description: '시작 치명타율 +2%, 치명타 피해 +10% / 레벨',
    icon: sheet(FRAMES.SWORD_RED),
    maxLevel: 5,
    costPerLevel: 60,
    apply: (s, lvl) => {
      s.critChance += 0.02 * lvl;
      s.critMult += 0.1 * lvl;
    },
  },
  mirror: {
    id: 'mirror',
    name: '운명의 거울',
    description: '레벨업 선택지 새로고침 +1회 / 레벨 (매 런 충전)',
    icon: gen(TEXTURES.ICON_MIRROR),
    maxLevel: 3,
    costPerLevel: 80,
    apply: (s, lvl) => {
      s.rerolls += lvl;
    },
  },
  revival: {
    id: 'revival',
    name: '부활',
    description: '부활 +1회 / 레벨',
    icon: sheet(FRAMES.POTION_RED),
    maxLevel: 2,
    costPerLevel: 150,
    apply: (s, lvl) => {
      s.revives += lvl;
    },
  },
  multishot: {
    id: 'multishot',
    name: '다중 발사',
    description: '시작 투사체/효과 개수 +1 (고가의 최종 강화)',
    icon: gen(TEXTURES.ICON_ECHO),
    maxLevel: 1,
    costPerLevel: 400,
    apply: (s, lvl) => {
      s.amount += lvl;
    },
  },
};

/**
 * One-shot consumables: bought once, held until the next run starts, then
 * consumed. Only one of each can be held at a time. Their effects are applied
 * by GameScene at run setup (they change run state, not the stat block).
 */
export const CONSUMABLES: Record<string, ConsumableDef> = {
  headstart: {
    id: 'headstart',
    name: '선구자',
    description: '다음 런을 레벨 2로 시작 (1회용)',
    icon: sheet(FRAMES.POTION_GREEN),
    cost: 30,
  },
};
