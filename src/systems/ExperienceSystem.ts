/**
 * ExperienceSystem — owns the run's XP curve and level-up triggering.
 *
 * Talks to the rest of the game ONLY through the GameContext: it reads/mutates
 * `ctx.run` and `ctx.stats`, queues level-ups via `ctx.queueLevelUp()`, and
 * announces changes on `ctx.events` (the GameScene's emitter that the HUD
 * listens to).
 */
import Phaser from 'phaser';
import type { GameContext, IExperienceSystem } from '../types';
import { EVENTS } from '../types';
import { curseMults, xpForLevel } from '../config/balance';

export class ExperienceSystem implements IExperienceSystem {
  private ctx: GameContext;

  constructor(ctx: GameContext) {
    this.ctx = ctx;
    // Initialise the threshold for the very first level so the HUD bar reads
    // correctly from the first frame. GameScene also seeds this, but keeping it
    // here makes the system self-consistent if constructed standalone.
    this.ctx.run.xpToNext = this.xpForLevel(this.ctx.run.level);
  }

  /** XP required to advance FROM `level` to `level + 1` — pure balance curve. */
  xpForLevel(level: number): number {
    return xpForLevel(level);
  }

  /**
   * Add raw XP. The `stats.xpGain` multiplier is applied here so callers can
   * pass the gem's face value. Each time the running total crosses the current
   * threshold we consume it, bump the level, recompute the next threshold and
   * queue one level-up screen. Multiple thresholds in a single grant (e.g. a
   * big late-game gem) correctly queue multiple level-ups.
   */
  addXp(amount: number): void {
    const run = this.ctx.run;
    const stats = this.ctx.stats;

    // stat multiplier × timed-event bonus (blood moon) × curse-contract bonus
    run.xp += amount * stats.xpGain * run.eventXpMult * curseMults(run.curse).xp;

    while (run.xp >= run.xpToNext) {
      run.xp -= run.xpToNext;
      run.level += 1;
      run.xpToNext = this.xpForLevel(run.level);
      this.ctx.queueLevelUp();
    }

    this.ctx.events.emit(EVENTS.XP_CHANGED, {
      xp: run.xp,
      xpToNext: run.xpToNext,
      level: run.level,
    });
  }
}

// Touch the Phaser import so the `import Phaser` (mandated style) is never
// flagged as unused by tooling; it carries the type namespace this file relies
// on indirectly via GameContext.
void Phaser;
