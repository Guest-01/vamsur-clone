/**
 * EnemySpawner — drives the wave schedule. Each frame it:
 *   1. Resolves the active wave (latest entry whose `timeSec` has elapsed) and,
 *      on a wave change, spawns that wave's one-shot boss/elite if present.
 *   2. On a fixed cadence (`spawnIntervalSec`), spawns `burst` enemies on a ring
 *      just outside the camera view — as long as the live count is under `cap`.
 *
 * Enemies are pulled from the shared `ctx.enemies` pool using the standard
 * getFirstDead/new pattern (see ARCHITECTURE.md "Entity pooling pattern").
 */
import Phaser from 'phaser';
import type { EnemyDef, GameContext, IEnemySpawner, WaveEntry } from '../types';
import { ENEMIES, WAVES } from '../content/enemies';
import { CHAMPION, SPAWN, championChance, curseMults } from '../config/balance';
import { Enemy } from '../entities/Enemy';
import { Sound } from '../audio/Sound';

export class EnemySpawner implements IEnemySpawner {
  private ctx: GameContext;

  /** index into WAVES of the currently active wave (-1 = none yet). */
  private activeWaveIndex = -1;
  /** ms accumulated toward the next spawn burst. */
  private spawnAccum = 0;
  /** lazily-built champion variants of base defs, keyed by base enemy id. */
  private readonly championDefs = new Map<string, EnemyDef>();

  constructor(ctx: GameContext) {
    this.ctx = ctx;
  }

  update(_time: number, delta: number): void {
    const ctx = this.ctx;
    if (ctx.run.gameOver) return;

    const elapsedMs = ctx.run.elapsedMs;

    // --- 1. resolve the active wave -------------------------------------
    const idx = this.resolveWaveIndex(elapsedMs);
    if (idx !== this.activeWaveIndex) {
      this.activeWaveIndex = idx;
      const wave = WAVES[idx];
      // Pre-fill the cadence accumulator so the new wave (and the very first
      // wave at run start) fires its first burst immediately instead of
      // waiting a full spawn interval.
      this.spawnAccum = wave ? wave.spawnIntervalSec * 1000 : 0;
      // one-shot boss/elite on wave activation.
      if (wave && wave.bossId) this.spawnBoss(wave.bossId);
    }

    const wave = WAVES[this.activeWaveIndex];
    if (!wave) return;

    // --- 2. cadence spawning --------------------------------------------
    // The curse contract raises the concurrent cap; a surge run-event (blood
    // moon) additionally speeds up the cadence and adds a flat cap bonus.
    this.spawnAccum += delta;
    const intervalMs = (wave.spawnIntervalSec * 1000) / (ctx.run.eventSpawnRate || 1);
    if (this.spawnAccum < intervalMs) return;
    this.spawnAccum -= intervalMs;

    const cap = Math.round(wave.cap * curseMults(ctx.run.curse).cap) + ctx.run.eventCapBonus;
    const alive = ctx.enemies.countActive(true);
    if (alive >= cap) return;

    // don't overshoot the cap with this burst.
    const room = cap - alive;
    const toSpawn = Math.min(wave.burst, room);
    if (toSpawn <= 0) return;

    const ring = this.ringRadius();
    const champChance = championChance(elapsedMs);
    for (let i = 0; i < toSpawn; i++) {
      const id = wave.enemies[(ctx.rng.between(0, wave.enemies.length - 1)) | 0];
      let def = ENEMIES[id];
      if (!def) continue;
      // Random champion promotion (3min+): a gold-tinted spike with ×5 hp and
      // a fat gem, so the mid/late horde isn't pure uniform chaff.
      if (champChance > 0 && ctx.rng.frac() < champChance) def = this.championDef(def);
      const angle = ctx.rng.frac() * Math.PI * 2;
      const x = ctx.player.x + Math.cos(angle) * ring;
      const y = ctx.player.y + Math.sin(angle) * ring;
      this.spawnEnemy(def, x, y);
    }
  }

  /** Champion variant of a base def (cached — defs are immutable data). */
  private championDef(base: EnemyDef): EnemyDef {
    let champ = this.championDefs.get(base.id);
    if (!champ) {
      champ = {
        ...base,
        name: `Champion ${base.name}`,
        tint: CHAMPION.TINT,
        baseHp: base.baseHp * CHAMPION.HP_MULT,
        contactDamage: base.contactDamage * CHAMPION.DMG_MULT,
        xp: base.xp * CHAMPION.XP_MULT,
        goldChance: CHAMPION.GOLD_CHANCE,
        scale: base.scale * CHAMPION.SCALE_MULT,
        knockbackResist: Math.min(0.9, base.knockbackResist + CHAMPION.KNOCKBACK_RESIST_BONUS),
        isChampion: true,
      };
      this.championDefs.set(base.id, champ);
    }
    return champ;
  }

  /* ----------------------------------------------------------------------- */
  /* helpers                                                                 */
  /* ----------------------------------------------------------------------- */

  /** Latest wave whose start time has passed; falls back to wave 0. */
  private resolveWaveIndex(elapsedMs: number): number {
    let idx = 0;
    for (let i = 0; i < WAVES.length; i++) {
      if (WAVES[i].timeSec * 1000 <= elapsedMs) idx = i;
      else break;
    }
    return idx;
  }

  /** Spawn one enemy by id at an absolute position (used by run events). */
  spawnAt(id: string, x: number, y: number): void {
    const def = ENEMIES[id];
    if (def) this.spawnEnemy(def, x, y);
  }

  /**
   * Spawn radius: half the on-screen diagonal (accounting for camera zoom)
   * plus RING_PAD, so enemies materialise just out of sight.
   */
  ringRadius(): number {
    const cam = this.ctx.scene.cameras.main;
    const zoom = cam.zoom || 1;
    const halfW = cam.width / zoom / 2;
    const halfH = cam.height / zoom / 2;
    return Math.hypot(halfW, halfH) + SPAWN.RING_PAD;
  }

  /** Spawn a boss/elite just off-screen on a random side of the player. */
  private spawnBoss(bossId: string): void {
    const def = ENEMIES[bossId];
    if (!def) return;
    Sound.play('bossSpawn');
    const ring = this.ringRadius();
    const angle = this.ctx.rng.frac() * Math.PI * 2;
    const x = this.ctx.player.x + Math.cos(angle) * ring;
    const y = this.ctx.player.y + Math.sin(angle) * ring;
    this.spawnEnemy(def, x, y);
  }

  /** Pull (or grow) an Enemy from the pool and spawn it. */
  private spawnEnemy(def: EnemyDef, x: number, y: number): void {
    const group = this.ctx.enemies;
    let e = group.getFirstDead(false) as Enemy | null;
    if (!e) {
      e = new Enemy(this.ctx.scene);
      group.add(e, true);
    }
    e.spawn(this.ctx, def, x, y);
  }
}
