import Phaser from 'phaser';

import {
  SCENES,
  EVENTS,
  type CharacterId,
  type CharacterDef,
  type GameContext,
  type PlayerStats,
  type RunState,
  type RunSummary,
  type PickupType,
  type UpgradeOption,
  type OwnedWeaponView,
  type OwnedItemView,
  type EnemySprite,
} from '../types';
import { TEXTURES } from '../config/assets';
import {
  GAME,
  DEPTH,
  COLORS,
  RUN,
  SPAWN,
  CAMERA_ZOOM,
  xpForLevel,
} from '../config/balance';
import { createBaseStats, recomputeStats } from '../systems/stats';
import { getCharacter } from '../content/characters';
import { MetaState } from '../state/MetaState';

// The integrator imports the concrete entity/system classes and wires them
// together. (Pool-owning systems also import their own pooled entity class —
// EnemySpawner → Enemy, WeaponSystem → Projectile; everything else talks
// through the shared GameContext.)
import { Player } from '../entities/Player';
import { Enemy } from '../entities/Enemy';
import { Pickup } from '../entities/Pickup';
import { EnemySpawner } from '../systems/EnemySpawner';
import { WeaponSystem } from '../systems/WeaponSystem';
import { ExperienceSystem } from '../systems/ExperienceSystem';
import { UpgradeSystem } from '../systems/UpgradeSystem';

/**
 * GameScene — the heart of the run. It builds the world (scrolling background,
 * vignette, ambient dust), creates the player + entity pools, assembles the
 * shared {@link GameContext} that every other module talks through, wires up
 * the systems, and owns the run loop (timer, spawning, weapons, level-up flow,
 * death/victory + scene transitions).
 *
 * It never lets other gameplay modules import each other — they only ever see
 * the GameContext handed to them here.
 */
export class GameScene extends Phaser.Scene {
  // --- run identity -------------------------------------------------------
  private characterId!: CharacterId;
  private character!: CharacterDef;

  // --- world objects ------------------------------------------------------
  // The infinite floor lives here (world space). The vignette + ambient dust
  // are drawn by the UIScene (an un-zoomed overlay) so the world camera zoom
  // can't distort them.
  private bg!: Phaser.GameObjects.TileSprite;

  // --- groups (plain Arcade groups, pooled per the entity pattern) --------
  private enemies!: Phaser.Physics.Arcade.Group;
  private projectiles!: Phaser.Physics.Arcade.Group;
  private pickups!: Phaser.Physics.Arcade.Group;

  // --- entities / systems -------------------------------------------------
  private player!: Player;
  private spawner!: EnemySpawner;

  // --- shared state -------------------------------------------------------
  private stats!: PlayerStats;
  private run!: RunState;
  private ctx!: GameContext;

  // --- level-up queue -----------------------------------------------------
  /** how many level-up choice screens are still owed (chained levels + chest) */
  private pendingLevelUps = 0;
  /** true while a choice screen is on-screen and the scene is paused */
  private showingLevelUp = false;

  // --- pop-text pool ------------------------------------------------------
  private popPool: Phaser.GameObjects.Text[] = [];

  // --- shared one-shot FX emitters (persistent, explode() per event) ------
  private sparkFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private poofFx!: Phaser.GameObjects.Particles.ParticleEmitter;
  private burstFx!: Phaser.GameObjects.Particles.ParticleEmitter;

  // --- HUD timer throttle -------------------------------------------------
  private lastTimerEmit = 0;

  constructor() {
    super(SCENES.GAME);
  }

  init(data: { characterId: CharacterId }): void {
    this.characterId = data?.characterId ?? 'knight';
    // reset transient per-run flags (the scene instance is reused on retry)
    this.pendingLevelUps = 0;
    this.showingLevelUp = false;
    this.lastTimerEmit = 0;
    this.popPool = [];
  }

  create(): void {
    const cam = this.cameras.main;
    // Render the world at 2x zoom. Combined with the 1920x1080 backing store
    // this keeps the original 960x540-equivalent field of view but at full
    // sharpness (no upscaling from a small buffer).
    cam.setZoom(CAMERA_ZOOM);

    // 1) World: infinite floor. A WORLD-SPACE TileSprite sized to the camera's
    //    (zoom-aware) worldView and re-anchored each frame so it reads as an
    //    endless floor and renders correctly under the camera zoom.
    this.bg = this.add
      .tileSprite(0, 0, cam.worldView.width || GAME.WIDTH, cam.worldView.height || GAME.HEIGHT, TEXTURES.BG_TILE)
      .setOrigin(0, 0)
      .setDepth(DEPTH.BG);

    // 2) Character ---------------------------------------------------------
    this.character = getCharacter(this.characterId);

    // 3) Entity pools (plain Arcade groups, no classType) -----------------
    this.enemies = this.physics.add.group({ maxSize: SPAWN.POOL_SIZE });
    this.projectiles = this.physics.add.group({ maxSize: 600 });
    this.pickups = this.physics.add.group({ maxSize: 600 });

    // 3.5) Shared one-shot FX emitters. Hit sparks / death poofs / collect
    //      bursts fire dozens of times per second in a horde, so each effect
    //      keeps ONE persistent emitter and explode()s at a position instead
    //      of allocating + destroying a GameObject per event.
    this.sparkFx = this.add
      .particles(0, 0, TEXTURES.SPARK, {
        lifespan: 220,
        speed: { min: 50, max: 150 },
        scale: { start: 0.7, end: 0 },
        alpha: { start: 1, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      })
      .setDepth(DEPTH.FX);
    this.poofFx = this.add
      .particles(0, 0, TEXTURES.PARTICLE, {
        lifespan: 360,
        speed: { min: 30, max: 120 },
        scale: { start: 0.7, end: 0 },
        alpha: { start: 0.9, end: 0 },
        tint: [COLORS.BLOOD, COLORS.BLOOD_LIGHT, 0x2a1a22],
        blendMode: Phaser.BlendModes.NORMAL,
        emitting: false,
      })
      .setDepth(DEPTH.FX);
    this.burstFx = this.add
      .particles(0, 0, TEXTURES.PARTICLE, {
        lifespan: 300,
        speed: { min: 30, max: 90 },
        scale: { start: 0.45, end: 0 },
        alpha: { start: 0.9, end: 0 },
        blendMode: Phaser.BlendModes.ADD,
        emitting: false,
      })
      .setDepth(DEPTH.FX);

    // 4) Base stats from the chosen character -----------------------------
    this.stats = createBaseStats(this.character);

    // 5) Player + camera follow -------------------------------------------
    this.player = new Player(this, 0, 0, this.character);
    cam.startFollow(this.player, true, 0.12, 0.12);
    // (roundPixels is configured globally in main.ts — no per-camera setup needed)

    // 6) Run state ---------------------------------------------------------
    this.run = {
      characterId: this.characterId,
      elapsedMs: 0,
      level: 1,
      xp: 0,
      xpToNext: xpForLevel(1),
      kills: 0,
      gold: 0,
      ownedItems: new Map(),
      gameOver: false,
      victory: false,
    };

    // 7) GameContext — the single integration object everyone shares.
    //    Systems are assigned in step 9 (cast through `as` because they are
    //    constructed just below; they implement the matching interfaces).
    this.ctx = {
      scene: this,
      player: this.player,
      enemies: this.enemies,
      projectiles: this.projectiles,
      pickups: this.pickups,
      stats: this.stats,
      run: this.run,
      events: this.events,
      rng: new Phaser.Math.RandomDataGenerator(),

      // assigned in step 9 — placeholders satisfy the type until then
      weaponSystem: null as unknown as GameContext['weaponSystem'],
      experienceSystem: null as unknown as GameContext['experienceSystem'],
      upgradeSystem: null as unknown as GameContext['upgradeSystem'],

      getNearestEnemy: (x, y, maxDist) => this.getNearestEnemy(x, y, maxDist),
      getEnemiesInRadius: (x, y, r) => this.getEnemiesInRadius(x, y, r),
      damageEnemy: (enemy, amount, opts) => this.damageEnemy(enemy, amount, opts),
      spawnXpGem: (x, y, value) => this.spawnXpGem(x, y, value),
      spawnPickup: (x, y, type, value) => this.spawnPickup(x, y, type, value),
      addXp: (amount) => this.ctx.experienceSystem.addXp(amount),
      addGold: (amount) => this.addGold(amount),
      addKill: () => this.addKill(),
      recomputeStats: () => this.recomputeStats(),
      queueLevelUp: () => this.queueLevelUp(),
      shakeCamera: (i, d) => this.shakeCamera(i, d),
      popText: (x, y, text, color) => this.popText(x, y, text, color),
      hitSparkAt: (x, y) => this.sparkFx.explode(4, x, y),
      deathPoofAt: (x, y) => this.poofFx.explode(8, x, y),
      collectBurstAt: (x, y, tint, quantity) => {
        this.burstFx.setParticleTint(tint);
        this.burstFx.explode(quantity ?? 6, x, y);
      },
    };

    // 8) Hand the context to the player (binds player.stats === ctx.stats).
    this.player.init(this.ctx);

    // 9) Construct + wire the systems. The spawner is owned by the scene.
    this.ctx.experienceSystem = new ExperienceSystem(this.ctx);
    this.ctx.upgradeSystem = new UpgradeSystem(this.ctx);
    this.ctx.weaponSystem = new WeaponSystem(this.ctx);
    this.spawner = new EnemySpawner(this.ctx);

    // 10) Grant the starting weapon.
    this.ctx.weaponSystem.addWeapon(this.character.startingWeaponId);

    // 11) Finalise stats then sync the player's hp to the computed maxHp.
    this.ctx.recomputeStats();
    this.player.hp = this.player.maxHp = this.stats.maxHp;

    // 12) Overlaps. WeaponSystem registers projectile↔enemy itself.
    this.physics.add.overlap(
      this.player,
      this.enemies,
      this.onPlayerTouchEnemy as Phaser.Types.Physics.Arcade.ArcadePhysicsCallback,
      undefined,
      this
    );
    this.physics.add.overlap(
      this.player,
      this.pickups,
      (_p, pk) => (pk as Pickup).collect(),
      undefined,
      this
    );

    // 13) Input: ESC toggles pause (only while actively playing).
    const escKey = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);
    escKey?.on('down', () => this.openPause());

    // 14) Launch the always-on HUD scene + listen for upgrade choices.
    this.scene.launch(SCENES.UI);
    this.events.on(
      EVENTS.UPGRADE_CHOSEN,
      (p: { option: UpgradeOption }) => this.onUpgradeChosen(p.option),
      this
    );

    // 15) Emit the initial HUD state on the next tick so the just-launched
    //     UIScene has had a chance to subscribe. (UIScene also pulls a
    //     snapshot via getHudSnapshot() in its own create.)
    this.time.delayedCall(0, () => this.emitInitialHud());

    // Clean up cross-scene listeners when this scene shuts down (retry/quit).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);
  }

  /* ------------------------------------------------------------------ */
  /* Main loop                                                          */
  /* ------------------------------------------------------------------ */

  update(time: number, delta: number): void {
    const run = this.run;
    if (run.gameOver) return;

    run.elapsedMs += delta;

    // Infinite floor: keep the world-space tile sprite covering the (zoom-aware)
    // view and anchor its texture to world coords so it reads as an endless floor.
    const cam = this.cameras.main;
    const view = cam.worldView;
    this.bg.setPosition(view.x, view.y);
    this.bg.setSize(view.width, view.height);
    this.bg.tilePositionX = view.x;
    this.bg.tilePositionY = view.y;

    // Emit the run timer ~4x/sec (HUD mm:ss only needs this granularity).
    if (run.elapsedMs - this.lastTimerEmit >= 250) {
      this.lastTimerEmit = run.elapsedMs;
      this.events.emit(EVENTS.TIMER, { elapsedMs: run.elapsedMs });
    }

    // Drive the systems. Entities self-update via their own preUpdate.
    this.ctx.weaponSystem.update(time, delta);
    this.spawner.update(time, delta);

    // Death poll (player.isAlive is flipped inside Player.takeDamage).
    if (!this.player.isAlive) {
      this.handleDeath();
      return;
    }

    // Victory: survived the full run.
    if (run.elapsedMs >= RUN.SURVIVE_MS) {
      this.endRun(true);
    }
  }

  /* ------------------------------------------------------------------ */
  /* GameContext query helpers                                          */
  /* ------------------------------------------------------------------ */

  /** Nearest active enemy to (x,y), or null. Optional max distance cutoff. */
  private getNearestEnemy(x: number, y: number, maxDist?: number): EnemySprite | null {
    const children = this.enemies.getChildren();
    let best: EnemySprite | null = null;
    let bestD2 = maxDist !== undefined ? maxDist * maxDist : Number.POSITIVE_INFINITY;
    for (let i = 0; i < children.length; i++) {
      const e = children[i] as EnemySprite;
      if (!e.active) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  /** All active enemies whose centre is within `radius` of (x,y). */
  private getEnemiesInRadius(x: number, y: number, radius: number): EnemySprite[] {
    const out: EnemySprite[] = [];
    const r2 = radius * radius;
    const children = this.enemies.getChildren();
    for (let i = 0; i < children.length; i++) {
      const e = children[i] as EnemySprite;
      if (!e.active) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      if (dx * dx + dy * dy <= r2) out.push(e);
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* GameContext actions                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Deal damage to an enemy, rolling a crit when the caller hasn't already
   * decided one, then pop a floating damage number (crits read bigger + gold).
   */
  private damageEnemy(
    enemy: EnemySprite,
    amount: number,
    opts?: { knockback?: number; crit?: boolean }
  ): void {
    // Guard: the enemy may have died from an earlier hit this frame.
    if (!enemy || !enemy.active) return;

    const crit = opts?.crit ?? this.ctx.rng.frac() < this.stats.critChance;
    const final = Math.round(amount * (crit ? this.stats.critMult : 1));

    // Knockback originates from the player by default (the most common case;
    // projectiles pass their own position via takeDamage's `from`).
    enemy.takeDamage(final, { x: this.player.x, y: this.player.y }, opts?.knockback);

    // Damage number, lifted slightly above the enemy.
    const color = crit ? COLORS.GOLD_LIGHT : COLORS.BONE;
    const txt = crit ? `${final}!` : `${final}`;
    this.popText(enemy.x, enemy.y - 18, txt, color);
  }

  /** Pool a Pickup as an xp gem of the given value. */
  private spawnXpGem(x: number, y: number, value: number): void {
    this.acquirePickup().spawn(this.ctx, 'xp', x, y, value);
  }

  /** Pool a Pickup of an arbitrary type. */
  private spawnPickup(x: number, y: number, type: PickupType, value?: number): void {
    this.acquirePickup().spawn(this.ctx, type, x, y, value ?? 0);
  }

  /** Get a dead Pickup from the pool, growing it on demand. */
  private acquirePickup(): Pickup {
    let p = this.pickups.getFirstDead(false) as Pickup | null;
    if (!p) {
      p = new Pickup(this);
      this.pickups.add(p, true);
    }
    return p;
  }

  /** gold = round(n * greed); emit the counter change. */
  private addGold(amount: number): void {
    this.run.gold += Math.round(amount * this.stats.greed);
    this.events.emit(EVENTS.GOLD_CHANGED, { gold: this.run.gold });
  }

  /** kill counter + emit. */
  private addKill(): void {
    this.run.kills++;
    this.events.emit(EVENTS.KILLS_CHANGED, { kills: this.run.kills });
  }

  /** Recompute the shared stat block in place, then keep hp sane. */
  private recomputeStats(): void {
    recomputeStats(this.stats, this.character, this.run.ownedItems);
    // Track maxHp growth for the player's clamp/top-up (player owns its hp).
    if (this.player) {
      this.player.maxHp = this.stats.maxHp;
      if (this.player.hp > this.player.maxHp) this.player.hp = this.player.maxHp;
    }
    // Callers emit HP/ITEMS/etc. as appropriate.
  }

  private shakeCamera(intensity?: number, durationMs?: number): void {
    this.cameras.main.shake(durationMs ?? 150, intensity ?? 0.005);
  }

  /* ------------------------------------------------------------------ */
  /* Floating combat text (pooled)                                      */
  /* ------------------------------------------------------------------ */

  private popText(x: number, y: number, text: string, color?: number): void {
    let t = this.popPool.pop();
    if (!t) {
      t = this.add.text(0, 0, '', {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: '10px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
      });
      t.setOrigin(0.5, 0.5).setDepth(DEPTH.POPTEXT);
    }

    const hex = '#' + (color ?? 0xffffff).toString(16).padStart(6, '0');
    t.setText(text)
      .setColor(hex)
      .setPosition(x, y)
      .setActive(true)
      .setVisible(true)
      .setAlpha(1)
      .setScale(1);

    this.tweens.add({
      targets: t,
      y: y - 26,
      alpha: 0,
      scale: 1.15,
      duration: 620,
      ease: 'Quad.easeOut',
      onComplete: () => {
        t!.setActive(false).setVisible(false);
        // recycle for reuse
        if (this.popPool.length < 64) this.popPool.push(t!);
      },
    });
  }

  /* ------------------------------------------------------------------ */
  /* Overlap callbacks                                                  */
  /* ------------------------------------------------------------------ */

  /** Player ↔ enemy contact. Player i-frames gate damage spam internally. */
  private onPlayerTouchEnemy = (
    _playerObj: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Tilemaps.Tile,
    enemyObj: Phaser.Types.Physics.Arcade.GameObjectWithBody | Phaser.Tilemaps.Tile
  ): void => {
    const enemy = enemyObj as unknown as Enemy;
    if (!enemy.active) return;
    this.player.takeDamage(enemy.contactDamage);
  };

  /* ------------------------------------------------------------------ */
  /* Level-up flow                                                      */
  /* ------------------------------------------------------------------ */

  /** Called once per level gained. Queues a choice screen (chains supported). */
  private queueLevelUp(): void {
    this.pendingLevelUps++;
    if (!this.showingLevelUp) this.showNextLevelUp();
  }

  /** Roll options, tell the UI to show them, and freeze gameplay. */
  private showNextLevelUp(): void {
    this.showingLevelUp = true;
    const options = this.ctx.upgradeSystem.rollOptions(RUN.LEVELUP_CHOICES);
    this.events.emit(EVENTS.LEVEL_UP, { level: this.run.level, options });

    // Golden flash for the "time freeze" beat (the overlay also dims the screen
    // and shows its own golden glow).
    this.cameras.main.flash(150, 240, 216, 150, true);

    // Pause only THIS scene; the UI scene stays live to handle the choice.
    this.scene.pause();
  }

  /** UI -> game: a card was chosen. Apply it, then resume or chain. */
  private onUpgradeChosen(option: UpgradeOption): void {
    if (option) this.ctx.upgradeSystem.apply(option);
    this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);

    if (this.pendingLevelUps > 0) {
      // Stay paused and immediately offer the next screen (chained / chest).
      this.showNextLevelUp();
    } else {
      this.showingLevelUp = false;
      this.scene.resume();
    }
  }

  /* ------------------------------------------------------------------ */
  /* Pause                                                              */
  /* ------------------------------------------------------------------ */

  private openPause(): void {
    // Don't open over a level-up screen, after game over, or while paused.
    if (this.run.gameOver || this.showingLevelUp) return;
    if (this.scene.isPaused(SCENES.GAME)) return;

    this.events.emit(EVENTS.PAUSE_TOGGLED, { paused: true });
    this.scene.pause();
    // UIScene owns ESC-to-resume (it stays active) and calls scene.resume.
  }

  /* ------------------------------------------------------------------ */
  /* Death / Victory                                                    */
  /* ------------------------------------------------------------------ */

  /** Player hit 0 hp. Auto-revive if available, otherwise end the run. */
  private handleDeath(): void {
    if (this.run.gameOver) return;

    if (this.stats.revives > 0) {
      this.stats.revives--;
      this.player.isAlive = true;
      this.player.hp = Math.ceil(this.player.maxHp * 0.5);
      this.player.heal(0); // emit HP_CHANGED via the player's own path

      // Revive nova: clear nearby enemies-of-the-screen feel + big juice.
      this.shakeCamera(0.012, 320);
      const nova = this.add
        .image(this.player.x, this.player.y, TEXTURES.RING)
        .setDepth(DEPTH.FX)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(COLORS.GOLD_LIGHT)
        .setScale(0.2)
        .setAlpha(0.9);
      this.tweens.add({
        targets: nova,
        scale: 6,
        alpha: 0,
        duration: 420,
        ease: 'Quad.easeOut',
        onComplete: () => nova.destroy(),
      });

      // Knock back / damage everything close so the revive actually saves you.
      const near = this.getEnemiesInRadius(this.player.x, this.player.y, 220);
      for (let i = 0; i < near.length; i++) {
        this.damageEnemy(near[i], this.stats.maxHp, { knockback: 380 });
      }
      return;
    }

    this.endRun(false);
  }

  /** Finalise the run: build the summary, persist best time, transition. */
  private endRun(victory: boolean): void {
    if (this.run.gameOver) return;
    this.run.gameOver = true;
    this.run.victory = victory;

    const weapons: OwnedWeaponView[] = this.ctx.weaponSystem.getOwned().map((w) => ({
      id: w.id,
      level: w.level,
      maxLevel: w.def.maxLevel,
      icon: w.def.icon,
      name: w.def.name,
    }));
    const items: OwnedItemView[] = this.ctx.upgradeSystem.getItemViews();

    const summary: RunSummary = {
      characterId: this.run.characterId,
      timeMs: this.run.elapsedMs,
      level: this.run.level,
      kills: this.run.kills,
      gold: this.run.gold,
      victory,
      weapons,
      items,
    };

    // Best-time persistence AND "new best" detection are owned by GameOverScene
    // (it must compare against the PRIOR record before overwriting it).

    // Bank this run's gold into the persistent meta wallet (spent in the shop).
    MetaState.addGold(this.run.gold);

    // Tear down the HUD and hand off to the results screen.
    this.scene.stop(SCENES.UI);
    this.scene.start(SCENES.GAME_OVER, { summary });
  }

  /* ------------------------------------------------------------------ */
  /* HUD initial state + snapshot                                       */
  /* ------------------------------------------------------------------ */

  /** Emit one of each HUD event so the freshly-launched UIScene fills in. */
  private emitInitialHud(): void {
    if (this.run.gameOver) return;
    const s = this.getHudSnapshot();
    this.events.emit(EVENTS.HP_CHANGED, { current: s.hp, max: s.maxHp });
    this.events.emit(EVENTS.XP_CHANGED, {
      xp: s.xp,
      xpToNext: s.xpToNext,
      level: s.level,
    });
    this.events.emit(EVENTS.KILLS_CHANGED, { kills: s.kills });
    this.events.emit(EVENTS.GOLD_CHANGED, { gold: s.gold });
    this.events.emit(EVENTS.TIMER, { elapsedMs: s.elapsedMs });
    this.events.emit(EVENTS.WEAPONS_CHANGED, { owned: s.weapons });
    this.events.emit(EVENTS.ITEMS_CHANGED, { owned: s.items });
  }

  /**
   * Snapshot of everything the HUD draws. Called by UIScene during its create
   * so it can paint correct values before the first events arrive.
   */
  getHudSnapshot(): {
    hp: number;
    maxHp: number;
    xp: number;
    xpToNext: number;
    level: number;
    kills: number;
    gold: number;
    elapsedMs: number;
    weapons: OwnedWeaponView[];
    items: OwnedItemView[];
  } {
    const weapons: OwnedWeaponView[] = this.ctx.weaponSystem.getOwned().map((w) => ({
      id: w.id,
      level: w.level,
      maxLevel: w.def.maxLevel,
      icon: w.def.icon,
      name: w.def.name,
    }));
    return {
      hp: this.player.hp,
      maxHp: this.player.maxHp,
      xp: this.run.xp,
      xpToNext: this.run.xpToNext,
      level: this.run.level,
      kills: this.run.kills,
      gold: this.run.gold,
      elapsedMs: this.run.elapsedMs,
      weapons,
      items: this.ctx.upgradeSystem.getItemViews(),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle cleanup                                                  */
  /* ------------------------------------------------------------------ */

  private onShutdown(): void {
    // Drop cross-scene listeners + pooled text so a retry starts clean.
    this.events.off(EVENTS.UPGRADE_CHOSEN);
    this.popPool.length = 0;
  }
}
