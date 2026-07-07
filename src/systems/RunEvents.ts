/**
 * RunEvents — timed mid-run events that break up the 8-minute rhythm.
 *
 * A fixed schedule (below) fires three kinds of events:
 *   - goldRush:    gold gain ×2 + a drip of bonus coins raining around the player
 *   - bloodMoon:   xp gain ×1.5 while enemies surge (faster cadence, higher cap)
 *   - ghostParade: a one-shot wall of coin-rich wisps marching in from two sides
 *
 * Effects are applied through `ctx.run.event*` fields (read by GameScene /
 * ExperienceSystem / EnemySpawner), and announced to the HUD via
 * EVENTS.RUN_EVENT so the UIScene can show a banner + screen tint. Like every
 * gameplay module it only talks through the GameContext (plus the spawner
 * handed in by the GameScene for the parade spawns).
 */
import Phaser from 'phaser';
import type { GameContext } from '../types';
import { EVENTS } from '../types';
import type { EnemySpawner } from './EnemySpawner';
import { Sound } from '../audio/Sound';

type RunEventId = 'goldRush' | 'bloodMoon' | 'ghostParade';

interface ScheduledEvent {
  id: RunEventId;
  startSec: number;
  durationSec: number; // 0 = instant one-shot
}

const EVENT_INFO: Record<RunEventId, { name: string; desc: string }> = {
  goldRush: { name: '골드 러시', desc: '골드 획득 2배 — 동전이 쏟아진다!' },
  bloodMoon: { name: '핏빛 달', desc: '적이 몰려온다 — 경험치 1.5배!' },
  ghostParade: { name: '유령 행렬', desc: '망령들이 지나간다 — 처치하면 골드를 남긴다!' },
};

/**
 * Fixed schedule, tuned around the wave table (bosses at 2:10 / 3:50 / 5:50 /
 * 6:50): events land in the lulls between one-shot boss spawns.
 */
const SCHEDULE: ScheduledEvent[] = [
  { id: 'goldRush', startSec: 70, durationSec: 25 },
  { id: 'bloodMoon', startSec: 160, durationSec: 30 },
  { id: 'ghostParade', startSec: 260, durationSec: 0 },
  { id: 'bloodMoon', startSec: 375, durationSec: 30 },
  { id: 'goldRush', startSec: 415, durationSec: 25 },
];

/** ms between bonus-coin drops during a gold rush. */
const COIN_DRIP_MS = 650;

export class RunEvents {
  private readonly ctx: GameContext;
  private readonly spawner: EnemySpawner;

  /** schedule entries not yet fired (index advances; SCHEDULE is time-sorted) */
  private nextIndex = 0;
  /** the currently running timed event (schedule is non-overlapping) */
  private active: ScheduledEvent | null = null;
  private activeEndMs = 0;
  /** ms accumulated toward the next gold-rush coin drop */
  private coinAccum = 0;

  constructor(ctx: GameContext, spawner: EnemySpawner) {
    this.ctx = ctx;
    this.spawner = spawner;
  }

  update(delta: number): void {
    const run = this.ctx.run;
    if (run.gameOver) return;

    // end the running event
    if (this.active && run.elapsedMs >= this.activeEndMs) {
      this.deactivate(this.active);
      this.active = null;
    }

    // start the next scheduled event
    while (this.nextIndex < SCHEDULE.length && run.elapsedMs >= SCHEDULE[this.nextIndex].startSec * 1000) {
      const e = SCHEDULE[this.nextIndex++];
      this.activate(e);
    }

    // gold rush: rain bonus coins around the player
    if (this.active?.id === 'goldRush') {
      this.coinAccum += delta;
      while (this.coinAccum >= COIN_DRIP_MS) {
        this.coinAccum -= COIN_DRIP_MS;
        this.dropCoin();
      }
    }
  }

  /* ----------------------------------------------------------------- */
  /* Activation / effects                                              */
  /* ----------------------------------------------------------------- */

  private activate(e: ScheduledEvent): void {
    const run = this.ctx.run;
    switch (e.id) {
      case 'goldRush':
        run.eventGoldMult = 2;
        this.coinAccum = 0;
        break;
      case 'bloodMoon':
        run.eventXpMult = 1.5;
        run.eventSpawnRate = 1.6;
        run.eventCapBonus = 40;
        break;
      case 'ghostParade':
        this.spawnParade();
        break;
    }
    if (e.durationSec > 0) {
      this.active = e;
      this.activeEndMs = run.elapsedMs + e.durationSec * 1000;
    }
    Sound.play('eventStart');
    this.emit(e, true);
  }

  private deactivate(e: ScheduledEvent): void {
    const run = this.ctx.run;
    switch (e.id) {
      case 'goldRush':
        run.eventGoldMult = 1;
        break;
      case 'bloodMoon':
        run.eventXpMult = 1;
        run.eventSpawnRate = 1;
        run.eventCapBonus = 0;
        break;
      case 'ghostParade':
        break;
    }
    this.emit(e, false);
  }

  private emit(e: ScheduledEvent, active: boolean): void {
    const info = EVENT_INFO[e.id];
    this.ctx.events.emit(EVENTS.RUN_EVENT, {
      id: e.id,
      name: info.name,
      desc: info.desc,
      active,
      durationMs: e.durationSec * 1000,
    });
  }

  /* ----------------------------------------------------------------- */
  /* Event bodies                                                      */
  /* ----------------------------------------------------------------- */

  /** One bonus coin at a random spot in a comfortable ring around the player. */
  private dropCoin(): void {
    const p = this.ctx.player;
    const ang = this.ctx.rng.frac() * Math.PI * 2;
    const dist = 90 + this.ctx.rng.frac() * 260;
    this.ctx.spawnPickup(p.x + Math.cos(ang) * dist, p.y + Math.sin(ang) * dist, 'gold');
  }

  /**
   * Two dense lines of wisps marching in from opposite off-screen sides. They
   * chase the player, so the lines read as converging walls of ghosts.
   */
  private spawnParade(): void {
    const p = this.ctx.player;
    const ring = this.spawner.ringRadius() + 40;
    const theta = this.ctx.rng.frac() * Math.PI * 2;
    const perLine = 12;
    const spacing = 55;

    for (const side of [theta, theta + Math.PI]) {
      const cx = p.x + Math.cos(side) * ring;
      const cy = p.y + Math.sin(side) * ring;
      // line runs perpendicular to the approach direction
      const px = -Math.sin(side);
      const py = Math.cos(side);
      for (let i = 0; i < perLine; i++) {
        const off = (i - (perLine - 1) / 2) * spacing;
        this.spawner.spawnAt('wisp', cx + px * off, cy + py * off);
      }
    }
  }
}

// Keep the mandated `import Phaser` referenced (types flow through ctx).
void Phaser;
