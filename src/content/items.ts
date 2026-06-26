import type { ItemDef } from '../types';
import { TEXTURES, FRAMES } from '../config/assets';

const sheet = (frame: number) => ({ texture: TEXTURES.SPRITES, frame });
const gen = (texture: string) => ({ texture, frame: -1 });

/**
 * Passive items. `apply(stats, level)` adds the FULL contribution for the given
 * owned level (it is called once per item during a full recompute that starts
 * from the character's base stats).
 */
export const ITEMS: Record<string, ItemDef> = {
  hollowHeart: {
    id: 'hollowHeart',
    name: 'Lifestone',
    description: '최대 체력을 늘린다.',
    icon: gen(TEXTURES.ICON_HEART),
    maxLevel: 5,
    weight: 10,
    apply: (s, lvl) => {
      s.maxHp += 20 * lvl;
    },
    levelText: ['+20 최대 체력', '+40 최대 체력', '+60 최대 체력', '+80 최대 체력', '+100 최대 체력'],
  },
  spinach: {
    id: 'spinach',
    name: 'Bloodlust',
    description: '모든 피해량이 증가한다.',
    icon: gen(TEXTURES.ICON_FIST),
    maxLevel: 5,
    weight: 9,
    apply: (s, lvl) => {
      s.might += 0.1 * lvl;
    },
    levelText: ['+10% 위력', '+20% 위력', '+30% 위력', '+40% 위력', '+50% 위력'],
  },
  boots: {
    id: 'boots',
    name: 'Swift Boots',
    description: '이동 속도가 빨라진다.',
    icon: gen(TEXTURES.ICON_BOOT),
    maxLevel: 5,
    weight: 8,
    apply: (s, lvl) => {
      s.moveSpeed += 14 * lvl;
    },
    levelText: ['+14 이동속도', '+28 이동속도', '+42 이동속도', '+56 이동속도', '+70 이동속도'],
  },
  tome: {
    id: 'tome',
    name: 'Swift Codex',
    description: '무기 재사용 대기시간을 줄인다.',
    icon: gen(TEXTURES.ICON_HOURGLASS),
    maxLevel: 5,
    weight: 7,
    apply: (s, lvl) => {
      s.cooldownMult -= 0.09 * lvl;
    },
    levelText: ['-9% 쿨다운', '-18% 쿨다운', '-27% 쿨다운', '-36% 쿨다운', '-45% 쿨다운'],
  },
  candelabra: {
    id: 'candelabra',
    name: 'Brazier',
    description: '무기 효과 범위가 넓어진다.',
    icon: gen(TEXTURES.ICON_STAR),
    maxLevel: 5,
    weight: 7,
    apply: (s, lvl) => {
      s.area += 0.15 * lvl;
    },
    levelText: ['+15% 범위', '+30% 범위', '+45% 범위', '+60% 범위', '+75% 범위'],
  },
  duplicator: {
    id: 'duplicator',
    name: 'Echo Charm',
    description: '투사체/효과 개수가 늘어난다.',
    icon: sheet(FRAMES.DAGGER),
    maxLevel: 3,
    weight: 4,
    apply: (s, lvl) => {
      s.amount += lvl;
    },
    levelText: ['+1 개수', '+2 개수', '+3 개수'],
  },
  attractorb: {
    id: 'attractorb',
    name: 'Lodestone',
    description: '경험치 흡수 범위가 넓어진다.',
    icon: gen(TEXTURES.ICON_MAGNET),
    maxLevel: 4,
    weight: 6,
    apply: (s, lvl) => {
      s.magnet += 40 * lvl;
    },
    levelText: ['+40 자력', '+80 자력', '+120 자력', '+160 자력'],
  },
  armor: {
    id: 'armor',
    name: 'Plate Armor',
    description: '받는 피해를 줄인다.',
    icon: gen(TEXTURES.ICON_SHIELD),
    maxLevel: 5,
    weight: 7,
    apply: (s, lvl) => {
      s.armor += 1 * lvl;
    },
    levelText: ['+1 방어', '+2 방어', '+3 방어', '+4 방어', '+5 방어'],
  },
  clover: {
    id: 'clover',
    name: 'Black Cat',
    description: '행운이 올라 좋은 강화가 자주 나온다.',
    icon: gen(TEXTURES.ICON_CLOVER),
    maxLevel: 5,
    weight: 4,
    apply: (s, lvl) => {
      s.luck += 0.1 * lvl;
    },
    levelText: ['+10% 행운', '+20% 행운', '+30% 행운', '+40% 행운', '+50% 행운'],
  },
  wings: {
    id: 'wings',
    name: 'Falcon Plume',
    description: '투사체 속도가 빨라진다.',
    icon: gen(TEXTURES.ICON_WING),
    maxLevel: 5,
    weight: 5,
    apply: (s, lvl) => {
      s.projectileSpeed += 0.08 * lvl;
    },
    levelText: ['+8% 투사체 속도', '+16%', '+24%', '+32%', '+40%'],
  },
  pummarola: {
    id: 'pummarola',
    name: 'Heartroot',
    description: '체력이 서서히 회복된다.',
    icon: sheet(FRAMES.POTION_GREEN),
    maxLevel: 5,
    weight: 5,
    apply: (s, lvl) => {
      s.hpRegen += 0.6 * lvl;
    },
    levelText: ['+0.6 재생/s', '+1.2 재생/s', '+1.8 재생/s', '+2.4 재생/s', '+3.0 재생/s'],
  },
  hawkeye: {
    id: 'hawkeye',
    name: 'Hawk Eye',
    description: '치명타 확률이 오른다.',
    icon: sheet(FRAMES.SWORD_RED),
    maxLevel: 5,
    weight: 5,
    apply: (s, lvl) => {
      s.critChance += 0.03 * lvl;
    },
    levelText: ['+3% 치명타율', '+6% 치명타율', '+9% 치명타율', '+12% 치명타율', '+15% 치명타율'],
  },
  cruelEdge: {
    id: 'cruelEdge',
    name: 'Cruel Edge',
    description: '치명타 피해가 늘어난다.',
    icon: sheet(FRAMES.HAMMER),
    maxLevel: 4,
    weight: 4,
    apply: (s, lvl) => {
      s.critMult += 0.25 * lvl;
    },
    levelText: ['+25% 치명타 피해', '+50% 치명타 피해', '+75% 치명타 피해', '+100% 치명타 피해'],
  },
  phantomCloak: {
    id: 'phantomCloak',
    name: 'Phantom Cloak',
    description: '확률적으로 피해를 회피한다.',
    icon: sheet(FRAMES.POTION_BLUE),
    maxLevel: 5,
    weight: 4,
    apply: (s, lvl) => {
      s.dodge += 0.04 * lvl;
    },
    levelText: ['+4% 회피', '+8% 회피', '+12% 회피', '+16% 회피', '+20% 회피'],
  },
  phoenixFeather: {
    id: 'phoenixFeather',
    name: 'Phoenix Feather',
    description: '쓰러져도 절반의 체력으로 되살아난다.',
    icon: sheet(FRAMES.SHIELD),
    maxLevel: 2,
    weight: 2,
    apply: (s, lvl) => {
      s.revives += lvl;
    },
    levelText: ['부활 1회', '부활 2회'],
  },
  greedRing: {
    id: 'greedRing',
    name: 'Greed Ring',
    description: '골드 획득량이 늘어난다.',
    icon: sheet(FRAMES.COINS),
    maxLevel: 4,
    weight: 4,
    apply: (s, lvl) => {
      s.greed += 0.15 * lvl;
    },
    levelText: ['+15% 골드', '+30% 골드', '+45% 골드', '+60% 골드'],
  },
  eternalCandle: {
    id: 'eternalCandle',
    name: 'Eternal Candle',
    description: '무기 효과의 지속시간이 늘어난다.',
    icon: sheet(FRAMES.BOTTLE),
    maxLevel: 5,
    weight: 4,
    apply: (s, lvl) => {
      s.duration += 0.1 * lvl;
    },
    levelText: ['+10% 지속', '+20% 지속', '+30% 지속', '+40% 지속', '+50% 지속'],
  },
  crown: {
    id: 'crown',
    name: 'Halo of Wisdom',
    description: '경험치 획득량이 늘어난다.',
    icon: gen(TEXTURES.GEM_L),
    maxLevel: 5,
    weight: 5,
    apply: (s, lvl) => {
      s.xpGain += 0.08 * lvl;
    },
    levelText: ['+8% 경험치', '+16% 경험치', '+24% 경험치', '+32% 경험치', '+40% 경험치'],
  },
};
