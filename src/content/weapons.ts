import type { WeaponDef } from '../types';
import { TEXTURES, FRAMES } from '../config/assets';

const sheet = (frame: number) => ({ texture: TEXTURES.SPRITES, frame });
const gen = (texture: string) => ({ texture, frame: -1 });

/**
 * Weapon registry. Field meaning is per `behavior` (see ARCHITECTURE.md):
 *  - projectile-nearest / -facing: amount = projectiles/shot, speed = px/s,
 *    pierce = pass-throughs, durationMs = max lifetime, area = sprite scale.
 *  - whip: amount = slashes (>=2 hits both sides), area = reach/size mult,
 *    durationMs = slash visual lifetime, pierce ignored (hits all in the
 *    wide/flat forward box — see slashSide in WeaponSystem).
 *  - lobbed: speed = initial throw velocity, durationMs = flight time, area =
 *    impact radius mult, pierce = enemies hit on landing.
 *  - aura: cooldownMs = damage tick interval, area = radius mult, persistent.
 *  - orbit: amount = orb count, speed = rotation speed (deg/s), area = radius +
 *    orb size, cooldownMs = per-enemy re-hit interval, persistent.
 *  - chain: amount = simultaneous strikes, pierce = arc jumps per strike,
 *    chainRange = jump reach (× area), durationMs = bolt fx lifetime.
 *  - boomerang: amount = boomerangs/throw, speed = initial throw velocity
 *    (return accel derives from it), durationMs = failsafe lifetime, hits once
 *    per enemy on the way out and once again on the way back.
 *  - mine: amount = mines per drop, area = trigger/blast radius mult,
 *    durationMs = burn-patch lifetime, damage = blast (burn ticks at 20%).
 *  - leech: amount = tethers, area = tether range mult, cooldownMs = tick,
 *    lifestealFrac of damage dealt returns as HP.
 *
 * Arrays are indexed by (level - 1) and have length === maxLevel.
 */
export const WEAPONS: Record<string, WeaponDef> = {
  // NOTE: internal id/behavior stay 'whip' (referenced by WeaponId, characters,
  // MetaState, the WeaponSystem switch). Only the display name/icon/text below
  // were re-themed from a whip to an instant crimson flash-strike ("일섬"), to
  // match the horizontal snap-out fx in slashSide.
  whip: {
    id: 'whip',
    name: '일섬',
    description: '정면을 순식간에 베어내는 섬광 일격. 레벨2부터 양옆을 동시에 벤다.',
    behavior: 'whip',
    icon: sheet(FRAMES.SWORD_RED),
    maxLevel: 8,
    weight: 10,
    // A directional melee weapon: it only threatens the facing side, so it pays
    // for that blind spot with the highest per-target DPS of the melee weapons
    // (cf. the omnidirectional greatsword/sanctuary). Retuned up from
    // [10..37]/[1150..840] — see the balance review in git history.
    damage: [15, 18, 22, 27, 33, 40, 48, 58],
    cooldownMs: [1000, 960, 920, 880, 840, 800, 760, 720],
    // amount reaches 2 at level 2 (both sides). Capped at 2 — fireWhip only ever
    // slashes the facing side plus the opposite side, so a 3rd value would be
    // dead data (nothing reads amount beyond the ">= 2" check).
    amount: [1, 2, 2, 2, 2, 2, 2, 2],
    area: [1, 1.1, 1.1, 1.25, 1.4, 1.55, 1.7, 1.9],
    speed: [0, 0, 0, 0, 0, 0, 0, 0],
    pierce: [99, 99, 99, 99, 99, 99, 99, 99],
    durationMs: [170, 170, 170, 180, 180, 190, 200, 210],
    knockback: [110, 110, 120, 130, 140, 150, 160, 180],
    levelText: [
      '정면 일섬',
      '양옆 동시 일섬, 피해 ↑',
      '피해 +4',
      '피해 +5, 범위 ↑',
      '피해 +6, 범위 ↑',
      '피해 +7, 범위 ↑',
      '피해 +8, 범위 ↑',
      '피해 대폭 ↑, 범위 ↑',
    ],
  },

  wand: {
    id: 'wand',
    name: '마력탄',
    description: '가장 가까운 적을 자동으로 추격하는 마법탄.',
    behavior: 'projectile-nearest',
    icon: sheet(FRAMES.WAND_BLUE),
    maxLevel: 8,
    weight: 10,
    damage: [8, 10, 12, 14, 17, 20, 24, 28],
    cooldownMs: [950, 900, 850, 820, 780, 740, 700, 650],
    amount: [1, 1, 2, 2, 3, 3, 4, 4],
    area: [1, 1, 1.1, 1.1, 1.2, 1.2, 1.3, 1.4],
    speed: [430, 430, 450, 450, 470, 470, 490, 510],
    pierce: [1, 1, 1, 2, 2, 2, 3, 3],
    durationMs: [1500, 1500, 1500, 1500, 1600, 1600, 1700, 1800],
    knockback: [40, 40, 45, 45, 50, 50, 55, 60],
    levelText: [
      '근처 적에게 마법탄 1발',
      '피해 +2',
      '마법탄 +1',
      '관통 +1',
      '마법탄 +1',
      '쿨다운 ↓',
      '마법탄 +1, 관통 +1',
      '피해 대폭 ↑',
    ],
  },

  knife: {
    id: 'knife',
    name: '투척 단검',
    description: '바라보는 방향으로 빠르게 던지는 단검.',
    behavior: 'projectile-facing',
    icon: sheet(FRAMES.DAGGER),
    maxLevel: 8,
    weight: 10,
    damage: [7, 9, 11, 13, 15, 18, 21, 25],
    cooldownMs: [720, 670, 620, 580, 540, 500, 460, 420],
    amount: [1, 2, 2, 3, 3, 4, 5, 6],
    area: [1, 1, 1, 1.1, 1.1, 1.2, 1.2, 1.3],
    speed: [540, 540, 560, 560, 580, 580, 600, 640],
    pierce: [1, 1, 2, 2, 3, 3, 4, 4],
    durationMs: [1100, 1100, 1100, 1150, 1150, 1200, 1200, 1300],
    knockback: [25, 25, 30, 30, 35, 35, 40, 45],
    levelText: [
      '정면으로 단검 1개',
      '단검 +1',
      '관통 +1',
      '단검 +1',
      '관통 +1',
      '단검 +1',
      '단검 +1, 관통 +1',
      '단검 +1, 피해 ↑',
    ],
  },

  axe: {
    id: 'axe',
    name: '투척 도끼',
    description: '높이 던져 호를 그리며 떨어지는 강력한 도끼.',
    behavior: 'lobbed',
    icon: sheet(FRAMES.AXE),
    maxLevel: 8,
    weight: 7,
    damage: [20, 24, 30, 36, 44, 52, 62, 74],
    cooldownMs: [1500, 1460, 1420, 1380, 1340, 1300, 1260, 1200],
    amount: [1, 1, 2, 2, 3, 3, 4, 4],
    area: [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.65, 1.85],
    speed: [280, 280, 290, 290, 300, 300, 320, 340],
    pierce: [3, 3, 4, 4, 5, 5, 6, 99],
    durationMs: [1300, 1300, 1350, 1350, 1400, 1400, 1450, 1500],
    knockback: [80, 80, 90, 90, 100, 100, 110, 130],
    levelText: [
      '도끼 1개를 호로 던짐',
      '피해 +4',
      '도끼 +1',
      '피해 +6, 범위 ↑',
      '도끼 +1',
      '쿨다운 ↓',
      '도끼 +1, 관통 ↑',
      '관통 무한, 피해 ↑',
    ],
  },

  sanctuary: {
    id: 'sanctuary',
    name: '성역',
    description: '주위를 감싸는 신성한 장막. 닿는 적에게 지속 피해를 주고 밀쳐낸다.',
    behavior: 'aura',
    icon: sheet(FRAMES.POTION_BLUE),
    maxLevel: 8,
    weight: 6,
    damage: [5, 6, 7, 9, 11, 13, 15, 18],
    cooldownMs: [620, 600, 580, 560, 540, 520, 500, 460],
    amount: [1, 1, 1, 1, 1, 1, 1, 1],
    // radius growth trimmed (was 1 -> 2.3, +130%) so a maxed aura doesn't
    // out-scale every other weapon's effective range.
    area: [1, 1.12, 1.23, 1.35, 1.46, 1.62, 1.77, 2.0],
    speed: [0, 0, 0, 0, 0, 0, 0, 0],
    pierce: [99, 99, 99, 99, 99, 99, 99, 99],
    durationMs: [0, 0, 0, 0, 0, 0, 0, 0],
    // knockback present from level 1 (was 0 until lvl4) — sanctuary is the
    // "safe zone" aura: it keeps enemies pushed out, miasma (below) never
    // does and slows instead. See auraSlowMult on miasma for the contrast.
    knockback: [15, 15, 20, 25, 30, 35, 40, 50],
    levelText: [
      '주위 적에게 지속 피해, 밀쳐냄',
      '피해 +1',
      '피해 +1, 밀쳐냄 ↑',
      '범위 ↑, 밀쳐냄 ↑',
      '피해 +2, 범위 ↑',
      '피해 +2, 범위 ↑, 밀쳐냄 ↑',
      '범위 ↑',
      '피해 대폭 ↑, 밀쳐냄 ↑',
    ],
  },

  orbit: {
    id: 'orbit',
    name: '수호 영혼',
    description: '플레이어 주위를 도는 수호 영혼. 닿는 적에게 피해.',
    behavior: 'orbit',
    icon: gen(TEXTURES.ORB),
    maxLevel: 8,
    weight: 6,
    damage: [9, 11, 13, 16, 19, 23, 27, 32],
    cooldownMs: [500, 500, 480, 480, 460, 460, 440, 420],
    amount: [1, 2, 2, 3, 3, 4, 4, 5],
    area: [1, 1.05, 1.1, 1.18, 1.26, 1.36, 1.46, 1.6],
    speed: [150, 150, 160, 160, 170, 170, 185, 200],
    pierce: [99, 99, 99, 99, 99, 99, 99, 99],
    durationMs: [0, 0, 0, 0, 0, 0, 0, 0],
    knockback: [0, 0, 0, 0, 0, 0, 0, 0],
    levelText: [
      '영혼 1개가 주위를 회전',
      '영혼 +1',
      '피해 +2',
      '영혼 +1, 반경 ↑',
      '피해 +3',
      '영혼 +1',
      '회전 속도 ↑',
      '영혼 +1, 피해 ↑',
    ],
  },

  greatsword: {
    id: 'greatsword',
    name: '선풍검',
    description: '주위를 빙 둘러 휩쓰는 회전 베기. 포위됐을 때 강력하다.',
    behavior: 'spin',
    icon: sheet(FRAMES.SWORD),
    projectileTint: 0xff7a6a,
    maxLevel: 8,
    weight: 8,
    // Levels 1-3 untouched; the top-end growth (4-8) is trimmed on all three
    // axes (damage/cooldown/area) so a maxed greatsword no longer has both
    // the largest radius AND the highest per-target DPS of the three
    // unlimited-target AoE weapons (sanctuary/miasma/greatsword) at once.
    damage: [22, 27, 33, 40, 47, 54, 62, 70],
    cooldownMs: [1450, 1420, 1400, 1380, 1360, 1340, 1320, 1300],
    amount: [1, 1, 1, 1, 1, 1, 1, 1],
    area: [1.3, 1.4, 1.5, 1.63, 1.77, 1.93, 2.1, 2.3],
    speed: [0, 0, 0, 0, 0, 0, 0, 0],
    pierce: [99, 99, 99, 99, 99, 99, 99, 99],
    durationMs: [280, 280, 280, 280, 280, 280, 280, 280],
    knockback: [180, 190, 200, 220, 240, 260, 280, 320],
    levelText: [
      '주위를 휩쓰는 회전 베기',
      '피해 +5',
      '피해 +6, 범위 ↑',
      '범위 ↑',
      '피해 +8, 범위 ↑',
      '쿨다운 ↓, 넉백 ↑',
      '범위 ↑',
      '피해 대폭 ↑',
    ],
  },

  spear: {
    id: 'spear',
    name: '장창',
    description: '정면 일직선을 꿰뚫는 창. 여러 자루도 흩어지지 않고 나란히 찌른다.',
    behavior: 'projectile-facing',
    icon: sheet(FRAMES.SWORD_GOLD),
    projectileTint: 0xffe79a,
    projectileTexture: TEXTURES.SPEAR,
    // straight parallel volley instead of the knife's fan spread — see
    // volleySpreadRad doc in types.ts.
    volleySpreadRad: 0,
    maxLevel: 8,
    weight: 8,
    damage: [14, 17, 21, 25, 30, 36, 43, 52],
    cooldownMs: [900, 860, 820, 780, 740, 700, 660, 620],
    amount: [1, 1, 1, 2, 2, 2, 3, 3],
    area: [1.2, 1.2, 1.3, 1.3, 1.4, 1.4, 1.5, 1.6],
    speed: [620, 620, 640, 640, 660, 680, 700, 740],
    pierce: [3, 3, 4, 4, 5, 6, 7, 99],
    durationMs: [1100, 1100, 1150, 1150, 1200, 1200, 1250, 1300],
    knockback: [40, 40, 50, 50, 60, 60, 70, 90],
    levelText: [
      '정면을 꿰뚫는 창',
      '피해 +3',
      '관통 +1, 피해 ↑',
      '창 +1',
      '관통 +1, 피해 ↑',
      '관통 +1',
      '창 +1, 관통 ↑',
      '관통 무한, 피해 ↑',
    ],
  },

  runebolt: {
    id: 'runebolt',
    name: '룬 마탄',
    description: '느리지만 강력하고 잘 관통하는 룬 마법탄.',
    behavior: 'projectile-nearest',
    icon: sheet(FRAMES.WAND_PINK),
    projectileTint: 0xc060ff,
    maxLevel: 8,
    weight: 7,
    damage: [12, 15, 18, 22, 27, 32, 38, 46],
    cooldownMs: [1100, 1050, 1000, 960, 920, 880, 840, 800],
    amount: [1, 1, 1, 2, 2, 2, 3, 3],
    area: [1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.9],
    speed: [380, 380, 400, 400, 420, 440, 460, 480],
    pierce: [2, 2, 3, 3, 4, 4, 5, 6],
    durationMs: [1600, 1600, 1650, 1650, 1700, 1750, 1800, 1900],
    knockback: [50, 50, 60, 60, 70, 70, 80, 90],
    levelText: [
      '근처 적에게 룬 마법탄',
      '피해 +3',
      '관통 +1, 피해 ↑',
      '마법탄 +1',
      '관통 +1, 피해 ↑',
      '쿨다운 ↓',
      '마법탄 +1, 관통 +1',
      '피해 대폭 ↑',
    ],
  },

  lightning: {
    id: 'lightning',
    name: '연쇄 뇌격',
    description: '무작위 적에게 낙뢰가 떨어지고, 근처 적에게로 번개가 연쇄한다.',
    behavior: 'chain',
    icon: gen(TEXTURES.ICON_LIGHTNING),
    projectileTint: 0xffe45a,
    chainRange: 150,
    maxLevel: 8,
    weight: 7,
    // Uncontrollable targeting pays out in total hits: bolts × (1 + jumps)
    // touches at max = 3 × 6 = 18 enemies per cast.
    damage: [15, 19, 23, 28, 34, 41, 49, 58],
    cooldownMs: [1600, 1550, 1500, 1450, 1400, 1350, 1300, 1200],
    amount: [1, 1, 1, 2, 2, 2, 3, 3],
    area: [1, 1, 1.1, 1.1, 1.2, 1.2, 1.3, 1.4],
    speed: [0, 0, 0, 0, 0, 0, 0, 0],
    pierce: [1, 2, 2, 3, 3, 4, 4, 5],
    durationMs: [180, 180, 180, 180, 190, 190, 200, 210],
    knockback: [0, 0, 20, 20, 30, 30, 40, 50],
    levelText: [
      '무작위 적에게 낙뢰, 1회 연쇄',
      '연쇄 +1',
      '피해 +4, 범위 ↑',
      '낙뢰 +1, 연쇄 +1',
      '피해 +6, 범위 ↑',
      '연쇄 +1',
      '낙뢰 +1, 범위 ↑',
      '연쇄 +1, 피해 대폭 ↑',
    ],
  },

  boomerang: {
    id: 'boomerang',
    name: '부메랑',
    description: '던진 방향으로 날아갔다 되돌아오며, 오가는 길의 적을 두 번 벤다.',
    behavior: 'boomerang',
    icon: gen(TEXTURES.ICON_BOOMERANG),
    maxLevel: 8,
    weight: 8,
    damage: [12, 15, 18, 22, 27, 33, 40, 48],
    cooldownMs: [1350, 1300, 1250, 1200, 1150, 1100, 1050, 980],
    amount: [1, 1, 2, 2, 2, 3, 3, 4],
    area: [1, 1.1, 1.1, 1.2, 1.2, 1.3, 1.4, 1.5],
    // outbound speed; the turn-around range grows with it (≈ speed / 1.8 px)
    speed: [430, 440, 450, 460, 480, 500, 520, 560],
    pierce: [99, 99, 99, 99, 99, 99, 99, 99],
    // failsafe only — the boomerang normally despawns when it returns to hand
    durationMs: [2600, 2600, 2700, 2700, 2800, 2800, 2900, 3000],
    knockback: [40, 40, 50, 50, 60, 60, 70, 80],
    levelText: [
      '왕복하며 두 번 베는 부메랑',
      '피해 +3, 범위 ↑',
      '부메랑 +1',
      '피해 +4, 범위 ↑',
      '피해 +5, 속도 ↑',
      '부메랑 +1',
      '범위 ↑, 속도 ↑',
      '부메랑 +1, 피해 대폭 ↑',
    ],
  },

  mine: {
    id: 'mine',
    name: '화염 지뢰',
    description:
      '발밑에 지뢰를 설치한다. 밟은 적은 폭발하고, 자리에 불타는 장판이 남는다. 도망치며 싸울 때 강력하다.',
    behavior: 'mine',
    icon: gen(TEXTURES.ICON_MINE),
    projectileTint: 0xff7a2a,
    maxLevel: 8,
    weight: 6,
    // damage = the blast; the burn patch ticks at 20% of it every 400ms for
    // durationMs. Slow cadence + placement skill = the highest per-hit numbers
    // of the non-boss weapons.
    damage: [25, 30, 37, 45, 54, 64, 76, 90],
    cooldownMs: [2400, 2300, 2200, 2100, 2000, 1900, 1800, 1600],
    amount: [1, 1, 1, 2, 2, 2, 3, 3],
    area: [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.65, 1.8],
    speed: [0, 0, 0, 0, 0, 0, 0, 0],
    pierce: [99, 99, 99, 99, 99, 99, 99, 99],
    durationMs: [1200, 1300, 1400, 1500, 1600, 1700, 1800, 2000],
    knockback: [120, 130, 140, 150, 160, 170, 190, 220],
    levelText: [
      '밟으면 폭발하는 지뢰 설치',
      '피해 +5, 범위 ↑',
      '피해 +7, 불길 지속 ↑',
      '지뢰 +1',
      '피해 +9, 범위 ↑',
      '불길 지속 ↑, 범위 ↑',
      '지뢰 +1',
      '피해 대폭 ↑, 불길 지속 ↑',
    ],
  },

  leech: {
    id: 'leech',
    name: '흡혈 사슬',
    description: '가까운 적에게 피의 사슬을 걸어 지속 피해를 주고, 피해의 일부를 체력으로 흡수한다.',
    behavior: 'leech',
    icon: gen(TEXTURES.ICON_FANG),
    projectileTint: 0xff4a5a,
    lifestealFrac: 0.2,
    maxLevel: 8,
    weight: 6,
    // Low DPS for an auto-hit weapon — the payload is the sustain, and it
    // only drains what it can reach (base range 175px × area).
    damage: [7, 9, 11, 13, 16, 19, 23, 28],
    cooldownMs: [850, 820, 790, 760, 730, 700, 670, 620],
    amount: [1, 1, 1, 2, 2, 2, 3, 3],
    area: [1, 1.1, 1.15, 1.2, 1.3, 1.35, 1.45, 1.6],
    speed: [0, 0, 0, 0, 0, 0, 0, 0],
    pierce: [99, 99, 99, 99, 99, 99, 99, 99],
    durationMs: [220, 220, 220, 220, 220, 220, 220, 220],
    knockback: [0, 0, 0, 0, 0, 0, 0, 0],
    levelText: [
      '가장 가까운 적을 흡혈',
      '피해 +2, 사거리 ↑',
      '피해 +2, 사거리 ↑',
      '사슬 +1',
      '피해 +3, 사거리 ↑',
      '피해 +3, 사거리 ↑',
      '사슬 +1',
      '피해 대폭 ↑, 사거리 ↑',
    ],
  },

  miasma: {
    id: 'miasma',
    name: '독무',
    description: '넓게 퍼지는 독성 장막. 닿는 적에게 지속 피해를 주고 이동속도를 늦춘다.',
    behavior: 'aura',
    icon: sheet(FRAMES.POTION_GREEN),
    projectileTint: 0x8bff5a,
    // enemies inside move at 55% speed while the tick keeps re-applying it —
    // miasma is the "bog down" aura (no knockback), sanctuary above is the
    // "push out" aura (knockback, no slow). Flat regardless of level; radius
    // and damage still scale normally via area[]/damage[].
    auraSlowMult: 0.55,
    maxLevel: 8,
    weight: 6,
    damage: [4, 5, 6, 7, 9, 11, 13, 16],
    cooldownMs: [700, 680, 660, 640, 620, 600, 580, 540],
    amount: [1, 1, 1, 1, 1, 1, 1, 1],
    // radius growth trimmed (was 1.3 -> 3.1, +138%) — same rationale as
    // sanctuary above.
    area: [1.3, 1.44, 1.59, 1.73, 1.88, 2.09, 2.31, 2.6],
    speed: [0, 0, 0, 0, 0, 0, 0, 0],
    pierce: [99, 99, 99, 99, 99, 99, 99, 99],
    durationMs: [0, 0, 0, 0, 0, 0, 0, 0],
    knockback: [0, 0, 0, 0, 0, 0, 0, 0],
    levelText: [
      '넓은 독 장막, 적 둔화',
      '피해 +1, 범위 ↑',
      '피해 +1, 범위 ↑',
      '범위 ↑',
      '피해 +2, 범위 ↑',
      '피해 +2, 범위 ↑',
      '범위 ↑',
      '피해 대폭 ↑',
    ],
  },
};
