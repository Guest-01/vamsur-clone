import type { CharacterDef } from '../types';
import { TEXTURES, FRAMES } from '../config/assets';

/** Selectable characters. The first is the default. */
export const CHARACTERS: CharacterDef[] = [
  {
    id: 'knight',
    name: '롤랑 경',
    description: '단단한 갑옷의 기사. 높은 체력과 방어로 오래 버틴다.',
    frame: FRAMES.KNIGHT,
    startingWeaponId: 'whip',
    statOverrides: { maxHp: 130, armor: 1, moveSpeed: 150, might: 1.0 },
    blurb: '시작 체력 +30, 방어 +1',
  },
  {
    id: 'mage',
    name: '엘비라',
    description: '서리의 마법사. 강한 위력과 넓은 범위를 지녔으나 허약하다.',
    frame: FRAMES.MAGE,
    startingWeaponId: 'wand',
    statOverrides: { maxHp: 80, might: 1.2, area: 1.15, cooldownMult: 0.95 },
    blurb: '위력 +20%, 범위 +15%',
  },
  {
    id: 'rogue',
    name: '벡스',
    description: '민첩한 도적. 빠른 발과 치명타로 적을 난도질한다.',
    frame: FRAMES.ROGUE,
    startingWeaponId: 'knife',
    statOverrides: {
      maxHp: 90,
      moveSpeed: 190,
      critChance: 0.15,
      amount: 1,
      cooldownMult: 0.92,
    },
    blurb: '이동 +15%, 치명타 +15%, 투사체 +1',
  },
  {
    id: 'cleric',
    name: '세라핀',
    description: '빛의 사제. 신성한 장막으로 적을 태우며 넓은 범위와 재생을 지녔다.',
    frame: FRAMES.CLERIC,
    startingWeaponId: 'sanctuary',
    statOverrides: { maxHp: 95, area: 1.2, hpRegen: 1.5, might: 1.05 },
    blurb: '범위 +20%, 재생 +1.5/s',
  },
  {
    id: 'warrior',
    name: '비요른',
    description: '북방의 전사. 수호 영혼을 두르고 단단하게 전장을 누빈다.',
    frame: FRAMES.WARRIOR,
    startingWeaponId: 'orbit',
    statOverrides: { maxHp: 120, moveSpeed: 155, armor: 1, might: 1.05 },
    blurb: '체력 +20, 방어 +1',
  },
];

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

/** Re-export so generated-icon textures resolve when content references them. */
export const _ICON_TEXTURE_PROBE = TEXTURES.SPRITES;
