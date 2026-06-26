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
import { SPAWN } from '../config/balance';
import { Enemy } from '../entities/Enemy';

export class EnemySpawner implements IEnemySpawner {
  private ctx: GameContext;

  /** index into WAVES of the currently active wave (-1 = none yet). */
  private activeWaveIndex = -1;
  /** ms accumulated toward the next spawn burst. */
  private spawnAccum = 0;

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
      // reset cadence so a new wave fires its first burst promptly.
      this.spawnAccum = 0;
      // one-shot boss/elite on wave activation.
      if (wave && wave.bossId) this.spawnBoss(wave.bossId);
    }

    const wave = WAVES[this.activeWaveIndex];
    if (!wave) return;

    // --- 2. cadence spawning --------------------------------------------
    this.spawnAccum += delta;
    const intervalMs = wave.spawnIntervalSec * 1000;
    if (this.spawnAccum < intervalMs) return;
    this.spawnAccum -= intervalMs;

    const alive = ctx.enemies.countActive(true);
    if (alive >= wave.cap) return;

    // don't overshoot the cap with this burst.
    const room = wave.cap - alive;
    const toSpawn = Math.min(wave.burst, room);
    if (toSpawn <= 0) return;

    const ring = this.ringRadius();
    for (let i = 0; i < toSpawn; i++) {
      const id = wave.enemies[(ctx.rng.between(0, wave.enemies.length - 1)) | 0];
      const def = ENEMIES[id];
      if (!def) continue;
      const angle = ctx.rng.frac() * Math.PI * 2;
      const x = ctx.player.x + Math.cos(angle) * ring;
      const y = ctx.player.y + Math.sin(angle) * ring;
      this.spawnEnemy(def, x, y);
    }
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

  /**
   * Spawn radius: half the on-screen diagonal (accounting for camera zoom)
   * plus RING_PAD, so enemies materialise just out of sight.
   */
  private ringRadius(): number {
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
