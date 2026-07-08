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
  type ScoreBreakdown,
  type PickupType,
  type UpgradeOption,
  type OwnedWeaponView,
  type OwnedItemView,
  type WeaponDamageView,
  type EnemyDef,
  type EnemySprite,
} from '../types';
import { TEXTURES } from '../config/assets';
import {
  GAME,
  DEPTH,
  COLORS,
  PLAYER,
  RUN,
  SCORE,
  SPAWN,
  CAMERA_ZOOM,
  curseMults,
  xpForLevel,
} from '../config/balance';
import { createBaseStats, recomputeStats } from '../systems/stats';
import { getCharacter } from '../content/characters';
import { WEAPONS } from '../content/weapons';
import { MetaState } from '../state/MetaState';
import { Sound } from '../audio/Sound';
import { Music } from '../audio/Music';

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
import { RunEvents } from '../systems/RunEvents';
import { SpatialGrid } from '../systems/SpatialGrid';

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
  /** curse contract level for this run (0 = none; chosen in the menu) */
  private curse = 0;

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
  private runEvents!: RunEvents;

  /**
   * Spatial hash over the active enemies, rebuilt at the top of every update()
   * so the (very hot) weapon radius/nearest queries only scan nearby cells
   * instead of the whole pool. See getEnemiesInRadius / getNearestEnemy.
   */
  private enemyGrid!: SpatialGrid;

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

  // --- camera-shake gate (see shakeCamera) ---------------------------------
  /** scene time when the currently running shake ends */
  private shakeUntil = 0;
  /** intensity of the currently running shake */
  private shakeIntensity = 0;
  /** last time a small rumble fired (rate limit) */
  private lastSmallShakeAt = 0;

  constructor() {
    super(SCENES.GAME);
  }

  init(data: { characterId: CharacterId; curse?: number }): void {
    this.characterId = data?.characterId ?? 'knight';
    this.curse = Math.max(0, data?.curse ?? 0);
    // reset transient per-run flags (the scene instance is reused on retry)
    this.pendingLevelUps = 0;
    this.showingLevelUp = false;
    this.lastTimerEmit = 0;
    this.popPool = [];
    this.shakeUntil = 0;
    this.shakeIntensity = 0;
    this.lastSmallShakeAt = 0;
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

    // 3.1) Spatial hash the weapon queries read from (rebuilt each update).
    //      Fresh per run — the scene instance is reused on retry.
    this.enemyGrid = new SpatialGrid();

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
      killScore: 0,
      victoryAchieved: false,
      revivesUsed: 0,
      ownedItems: new Map(),
      rerollsLeft: 0,
      curse: this.curse,
      eventGoldMult: 1,
      eventXpMult: 1,
      eventSpawnRate: 1,
      eventCapBonus: 0,
      damageByWeapon: new Map(),
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
      addKill: (def) => this.addKill(def),
      recomputeStats: () => this.recomputeStats(),
      queueLevelUp: () => this.queueLevelUp(),
      shakeCamera: (i, d) => this.shakeCamera(i, d),
      popText: (x, y, text, color) => this.popText(x, y, text, color),
      // The FX helpers double as the audio hooks: hitSparkAt fires on every
      // weapon hit and deathPoofAt on every kill, so the (rate-limited) sounds
      // ride along without touching the entities.
      hitSparkAt: (x, y) => {
        this.sparkFx.explode(4, x, y);
        Sound.play('hit');
      },
      deathPoofAt: (x, y) => {
        this.poofFx.explode(8, x, y);
        Sound.play('enemyDie');
      },
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
    this.runEvents = new RunEvents(this.ctx, this.spawner);

    // 10) Grant the starting weapon.
    this.ctx.weaponSystem.addWeapon(this.character.startingWeaponId);

    // 11) Finalise stats then sync the player's hp to the computed maxHp.
    this.ctx.recomputeStats();
    this.player.hp = this.player.maxHp = this.stats.maxHp;

    // 11.5) Run-start meta effects. Reroll charges are a per-run pool seeded
    //       from the Mirror of Fate power-up; Head Start (a one-shot shop
    //       consumable) is consumed here and starts the run at level 2 — the
    //       owed level-up screen is queued in step 15, after the UIScene has
    //       subscribed to LEVEL_UP.
    this.run.rerollsLeft = this.stats.rerolls;
    const headstart = MetaState.consumeConsumable('headstart');
    if (headstart) {
      this.run.level = 2;
      this.run.xpToNext = xpForLevel(this.run.level);
    }

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
    this.events.on(EVENTS.REROLL_REQUESTED, this.onRerollRequested, this);
    this.events.on(
      EVENTS.VICTORY_DECIDED,
      (p: { continueRun: boolean }) => this.onVictoryDecided(p.continueRun),
      this
    );

    // 15) Emit the initial HUD state on the next tick so the just-launched
    //     UIScene has had a chance to subscribe. (UIScene also pulls a
    //     snapshot via getHudSnapshot() in its own create.)
    this.time.delayedCall(0, () => {
      this.emitInitialHud();
      if (headstart) this.queueLevelUp();
    });

    // Clean up cross-scene listeners when this scene shuts down (retry/quit).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.onShutdown, this);

    // 16) Battle music for the run (procedural loop; stopped in endRun).
    Music.play('game');
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

    // Emit the run timer ~4x/sec (HUD mm:ss only needs this granularity); the
    // chest compass shares the same cadence.
    if (run.elapsedMs - this.lastTimerEmit >= 250) {
      this.lastTimerEmit = run.elapsedMs;
      this.events.emit(EVENTS.TIMER, { elapsedMs: run.elapsedMs });
      // score's time term ticks on the same cadence (kills emit immediately)
      this.events.emit(EVENTS.SCORE_CHANGED, { score: this.currentScore() });
      this.emitChestDir();
    }

    // Re-bin the live enemies before the systems run so this frame's weapon
    // queries hit the fresh grid. (New spawns from the spawner below land in
    // next frame's grid — a one-frame lag that gameplay can't perceive.)
    this.enemyGrid.rebuild(this.enemies.getChildren() as EnemySprite[]);

    // Drive the systems. Entities self-update via their own preUpdate.
    this.ctx.weaponSystem.update(time, delta);
    this.spawner.update(time, delta);
    this.runEvents.update(delta);

    // Death poll (player.isAlive is flipped inside Player.takeDamage).
    if (!this.player.isAlive) {
      this.handleDeath();
      return;
    }

    // Victory: survived the full run. The win is locked in immediately; the
    // player then chooses between the results screen and overtime (endless).
    if (run.elapsedMs >= RUN.SURVIVE_MS && !run.victoryAchieved) {
      this.onVictoryReached();
    }
  }

  /**
   * The 8:00 mark was survived. Record the victory NOW (an overtime death must
   * not lose it), land the score bonus, and pause for the overtime choice —
   * same pause pattern as the level-up screen (the UIScene stays live).
   */
  private onVictoryReached(): void {
    this.run.victoryAchieved = true;
    MetaState.recordVictory(this.run.curse);
    Sound.play('victory');
    this.events.emit(EVENTS.SCORE_CHANGED, { score: this.currentScore() });
    this.events.emit(EVENTS.VICTORY_CHOICE, {});
    this.scene.pause();
  }

  /** UI -> game: the overtime decision was made. */
  private onVictoryDecided(continueRun: boolean): void {
    this.scene.resume();
    if (!continueRun) {
      this.endRun(true);
      return;
    }
    // Overtime: nothing to flip — the spawner and enemy stats read the ramp
    // from overtimeMults(elapsedMs), which is >1 from this moment on.
  }

  /* ------------------------------------------------------------------ */
  /* GameContext query helpers                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Nearest active enemy to (x,y), or null. Optional max distance cutoff.
   * Backed by the spatial grid (rebuilt at the top of update()).
   */
  private getNearestEnemy(x: number, y: number, maxDist?: number): EnemySprite | null {
    return this.enemyGrid.nearest(x, y, maxDist);
  }

  /**
   * All active enemies whose centre is within `radius` of (x,y). Backed by the
   * spatial grid — only the cells overlapping the circle are scanned, but every
   * candidate is distance-checked so the result matches an exact scan. Returns a
   * fresh array each call (callers may hold onto it across further queries).
   */
  private getEnemiesInRadius(x: number, y: number, radius: number): EnemySprite[] {
    return this.enemyGrid.queryRadius(x, y, radius, []);
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
    opts?: { knockback?: number; crit?: boolean; sourceId?: string }
  ): void {
    // Guard: the enemy may have died from an earlier hit this frame.
    if (!enemy || !enemy.active) return;

    const crit = opts?.crit ?? this.ctx.rng.frac() < this.stats.critChance;
    const final = Math.round(amount * (crit ? this.stats.critMult : 1));

    // Per-weapon damage attribution for the end-of-run stats.
    if (opts?.sourceId) {
      const tally = this.run.damageByWeapon;
      tally.set(opts.sourceId, (tally.get(opts.sourceId) ?? 0) + final);
    }

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

  /** gold = round(n × greed × gold-rush × curse bonus); emit the change. */
  private addGold(amount: number): void {
    const mult = this.stats.greed * this.run.eventGoldMult * curseMults(this.run.curse).gold;
    this.run.gold += Math.round(amount * mult);
    this.events.emit(EVENTS.GOLD_CHANGED, { gold: this.run.gold });
  }

  /** kill counter + per-enemy score + emits. */
  private addKill(def: EnemyDef): void {
    this.run.kills++;
    this.run.killScore += def.score;
    this.events.emit(EVENTS.KILLS_CHANGED, { kills: this.run.kills });
    this.events.emit(EVENTS.SCORE_CHANGED, { score: this.currentScore() });
  }

  /**
   * The pre-multiplier score terms + the curse multiplier (see balance.SCORE).
   * The single source of truth for both the live score and the results-screen
   * breakdown, so the two can never drift. Each term is rounded to an int so the
   * displayed terms sum exactly to the pre-curse base.
   */
  private scoreTerms(): ScoreBreakdown {
    const r = this.run;
    return {
      timePts: Math.round((r.elapsedMs / 1000) * SCORE.TIME_PER_SEC),
      killPts: Math.round(r.killScore * SCORE.KILL_WEIGHT),
      levelPts: (r.level - 1) * SCORE.LEVEL_PTS,
      victoryPts: r.victoryAchieved ? SCORE.VICTORY_BONUS : 0,
      curseMult: 1 + SCORE.CURSE_BONUS * r.curse,
    };
  }

  /**
   * The live run score. Kills are the main term; time/level tick along via the
   * throttled timer emit, and the victory bonus lands the moment the 8:00 mark
   * is survived.
   */
  private currentScore(): number {
    const t = this.scoreTerms();
    const base = t.timePts + t.killPts + t.levelPts + t.victoryPts;
    return Math.round(base * t.curseMult);
  }

  /** Recompute the shared stat block in place, then keep hp sane. */
  private recomputeStats(): void {
    recomputeStats(this.stats, this.character, this.run.ownedItems);
    // Revives are the one CONSUMABLE stat: the rebuild above re-grants them
    // from the definitions, so spent charges must be subtracted again or every
    // level-up would refund the used revives.
    this.stats.revives = Math.max(0, this.stats.revives - this.run.revivesUsed);
    // Track maxHp growth for the player's clamp/top-up (player owns its hp).
    if (this.player) {
      this.player.maxHp = this.stats.maxHp;
      if (this.player.hp > this.player.maxHp) this.player.hp = this.player.maxHp;
    }
    // Callers emit HP/ITEMS/etc. as appropriate.
  }

  /**
   * Central shake gate. Two rules keep the horde chaos readable:
   *  - a request weaker than (or equal to) the shake still running is dropped,
   *    so chained small hits can't extend the rumble forever;
   *  - small rumbles (≤ SMALL_SHAKE) also rate-limit themselves, so mine pops
   *    + player hits can't merge into a continuous jitter.
   * A stronger request always wins and force-restarts the effect.
   */
  private shakeCamera(intensity?: number, durationMs?: number): void {
    const SMALL_SHAKE = 0.005;
    const SMALL_MIN_GAP_MS = 250;
    const i = intensity ?? 0.005;
    const d = durationMs ?? 150;
    const now = this.time.now;

    if (now < this.shakeUntil && i <= this.shakeIntensity) return;
    if (i <= SMALL_SHAKE) {
      if (now - this.lastSmallShakeAt < SMALL_MIN_GAP_MS) return;
      this.lastSmallShakeAt = now;
    }

    this.shakeUntil = now + d;
    this.shakeIntensity = i;
    this.cameras.main.shake(d, i, true); // force: a stronger shake takes over
  }

  /**
   * Chest compass: find the nearest active chest and, when it is OFF screen,
   * tell the HUD which way to point. Runs on the throttled timer cadence.
   */
  private emitChestDir(): void {
    let best: Pickup | null = null;
    let bestD2 = Number.POSITIVE_INFINITY;
    const children = this.pickups.getChildren();
    for (let i = 0; i < children.length; i++) {
      const pk = children[i] as Pickup;
      if (!pk.active || pk.pickupType !== 'chest') continue;
      const dx = pk.x - this.player.x;
      const dy = pk.y - this.player.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = pk;
      }
    }

    if (!best || this.cameras.main.worldView.contains(best.x, best.y)) {
      this.events.emit(EVENTS.CHEST_DIR, { active: false, angle: 0 });
      return;
    }
    const angle = Math.atan2(best.y - this.player.y, best.x - this.player.x);
    this.events.emit(EVENTS.CHEST_DIR, { active: true, angle });
  }

  /* ------------------------------------------------------------------ */
  /* Floating combat text (pooled)                                      */
  /* ------------------------------------------------------------------ */

  private popText(x: number, y: number, text: string, color?: number): void {
    let t = this.popPool.pop();
    if (!t) {
      t = this.add.text(0, 0, '', {
        fontFamily: '"Press Start 2P", Galmuri11, monospace',
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
    this.events.emit(EVENTS.LEVEL_UP, {
      level: this.run.level,
      options,
      rerollsLeft: this.run.rerollsLeft,
    });

    // Golden flash for the "time freeze" beat (the overlay also dims the screen
    // and shows its own golden glow).
    this.cameras.main.flash(150, 240, 216, 150, true);
    Sound.play('levelup');

    // Pause only THIS scene; the UI scene stays live to handle the choice.
    this.scene.pause();
  }

  /**
   * UI -> game: spend a reroll charge. Re-rolls the current screen's options
   * and re-emits LEVEL_UP (the overlay rebuilds its cards synchronously).
   */
  private onRerollRequested(): void {
    if (!this.showingLevelUp || this.run.rerollsLeft <= 0) return;
    this.run.rerollsLeft--;
    const options = this.ctx.upgradeSystem.rollOptions(RUN.LEVELUP_CHOICES);
    this.events.emit(EVENTS.LEVEL_UP, {
      level: this.run.level,
      options,
      rerollsLeft: this.run.rerollsLeft,
    });
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

    Sound.play('uiClick');
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
      this.run.revivesUsed++; // keeps recomputeStats from refunding the charge
      this.player.isAlive = true;
      this.player.hp = Math.ceil(this.player.maxHp * 0.5);
      this.player.heal(0); // emit HP_CHANGED via the player's own path
      // A real second chance: the leftover i-frames from the killing hit
      // (~0.5s) are not enough to escape the pile the player died in.
      this.player.grantInvuln(PLAYER.REVIVE_IFRAME_MS);

      // Revive nova: clear nearby enemies-of-the-screen feel + big juice.
      Sound.play('revive');
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
      const near = this.getEnemiesInRadius(
        this.player.x,
        this.player.y,
        PLAYER.REVIVE_NOVA_RADIUS
      );
      for (let i = 0; i < near.length; i++) {
        this.damageEnemy(near[i], this.stats.maxHp, { knockback: 520 });
      }

      // Freeze beat: pause the world (same pattern as the level-up screen —
      // the scene clock stops, so the revive i-frames don't tick down either)
      // and let the always-live UIScene play the beat + resume after
      // PLAYER.REVIVE_FREEZE_MS. Without this the revive flashes by too fast
      // to register in a horde.
      this.events.emit(EVENTS.REVIVED, { revivesLeft: this.stats.revives });
      this.scene.pause();
      return;
    }

    // Dying in overtime still counts as the victory it already was.
    this.endRun(this.run.victoryAchieved);
  }

  /** Finalise the run: build the summary, persist best time, transition. */
  private endRun(victory: boolean): void {
    if (this.run.gameOver) return;
    this.run.gameOver = true;
    this.run.victory = victory;

    // Silence the battle loop, then the outcome sting (both survive the scene
    // transition — they live on the AudioContext, not the scene). The victory
    // sting already played at the 8:00 mark (onVictoryReached) — don't repeat.
    Music.stop();
    if (!victory) Sound.play('defeat');

    const weapons: OwnedWeaponView[] = this.ctx.weaponSystem.getOwned().map((w) => ({
      id: w.id,
      level: w.level,
      maxLevel: w.def.maxLevel,
      icon: w.def.icon,
      name: w.def.name,
    }));
    const items: OwnedItemView[] = this.ctx.upgradeSystem.getItemViews();

    // Per-weapon damage chart data, largest first.
    const weaponDamage: WeaponDamageView[] = [];
    this.run.damageByWeapon.forEach((total, id) => {
      const def = WEAPONS[id];
      if (def) weaponDamage.push({ id, name: def.name, icon: def.icon, total: Math.round(total) });
    });
    weaponDamage.sort((a, b) => b.total - a.total);

    const summary: RunSummary = {
      characterId: this.run.characterId,
      timeMs: this.run.elapsedMs,
      level: this.run.level,
      kills: this.run.kills,
      gold: this.run.gold,
      victory,
      curse: this.run.curse,
      score: this.currentScore(),
      scoreBreakdown: this.scoreTerms(),
      weapons,
      items,
      weaponDamage,
    };

    // (The curse-contract unlock was already recorded in onVictoryReached —
    // it must survive an overtime death, so it can't wait until here.)

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
    this.events.emit(EVENTS.SCORE_CHANGED, { score: s.score });
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
    score: number;
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
      score: this.currentScore(),
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
    this.events.off(EVENTS.REROLL_REQUESTED);
    this.events.off(EVENTS.VICTORY_DECIDED);
    this.popPool.length = 0;
  }
}
