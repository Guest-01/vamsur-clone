import type { PowerUpDef } from '../types';
import { TEXTURES, FRAMES } from '../config/assets';

const sheet = (frame: number) => ({ texture: TEXTURES.SPRITES, frame });
const gen = (texture: string) => ({ texture, frame: -1 });

/**
 * Permanent power-ups bought in the shop with banked gold. Each owned level is
 * applied to the run's BASE stats at the start of every run (see
 * `systems/stats.ts` + `state/MetaState.ts`), so they make all future runs
 * stronger. Cost of the next level = `costPerLevel * (currentLevel + 1)`.
 */
export const POWERUPS: Record<string, PowerUpDef> = {
  vitality: {
    id: 'vitality',
    name: 'Vitality',
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
    name: 'Power',
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
    name: 'Armor',
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
    name: 'Swiftness',
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
    name: 'Haste',
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
    name: 'Reach',
    description: '시작 범위 +6% / 레벨',
    icon: gen(TEXTURES.ICON_STAR),
    maxLevel: 5,
    costPerLevel: 45,
    apply: (s, lvl) => {
      s.area += 0.06 * lvl;
    },
  },
  magnet: {
    id: 'magnet',
    name: 'Magnet',
    description: '시작 자력 +25 / 레벨',
    icon: gen(TEXTURES.ICON_MAGNET),
    maxLevel: 3,
    costPerLevel: 25,
    apply: (s, lvl) => {
      s.magnet += 25 * lvl;
    },
  },
  regen: {
    id: 'regen',
    name: 'Recovery',
    description: '시작 체력 재생 +0.4/s / 레벨',
    icon: sheet(FRAMES.POTION_GREEN),
    maxLevel: 5,
    costPerLevel: 30,
    apply: (s, lvl) => {
      s.hpRegen += 0.4 * lvl;
    },
  },
  growth: {
    id: 'growth',
    name: 'Growth',
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
    name: 'Greed',
    description: '시작 골드 획득 +12% / 레벨',
    icon: sheet(FRAMES.COINS),
    maxLevel: 5,
    costPerLevel: 35,
    apply: (s, lvl) => {
      s.greed += 0.12 * lvl;
    },
  },
  fortune: {
    id: 'fortune',
    name: 'Fortune',
    description: '시작 행운 +5% / 레벨',
    icon: gen(TEXTURES.ICON_CLOVER),
    maxLevel: 3,
    costPerLevel: 45,
    apply: (s, lvl) => {
      s.luck += 0.05 * lvl;
    },
  },
  revival: {
    id: 'revival',
    name: 'Revival',
    description: '부활 +1회 / 레벨',
    icon: sheet(FRAMES.POTION_RED),
    maxLevel: 2,
    costPerLevel: 150,
    apply: (s, lvl) => {
      s.revives += lvl;
    },
  },
};
