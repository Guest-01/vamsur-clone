# 영원한 밤의 묘지 · Crypt of the Eternal Night

웹 기반 **뱀파이어 서바이버(Vampire Survivors) 스타일** 데모. **Phaser 4 + TypeScript + Vite.**
콘텐츠는 데모 규모지만 핵심 시스템 — 경험치 · 레벨 · 레벨업 강화 선택 · 무기/패시브 강화 · 웨이브 스폰 · 난이도 스케일링 · 보스 · 메타 진행(영구 강화/해금) — 은 모두 구현되어 있습니다.

## 실행 방법

```bash
npm install      # 최초 1회 (의존성 설치)
npm run dev      # 개발 서버 → 브라우저에서 http://localhost:5173 접속
npm run build    # 타입 체크 + 프로덕션 빌드 (dist/)
npm run preview  # 빌드 결과 미리보기
```

> 개발 서버는 자동으로 브라우저를 열지 않습니다. 출력된 `http://localhost:5173` 로 직접 접속하세요.

## 조작

| 입력 | 동작 |
| --- | --- |
| `W A S D` / 방향키 | 이동 (무기는 자동 공격) |
| `1` `2` `3` / `← →` + `Enter` | 레벨업 강화 카드 선택 |
| `R` | 레벨업 선택지 새로고침 (운명의 거울 보유 시) |
| `↑` `↓` | (메뉴에서) 저주 계약 단계 조절 — 첫 승리 후 해금 |
| `Esc` | 일시정지 / 재개 |
| `H` | 플레이 가이드 열기 |
| `B` | (메뉴에서) 상점 열기 |
| 마우스 | 메뉴 · 카드 · 버튼 선택 |

## 게임 시스템

- **경험치 & 레벨**: 적이 떨어뜨린 보석을 흡수해 경험치 획득, 레벨업마다 강화 카드 3장 중 1개 선택.
- **무기 (10종)**: 채찍, 매직 완드(자동 추적), 단검(투척), 도끼(포물선), 신성 오라(지속 장판), 수호 영혼(회전 궤도), 회전검(주위 360° 베기), 창(관통), 룬볼트(강력 마법탄), 독무(광역 오라). 레벨별 강화.
- **패시브 아이템 (18종)**: 최대 체력 · 위력 · 이동속도 · 쿨다운 · 범위 · 투사체 수/속도 · 자력 · 방어 · 체력 재생 · 치명타율/피해 · 회피 · 부활 · 골드 · 지속 · 행운 · 경험치.
- **캐릭터 (5종)**: 기사(탱커) / 마법사(위력·범위) / 도적(속도·치명타) / 사제(오라·재생) / 전사(궤도·탱키). 각자 시작 무기가 다름.
- **적 & 웨이브**: 시간이 지날수록 적의 종류·수·체력·피해가 증가. 중간 정예(보물상자 드롭)와 보스(Demon King · The Eternal Night) 등장. 화면 밖에 보물상자가 있으면 화면 가장자리에 금색 나침반 화살표가 방향을 알려줍니다.
- **돌발 이벤트**: 런 중간에 정해진 타이밍으로 **골드 러시**(골드 2배 + 동전 비), **핏빛 달**(적 쇄도 + 경험치 1.5배), **유령 행렬**(골드를 잘 떨어뜨리는 망령 무리 습격)이 발생해 8분의 리듬을 바꿉니다.
- **하드 모드 (저주 계약)**: 첫 승리 후 메뉴에서 해금. 단계당 적 체력 +20%·피해 +10%·동시 출현 +10%, 대신 골드 +25%·경험치 +15%. 해당 단계에서 승리해야 다음 단계가 열립니다 (최대 5단계).
- **메타 진행 (상점)**: 런에서 번 골드가 영구 적립됩니다. 상점에서 **영구 강화 13종**(시작 스탯 보너스에 더해 치명타(살상술), 레벨업 선택지 새로고침(운명의 거울) 같은 특수 강화 포함)과 **1회성 소모품**(선구자 — 다음 런을 레벨 2로 시작)을 구입하고, 확장 **캐릭터·무기를 해금**할 수 있습니다. 진행 상황은 브라우저(localStorage)에 저장됩니다.
- **승리/패배**: 8분 생존 시 승리, 사망 시 게임 오버. 최고 생존 시간 저장. 결과 화면에서 무기별 총 피해량 차트로 빌드 성능을 확인할 수 있습니다.

## 아키텍처

전체 설계는 [`ARCHITECTURE.md`](./ARCHITECTURE.md) 참고. 핵심은 모든 게임플레이 모듈이 서로를 직접 import 하지 않고 `GameContext`(`src/types.ts`)를 통해서만 통신하는 데이터 주도 구조입니다.

```
src/
  main.ts                  # 게임 부팅 + 폰트 로딩 + 씬 등록
  types.ts                 # 공유 타입 계약 (단일 진실 소스: GameContext 등)
  config/                  # assets(프레임 인덱스), balance(튜닝 상수)
  content/                 # characters · enemies · items · weapons · powerups 데이터
  state/MetaState.ts       # 영구 진행(골드·강화·해금) localStorage 저장
  systems/                 # stats · EnemySpawner · WeaponSystem · ExperienceSystem · UpgradeSystem
  entities/                # Player · Enemy · Projectile · Pickup
  scenes/                  # Boot · Menu · Game · UI · GameOver · Shop
  ui/                      # LevelUpOverlay · PauseOverlay · HelpOverlay
  gfx/TextureFactory.ts    # 절차적 텍스처(보석·오라·배경·아이콘 등) 생성
public/assets/sprites/     # Kenney Tiny Dungeon 스프라이트시트 (CC0)
```

## 에셋 크레딧

- 스프라이트: **Kenney — "Tiny Dungeon"** ([kenney.nl](https://kenney.nl)), **CC0 1.0** (퍼블릭 도메인). `public/assets/sprites/CREDITS-kenney-tiny-dungeon.txt` 참고.
- 보석 · 파티클 · 오라 · 배경 · UI 아이콘 등은 런타임에 코드로 생성합니다.
- 폰트: *Press Start 2P*, *Cinzel* (Google Fonts, OFL) — `@fontsource`로 번들.

## 고지 (Disclaimer)

이 프로젝트는 **[Vampire Survivors](https://poncle.itch.io/vampire-survivors)** (© poncle Ltd)에서 영감을 받은 **비공식 · 비영리 · 학습용 클론**입니다. poncle 및 Vampire Survivors와 **아무런 제휴 관계가 없으며**, 원작의 코드 · 아트 · 음악 · 상표를 **일절 사용하지 않았습니다**. 모든 아트는 CC0(퍼블릭 도메인) 또는 자작이고, 차용한 것은 저작권 대상이 아닌 **장르 메커니즘(아이디어)** 뿐입니다. 무기 · 아이템 이름 등 표현 요소는 원작과 겹치지 않도록 자작 명칭으로 작성했습니다.

> This is an **unofficial, non-commercial, educational** fan clone inspired by *Vampire Survivors* (© poncle Ltd). **Not affiliated with or endorsed by poncle.** No original code, art, audio, or trademarks are used; only the (non-copyrightable) genre mechanics are referenced. All art is CC0 or original.

## 라이선스

코드는 MIT 라이선스(`package.json`)이며, 아트는 CC0(위 크레딧 참조)입니다.
