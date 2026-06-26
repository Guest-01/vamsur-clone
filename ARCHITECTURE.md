# Crypt of the Eternal Night — Architecture & Implementation Spec

A web Vampire-Survivors–style demo. **Phaser 4.2 + TypeScript + Vite.** Art is
Kenney's CC0 *Tiny Dungeon* spritesheet (`tiles`, 16×16 frames) plus procedural
textures. This document is the authoritative contract: implement to these exact
signatures so the parts integrate.

Read these files first — they are the single source of truth and already exist:

- `src/types.ts` — all shared interfaces, `SCENES`, `EVENTS`, `REGISTRY`, `GameContext`.
- `src/config/assets.ts` — `TEXTURES`, `FRAMES`, `SHEET`.
- `src/config/balance.ts` — all tunables, `DEFAULT_STATS`, curves, `COLORS`, `RARITY`, `DEPTH`.
- `src/content/{characters,enemies,items,weapons}.ts` — data registries.
- `src/systems/stats.ts` — `createBaseStats`, `recomputeStats`.
- `src/gfx/TextureFactory.ts` — generates every `TEXTURES.*` procedural texture.
- `src/scenes/BootScene.ts`, `src/main.ts` — already done.

## Golden rules

1. **Never import one gameplay module from another.** Everything talks through
   the `GameContext` object (`src/types.ts`). The only cross-imports allowed are:
   from `types.ts`, `config/*`, `content/*`, `systems/stats.ts`, and `gfx/*`.
   Systems may import the content registries (`WEAPONS`, `ITEMS`, `ENEMIES`,
   `CHARACTERS`, `WAVES`). UI/scene code reads live state via events + a snapshot.
2. **`import Phaser from 'phaser'`** at the top of every file using Phaser.
3. **One shared `PlayerStats` object.** `player.stats === ctx.stats`. Upgrades
   mutate it via `ctx.recomputeStats()`; never replace the reference.
4. Use exact **named exports** and file paths listed under each section.
5. Keep `strict` TypeScript happy. `skipLibCheck` is on; avoid `any` except where
   the spec explicitly allows casting Phaser group children.

## Phaser 4 gotchas (do NOT trip on these)

- Core API (Scene, Arcade physics, GameObjects, tweens, input, particles) is the
  same as Phaser 3.60+. `this.add.particles(x, y, textureKey, { ... })` is the
  3.60+ emitter API — use it.
- `setTintFill()` is removed → use `setTint(color)` for tinting. For a hit-flash,
  use `setTintFill`-free flash: `sprite.setTint(0xffffff)` then
  `scene.time.delayedCall(60, () => sprite.clearTint())`, optionally with
  `setBlendMode(Phaser.BlendModes.ADD)` briefly. Do not use FX pipelines (bloom/glow).
- Use `Math.PI * 2` for a full turn (NOT `Phaser.Math.TAU`).
- Use `Phaser.Math.Vector2` (NOT `Geom.Point`).
- `this.scene.pause()` halts a scene's update/physics/`preUpdate` but its
  `EventEmitter` still dispatches — we rely on this for the level-up flow.
- A scene can control sibling scenes: `this.scene.launch(key, data)`,
  `this.scene.pause(key)`, `this.scene.resume(key)`, `this.scene.stop(key)`,
  `this.scene.get(key)`.

## World / camera model

- Internal resolution `GAME.WIDTH×GAME.HEIGHT` (960×540), `Scale.FIT` + center,
  `pixelArt: true` (already configured in `main.ts`).
- **Infinite arena**: no world/camera bounds. Player spawns at (0,0); camera
  `startFollow(player, true, 0.12, 0.12)`.
- **Background**: one `TileSprite` of `TEXTURES.BG_TILE` sized to the viewport,
  `setScrollFactor(0)`, `setDepth(DEPTH.BG)`; each frame set
  `bg.tilePositionX = cam.scrollX; bg.tilePositionY = cam.scrollY` for an
  infinite scrolling floor. Add an ambient dust particle emitter (TEXTURES.PARTICLE,
  very low alpha, slow) following the camera for atmosphere (optional but nice).
- **Vignette**: `Image` of `TEXTURES.VIGNETTE`, `setScrollFactor(0)`,
  `setDepth(DEPTH.VIGNETTE)`, sized to the viewport.
- Sprites from the sheet use `ENTITY_SCALE` (×2) as their base scale.

## Entity pooling pattern (use everywhere)

Groups are **plain Arcade physics groups** (no `classType`). Each owning system
pools its own instances:

```ts
let e = group.getFirstDead(false) as Enemy | null;
if (!e) { e = new Enemy(scene); group.add(e, true); }
e.spawn(ctx, def, x, y);   // activates + positions + resets state
```

`getFirstDead` returns an inactive (`active === false`) member. Entities call
`this.deactivate()` (disable body, `setActive(false).setVisible(false)`) when done.

---

# Module specs

## A. Player — `src/entities/Player.ts` → `export class Player`

`class Player extends Phaser.Physics.Arcade.Sprite implements PlayerLike`

- `constructor(scene, x, y, character: CharacterDef)`: `super(scene, x, y, TEXTURES.SPRITES, character.frame)`; add to scene + physics; `setDepth(DEPTH.PLAYER)`, `setScale(ENTITY_SCALE)`, circular body (`setCircle`) radius ≈ `PLAYER.BODY_RADIUS`, `setCollideWorldBounds(false)`. Add a soft shadow sprite (`TEXTURES.SHADOW`) that follows it (depth `DEPTH.SHADOW`).
- Fields: `stats: PlayerStats` (set in `init`), `facing = new Phaser.Math.Vector2(1, 0)`, `hp: number`, `maxHp`, `isAlive = true`. Keep `ctx` privately.
- `init(ctx: GameContext)`: store ctx; `this.stats = ctx.stats`; `this.hp = this.maxHp = stats.maxHp`; create the keyboard cursor keys + WASD here.
- Movement (in `preUpdate(time, delta)` after `super.preUpdate`): read WASD/arrows → velocity = normalized dir × `stats.moveSpeed`. Update `facing` when moving (keep last when idle). Flip sprite X to face move direction. Add a subtle idle/run bob (small `scaleY` tween or sine on `y` offset of the body image). Regenerate hp: `hp = min(maxHp, hp + stats.hpRegen * dt)`, emit `HP_CHANGED` at most ~4×/s. Keep shadow under the sprite.
- `takeDamage(amount)`: if `!isAlive` or within i-frame window (`PLAYER.IFRAME_MS`) return. Roll `stats.dodge` to possibly negate. `dmg = max(1, amount - stats.armor)`. `hp -= dmg`; set i-frame timestamp; flash red (`setTint(COLORS.BLOOD_LIGHT)` briefly + alpha blink during i-frames); `ctx.events.emit(EVENTS.PLAYER_HIT)`; `ctx.shakeCamera(0.004, 120)`; emit `HP_CHANGED {current: hp, max: maxHp}`. If `hp <= 0` set `isAlive = false` (GameScene polls this and may revive).
- `heal(amount)`: `hp = min(maxHp, hp + amount)`; emit `HP_CHANGED`.
- Optional: pointer-hold movement toward pointer for touch — nice-to-have only.

## B. Enemy + Spawner

### `src/entities/Enemy.ts` → `export class Enemy`

`class Enemy extends Phaser.Physics.Arcade.Sprite implements EnemyLike`

- `constructor(scene)`: `super(scene, 0, 0, TEXTURES.SPRITES, 0)`; add to scene + physics; start inactive. Give it a circular body.
- `spawn(ctx, def: EnemyDef, x, y)`: store ctx + def; `setActive(true).setVisible(true)`, enable body; `setTexture(TEXTURES.SPRITES, def.frame)`; apply `def.tint` if present (else `clearTint`); `setScale(ENTITY_SCALE * def.scale)`; `setDepth(def.isBoss ? DEPTH.ENEMY + 1 : DEPTH.ENEMY)`. Compute scaled stats from time: `maxHp = def.baseHp * hpScale(ctx.run.elapsedMs)`, `hp = maxHp`; cache `contactDamage = def.contactDamage * damageScale(...)`, `speed = def.moveSpeed * speedScale(...)`. Reset hit-flash + a per-frame "touched player" cooldown. Bosses/elites: optionally add a small health bar above them and a faint tint pulse.
- `preUpdate(time, delta)` (after super): if inactive return. Steer toward `ctx.player` at `speed` (for `wander-chase` add slight sine wobble; `charger` periodically dashes — optional, default plain chase). Face the player (flip X). Despawn if farther than `SPAWN.DESPAWN_DIST` from the player (just `deactivate`, no death/drop). Keep a shadow if you added one.
- `takeDamage(amount, from?, knockback?)`: `hp -= amount`; white hit-flash; spawn a tiny hit spark (TEXTURES.SPARK/PARTICLE). Apply knockback impulse away from `from` scaled by `(1 - def.knockbackResist)` (set a short-lived velocity, then resume chase). If `hp <= 0` → `die()`.
- `die()`: `ctx.addKill()`; `ctx.spawnXpGem(x, y, def.xp)`; if `rng < def.goldChance` → `ctx.spawnPickup(x, y, 'gold')`; elites/bosses → also `ctx.spawnPickup(x, y, 'chest')`; emit a death poof (particles); if boss → big shake + bright flash. `deactivate()`.
- `deactivate()`: disable body, `setActive(false).setVisible(false)`, clear tint, hide shadow.

### `src/systems/EnemySpawner.ts` → `export class EnemySpawner implements IEnemySpawner`

- `constructor(ctx)`. Reads `WAVES` + `ENEMIES`.
- `update(time, delta)`: pick the active wave (latest whose `timeSec*1000 <= elapsedMs`). On wave change, if it has a `bossId`, spawn that boss once (near the player, off-screen). Maintain spawn cadence: every `spawnIntervalSec`, if alive enemy count < `cap`, spawn `burst` enemies at random points on a ring just outside the camera view (use camera size + `SPAWN.RING_PAD`; pick random angle, place relative to player). Pull enemies from the pool (pattern above) using `ctx.enemies`.
- Count alive enemies via `ctx.enemies.countActive(true)`.

## C. Weapons — `src/systems/WeaponSystem.ts` → `export class WeaponSystem implements IWeaponSystem`

Owns owned-weapon state, firing, projectiles, and projectile↔enemy overlap.

- `constructor(ctx)`: store ctx; `owned = new Map<WeaponId, number>()`; set up `this.scene.physics.add.overlap(ctx.projectiles, ctx.enemies, this.onProjectileHit, undefined, this)`.
- `addWeapon(id)`: if owned return false; set level 1; emit `WEAPONS_CHANGED` (payload built via a `getOwnedViews()` helper → `OwnedWeaponView[]`). For persistent weapons (`aura`, `orbit`) create their persistent visuals now.
- `levelUpWeapon(id)`: bump level (cap at `def.maxLevel`); update persistent weapons' visuals (e.g. orbit orb count); emit `WEAPONS_CHANGED`.
- `hasWeapon`, `getLevel`, `ownedCount`, `getOwned` per `IWeaponSystem`.
- `update(time, delta)`: per owned weapon, accumulate a timer; when `>= cooldownMs[lvl-1] * stats.cooldownMult` fire it and reset. Persistent weapons (aura/orbit) update continuously instead.

### Firing per `behavior` (use the per-level arrays; `lvl = level-1` index)

Effective values: `damage = def.damage[lvl] * stats.might` (roll crit per hit using
`stats.critChance`/`critMult`); `count = def.amount[lvl] + stats.amount`;
`speed = def.speed[lvl] * stats.projectileSpeed`; `area = def.area[lvl] * stats.area`;
`pierce = def.pierce[lvl]`; `life = def.durationMs[lvl] * stats.duration`;
`knock = def.knockback[lvl]`.

- **projectile-facing** (knife): spawn `count` `Projectile`s from player toward `player.facing` (spread slightly / stagger), texture `TEXTURES.KNIFE`, rotate to angle.
- **projectile-nearest** (wand): for each of `count`, target the nearest enemy (use `ctx.getNearestEnemy`); homing-lite (aim at spawn time, or mild steering). Texture `TEXTURES.BOLT`, additive blend.
- **lobbed** (axe): spawn `count` axes that arc upward then fall (fake gravity by tweening a y-offset, or real arcade gravity on the body for that projectile); use the sheet axe frame (`FRAMES.AXE`) spinning; damages enemies it overlaps until `pierce` exhausted.
- **whip**: spawn a short-lived `TEXTURES.SLASH` sprite to the facing side (and the opposite side if `count >= 2`), scaled by `area`, depth FX, additive. Immediately damage all enemies inside its box/arc once (use `ctx.getEnemiesInRadius` around an offset point, or an overlap rect). Apply knockback. Tween scale/alpha out over `life`.
- **aura** (sanctuary): keep a persistent `TEXTURES.AURA` sprite centred on the player, tinted holy (e.g. `COLORS.GOLD_LIGHT` or a soft cyan), radius from `area`. Every `cooldownMs[lvl]` tick, damage all enemies within the radius (`ctx.getEnemiesInRadius`). Light knockback at high level. Pulse the alpha gently.
- **orbit** (spirit orbs): keep `count` `TEXTURES.ORB` sprites orbiting the player at radius from `area`, angular speed `speed` deg/s. On contact (manual distance check or per-orb overlap) deal damage with a per-enemy re-hit cooldown (`cooldownMs[lvl]`).

### `src/entities/Projectile.ts` → `export class Projectile`

`class Projectile extends Phaser.Physics.Arcade.Sprite`

- `constructor(scene)`: inactive sprite.
- `fire(ctx, opts: { x, y, vx, vy, textureKey, frame?, damage, pierce, life, knockback, scale, angle?, spin?, crit? })`: activate, position, set velocity, depth `DEPTH.PROJECTILE`, blend mode, rotation; reset `hitSet` (enemies already hit, to enforce pierce one-hit-per-enemy) and lifetime timer.
- `preUpdate`: countdown life → `deactivate` when expired. Optional spin. For lobbed, manage arc.
- `hit(enemy: EnemySprite)`: if already in `hitSet` ignore; add; `ctx.damageEnemy(enemy, this.damage, { knockback, crit })`; `pierce--`; if `pierce < 0` `deactivate()`.
- `WeaponSystem.onProjectileHit(projObj, enemyObj)`: cast both, ignore if either inactive, call `proj.hit(enemy)`.

## D. Progression + pickups

### `src/systems/ExperienceSystem.ts` → `export class ExperienceSystem implements IExperienceSystem`

- `constructor(ctx)`; initialise `ctx.run.xpToNext = xpForLevel(1)`.
- `xpForLevel(level)` → delegate to balance `xpForLevel`.
- `addXp(amount)`: `run.xp += amount * stats.xpGain`; while `run.xp >= run.xpToNext`: subtract, `run.level++`, `run.xpToNext = xpForLevel(run.level)`, call `ctx.queueLevelUp()`. After the loop emit `XP_CHANGED {xp, xpToNext, level}`.

### `src/systems/UpgradeSystem.ts` → `export class UpgradeSystem implements IUpgradeSystem`

- `constructor(ctx)`. Reads `WEAPONS`, `ITEMS`, `RUN`, `RARITY`.
- `rollOptions(count)`: build the candidate pool:
  - level-weapon: each owned weapon with `level < maxLevel`.
  - new-weapon: each unowned weapon, **only if** `weaponSystem.ownedCount() < RUN.MAX_WEAPONS`.
  - level-item: each owned item with `level < maxLevel`.
  - new-item: each unowned item, only if owned item count `< RUN.MAX_ITEMS`.
  Weight candidates by their `weight` (scale "new" slightly higher early); pick
  `count` **distinct** options (weighted, no dups). Build `UpgradeOption` for each
  (set `name`, `description` = next-level `levelText` or base description, `icon`,
  `level` = next level, `maxLevel`, `isWeapon`, `tag` = `NEW`/`Lv N`, `rarityColor`
  by tier: maxed-soon/legendary etc. — use `RARITY`). If the pool is empty (all
  maxed) return fallback options: `heal` (restore 30% HP) and/or `gold`.
- `apply(option)`: dispatch by `kind`:
  - `new-weapon` → `weaponSystem.addWeapon(id)`.
  - `level-weapon` → `weaponSystem.levelUpWeapon(id)`.
  - `new-item` → `run.ownedItems.set(id, 1)`; `ctx.recomputeStats()`; emit `ITEMS_CHANGED`.
  - `level-item` → `run.ownedItems.set(id, current+1)`; `ctx.recomputeStats()`; emit `ITEMS_CHANGED`.
  - `heal` → `player.heal(maxHp * 0.3)`.
  - `gold` → `ctx.addGold(option.level)`.
  After applying an item, if `maxHp` grew, top up `player.hp` by the delta.
- Provide `getItemViews(): OwnedItemView[]` helper for the HUD/summary.

### `src/entities/Pickup.ts` → `export class Pickup`

`class Pickup extends Phaser.Physics.Arcade.Sprite implements PickupLike`

- Types: `xp` (gem; choose `TEXTURES.GEM_S/M/L` by value vs `GEM_TIERS`), `health`
  (`FRAMES.POTION_RED`), `gold` (`FRAMES.COINS`), `magnet` (`TEXTURES.RING` or a
  bottle frame), `chest` (`FRAMES.CHEST`).
- `spawn(ctx, type, x, y, value)`: activate, choose texture/frame, depth
  `DEPTH.PICKUP`, small spawn pop tween + gentle idle bob. Gems sparkle.
- `preUpdate`: distance to player. If within `max(stats.magnet, ...)` accelerate
  toward the player (`PICKUP.MAGNET_SPEED/ACCEL`). If within `PICKUP.GRAB_RADIUS`
  (or overlapping) `collect()`.
- `collect()`: by type → `xp`: `ctx.addXp(value)`; `health`: `player.heal(PICKUP.HEALTH_HEAL)`;
  `gold`: `ctx.addGold(PICKUP.GOLD_VALUE)`; `magnet`: vacuum all active gems to the
  player; `chest`: trigger `PICKUP.CHEST_ROLLS` level-up screens (call
  `ctx.queueLevelUp()`). Play a small collect fx/sound; `deactivate()`.

## E. GameScene — `src/scenes/GameScene.ts` → `export class GameScene`

The integrator. Builds `GameContext`, owns the run loop, scene transitions, and
implements all `GameContext` helpers.

- `super(SCENES.GAME)`. `init(data: { characterId: CharacterId })` stores it.
- `create()`:
  1. Background TileSprite + vignette + ambient dust (see World model).
  2. `const character = getCharacter(this.characterId)`.
  3. Create groups: `enemies`, `projectiles`, `pickups` = `this.physics.add.group({ maxSize: ... })` (plain). Also an `fx` particle manager / layer.
  4. `const stats = createBaseStats(character)`.
  5. `player = new Player(this, 0, 0, character)`; camera follow.
  6. Build `run: RunState` (`elapsedMs:0, level:1, xp:0, xpToNext: xpForLevel(1), kills:0, gold:0, ownedItems:new Map(), characterId, gameOver:false, victory:false`).
  7. Build the `ctx: GameContext` object (see helpers below) referencing player/groups/stats/run/`this.events`/`new Phaser.Math.RandomDataGenerator()`.
  8. `player.init(ctx)`.
  9. `ctx.experienceSystem = new ExperienceSystem(ctx)`; `ctx.upgradeSystem = new UpgradeSystem(ctx)`; `ctx.weaponSystem = new WeaponSystem(ctx)`; `this.spawner = new EnemySpawner(ctx)`.
  10. `ctx.weaponSystem.addWeapon(character.startingWeaponId)`.
  11. `ctx.recomputeStats()`; `player.hp = player.maxHp = stats.maxHp`.
  12. Overlaps: `physics.add.overlap(player, enemies, onPlayerTouchEnemy)`; `physics.add.overlap(player, pickups, (_p, pk) => (pk as Pickup).collect())`. (WeaponSystem registers projectile↔enemy itself.)
  13. Input: ESC → `openPause()` (only if running & no level-up pending).
  14. `this.scene.launch(SCENES.UI)`. Register `this.events.on(EVENTS.UPGRADE_CHOSEN, (p) => this.onUpgradeChosen(p.option))`.
  15. Emit initial `HP_CHANGED`, `XP_CHANGED`, `KILLS_CHANGED`, `GOLD_CHANGED`, `WEAPONS_CHANGED`, `ITEMS_CHANGED` so the HUD initialises (do this on `this.events.once('ui-listening')` OR just emit on next tick via `this.time.delayedCall(0, ...)`; the UI also calls `getHudSnapshot()` in its create).
- `update(time, delta)`:
  - `run.elapsedMs += delta`. Update bg tilePosition + vignette/dust. Emit `TIMER` ~4×/s.
  - `ctx.weaponSystem.update(time, delta)`; `this.spawner.update(time, delta)`.
  - Player/enemies/projectiles/pickups self-update via their `preUpdate`.
  - If `!player.isAlive && !run.gameOver` → `handleDeath()`.
  - If `run.elapsedMs >= RUN.SURVIVE_MS && !run.gameOver` → `endRun(true)` (victory).
- Level-up flow:
  - `queueLevelUp()`: `this.pendingLevelUps++`; if not currently showing, `showNextLevelUp()`.
  - `showNextLevelUp()`: `const options = ctx.upgradeSystem.rollOptions(RUN.LEVELUP_CHOICES)`; `this.events.emit(EVENTS.LEVEL_UP, { level: run.level, options })`; golden flash; `this.scene.pause()` (pauses GameScene only — UI stays up).
  - `onUpgradeChosen({ option })`: `ctx.upgradeSystem.apply(option)`; `this.pendingLevelUps--`; if `> 0` `showNextLevelUp()` (stay paused) else `this.scene.resume()` + close.
- Pause: `openPause()` → `this.events.emit(EVENTS.PAUSE_TOGGLED, { paused: true })`; `this.scene.pause()`. (UIScene resumes us via `this.scene.resume('Game')`.)
- Death/Victory: `endRun(victory)`: `run.gameOver = true; run.victory = victory`; build `RunSummary` (time/level/kills/gold + `weaponSystem.getOwned()` views + `upgradeSystem.getItemViews()`); persist best time to `localStorage`/registry; `this.scene.stop(SCENES.UI)`; `this.scene.start(SCENES.GAME_OVER, { summary })`. `handleDeath()`: if `stats.revives > 0` → consume one, heal to 50%, brief invuln + nova fx, set `isAlive=true`; else `endRun(false)`.
- `getHudSnapshot()`: returns `{ hp, maxHp, xp, xpToNext, level, kills, gold, elapsedMs, weapons: OwnedWeaponView[], items: OwnedItemView[] }` for UIScene initial draw.

### GameContext helper implementations (on GameScene)

- `getNearestEnemy(x,y,maxDist?)`: scan `enemies.getChildren()` active, min distance.
- `getEnemiesInRadius(x,y,r)`: filter active enemies by distance ≤ r.
- `damageEnemy(enemy, amount, opts)`: roll crit if `opts.crit` undefined (`rng < critChance`), `final = amount * (crit?critMult:1)`; `enemy.takeDamage(final, {x:player.x,y:player.y} or projectile pos, opts.knockback)`; `popText` the number (crit = bigger/gold). Keep refs sane (`enemy` may already be dead — guard).
- `spawnXpGem(x,y,value)`: pool a `Pickup` as `xp`.
- `spawnPickup(x,y,type,value?)`: pool a `Pickup`.
- `addXp` → `experienceSystem.addXp`. `addGold(n)` → `run.gold += round(n*stats.greed)`; emit `GOLD_CHANGED`. `addKill` → `run.kills++`; emit `KILLS_CHANGED`.
- `recomputeStats()` → `recomputeStats(stats, character, run.ownedItems)` (from `systems/stats.ts`); then clamp `player.hp <= maxHp`; emit nothing (callers emit as needed).
- `queueLevelUp()` as above. `shakeCamera(i,d)` → `cameras.main.shake(d ?? 150, i ?? 0.005)`.
- `popText(x,y,text,color?)`: floating `Text` (font Press Start 2P ~10px), depth `DEPTH.POPTEXT`, tween up + fade then destroy (pool if easy). Keep them cheap.

`onPlayerTouchEnemy(playerObj, enemyObj)`: `player.takeDamage((enemy as Enemy).contactDamage)` (i-frames gate spam).

## F. UI — `src/scenes/UIScene.ts` → `export class UIScene` (+ `src/ui/*` helpers)

Runs on top of GameScene (`scene.launch`). It is NEVER paused. Reads the
GameScene's emitter: `const game = this.scene.get(SCENES.GAME); game.events.on(...)`.
On create, call `game.getHudSnapshot()` to draw initial values, then subscribe.

HUD (all `setScrollFactor(0)`, high depth, drawn with generated panels + bitmap text):

- **Top XP bar**: full-width thin bar at the very top (blue `COLORS.XP_BAR` fill over dark track), fills to `xp/xpToNext`. A circular/badge "Lv N" on the left.
- **Timer**: large `mm:ss` centred just below the XP bar (Cinzel or Press Start 2P).
- **HP**: top-left — character portrait (sheet frame) in a framed box + a red HP bar with `cur/max` text.
- **Top-right**: kills (skull icon or "☠ N") and gold (coin) counters.
- **Bottom-left weapon/item tray**: row of small framed icon slots showing owned
  weapons then items, each with level pips/number. Update on `WEAPONS_CHANGED` / `ITEMS_CHANGED`.
- On `PLAYER_HIT`: flash a red full-screen overlay (quick alpha pulse).

### `src/ui/LevelUpOverlay.ts` → `export class LevelUpOverlay`

A reusable container the UIScene shows on `EVENTS.LEVEL_UP`:

- Dim the screen, show a "LEVEL UP!" gothic banner.
- Render one **card per option**: framed panel with rarity-coloured border
  (`option.rarityColor`), the icon (sheet frame or generated texture — handle
  `frame === -1` by using just the texture key), name, `tag` (NEW / Lv N), the
  description, and level pips up to `maxLevel`.
- Selection: mouse hover highlights/scales the card; click selects. Keyboard
  `1/2/3` (and ←/→ + Enter) selects. On select → `game.events.emit(EVENTS.UPGRADE_CHOSEN, { option })`, hide the overlay. Build cards fresh each time.
- Must handle being shown again immediately (chained level-ups / chest).

### `src/ui/PauseOverlay.ts` → `export class PauseOverlay` (or inline in UIScene)

Shown on `EVENTS.PAUSE_TOGGLED {paused:true}`. Dim + "PAUSED" + current build
summary (weapons/items/stats) + buttons: **Resume** (`this.scene.resume(SCENES.GAME)` + hide),
**Quit to Menu** (`this.scene.stop(SCENES.GAME); this.scene.start(SCENES.MENU)`).
ESC also resumes. (UIScene owns the ESC-to-resume since it stays active.)

## G. Menu + Game Over

### `src/scenes/MenuScene.ts` → `export class MenuScene`

- Atmospheric: tiled bg + vignette + drifting dust + a few idle enemy sprites
  wandering for life. Big gothic title "CRYPT OF THE ETERNAL NIGHT" (Cinzel 700),
  subtitle.
- **Character select**: the 3 `CHARACTERS` as framed portraits (sheet frame),
  name, description, `blurb`, starting weapon icon. ←/→ or click to choose;
  selected one is highlighted/scaled. Show their key stat deltas.
- "Press ENTER / Click to Descend" to start → `this.scene.start(SCENES.GAME, { characterId })`.
- Show **best survival time** from `localStorage` (`REGISTRY.BEST_TIME`).
- Controls hint (WASD/Arrows move, auto-attack, ESC pause) + small "Art: Kenney (CC0)" credit.

### `src/scenes/GameOverScene.ts` → `export class GameOverScene`

- `init(data: { summary: RunSummary })`.
- Dark panel. Big "YOU DIED" (defeat, blood red) or "YOU SURVIVED" (victory, gold).
- Stats: time (mm:ss, highlight if new best), level, kills, gold.
- Acquired build: weapon icons + item icons with levels.
- Buttons: **Retry** (`this.scene.start(SCENES.GAME, { characterId: summary.characterId })`),
  **Menu** (`this.scene.start(SCENES.MENU)`). Enter = retry.

---

# Visual polish checklist ("completed game" feel)

- Hit feedback: enemy white flash + knockback + spark; damage numbers (crits pop bigger / gold).
- Death: enemy poof particles; boss death = screen flash + strong shake + slow-mo optional.
- Player hurt: red screen flash + i-frame blink.
- XP gems: subtle sparkle + magnet streak; satisfying collect pop.
- Level-up: time freeze, golden vignette pulse, polished cards with rarity colours.
- HUD: clean framed panels, readable bitmap text, animated bar fills (tween width).
- Camera: smooth follow, gentle shakes, NO jitter (use `roundPixels`).
- Menu/GameOver: consistent gothic styling, hover states on buttons.
- Everything depth-sorted via `DEPTH.*`. Keep 60fps with hundreds of enemies
  (pool aggressively, avoid per-frame allocations, reuse vectors).
