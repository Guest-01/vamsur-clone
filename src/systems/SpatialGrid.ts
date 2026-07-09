import type { EnemySprite } from '../types';

/**
 * SpatialGrid — a uniform spatial hash over the active enemies, rebuilt once per
 * frame by the GameScene. It exists to kill the O(N) full-pool scans that the
 * weapon queries (getEnemiesInRadius / getNearestEnemy) used to do: with a horde
 * of hundreds of enemies those scans were run dozens of times per frame (one per
 * orbit orb, per mine, per burn patch, per aura/whip/spin tick), so the cost was
 * O(enemies × queries) — the dominant CPU sink in the late game.
 *
 * With the grid a radius query only visits the handful of cells the circle
 * overlaps, so the cost drops to O(local density). Distances are still verified
 * exactly, so results are identical to the old linear scans.
 *
 * The grid stores raw references; enemies are pooled, so callers must (and still
 * do) check `active` — a bucket may hold an instance that died earlier this
 * frame. It is rebuilt every frame from the live positions, so a one-frame lag
 * (a just-spawned enemy appears next frame) is irrelevant to gameplay.
 */
export class SpatialGrid {
  private readonly cellSize: number;
  private readonly inv: number;
  /** live buckets this frame, keyed by a collision-free packed cell index */
  private readonly cells = new Map<number, EnemySprite[]>();
  /** buckets handed out this frame (recycled on the next rebuild) */
  private readonly usedCells: EnemySprite[][] = [];
  /** spare bucket arrays kept around so a rebuild allocates nothing */
  private readonly arrayPool: EnemySprite[][] = [];
  /** scratch buffer reused by nearest() so it allocates nothing */
  private readonly nearScratch: EnemySprite[] = [];

  /**
   * Cell index packing: `cx * K + (cy + OFFSET)`. This is a genuine bijection
   * (no hashing, so no collisions and no double-counting) as long as the cell
   * coordinates stay within ±OFFSET. OFFSET = 2^21 cells × cellSize is ~200M px
   * of travel in either axis — far beyond any real session — and cx * K stays
   * well under 2^53, so the result is an exact integer.
   */
  private static readonly K = 0x400000; // 2^22 — column stride
  private static readonly OFFSET = 0x200000; // 2^21 — shift rows non-negative

  constructor(cellSize = 96) {
    this.cellSize = cellSize;
    this.inv = 1 / cellSize;
  }

  /** Recycle last frame's buckets and re-bin every active enemy. O(N). */
  rebuild(children: readonly EnemySprite[]): void {
    const used = this.usedCells;
    const pool = this.arrayPool;
    for (let i = 0; i < used.length; i++) {
      const arr = used[i];
      arr.length = 0;
      pool.push(arr);
    }
    used.length = 0;
    this.cells.clear();

    const inv = this.inv;
    const K = SpatialGrid.K;
    const OFFSET = SpatialGrid.OFFSET;
    for (let i = 0; i < children.length; i++) {
      const e = children[i];
      if (!e.active) continue;
      const cx = Math.floor(e.x * inv);
      const cy = Math.floor(e.y * inv);
      const key = cx * K + (cy + OFFSET);
      let cell = this.cells.get(key);
      if (cell === undefined) {
        cell = pool.pop() ?? [];
        this.cells.set(key, cell);
        used.push(cell);
      }
      cell.push(e);
    }
  }

  /**
   * Fill `out` (cleared first) with every active enemy whose centre is within
   * `radius` of (x,y). Only the cells overlapping the query circle are scanned;
   * each candidate is distance-checked so the result matches an exact scan.
   * Returns `out` for convenience.
   */
  queryRadius(x: number, y: number, radius: number, out: EnemySprite[]): EnemySprite[] {
    out.length = 0;
    if (this.cells.size === 0) return out;

    const inv = this.inv;
    const K = SpatialGrid.K;
    const OFFSET = SpatialGrid.OFFSET;
    const r2 = radius * radius;
    const minCx = Math.floor((x - radius) * inv);
    const maxCx = Math.floor((x + radius) * inv);
    const minCy = Math.floor((y - radius) * inv);
    const maxCy = Math.floor((y + radius) * inv);

    for (let cx = minCx; cx <= maxCx; cx++) {
      const col = cx * K + OFFSET;
      for (let cy = minCy; cy <= maxCy; cy++) {
        const cell = this.cells.get(col + cy);
        if (cell === undefined) continue;
        for (let i = 0; i < cell.length; i++) {
          const e = cell[i];
          if (!e.active) continue;
          const dx = e.x - x;
          const dy = e.y - y;
          if (dx * dx + dy * dy <= r2) out.push(e);
        }
      }
    }
    return out;
  }

  /**
   * Nearest active enemy to (x,y), or null. Grows the search circle outward from
   * one cell until it catches something (or passes `maxDist`). The first circle
   * that contains any enemy is scanned in full, so its closest member is the
   * true nearest — anything nearer would sit inside a smaller circle.
   */
  nearest(x: number, y: number, maxDist?: number): EnemySprite | null {
    if (this.cells.size === 0) return null;
    // Enemies never live beyond the despawn ring, so a few thousand px is an
    // effectively-unbounded default when the caller passes no max.
    const limit = maxDist ?? 4096;
    const scratch = this.nearScratch;

    let radius = this.cellSize;
    for (;;) {
      this.queryRadius(x, y, radius, scratch);
      if (scratch.length > 0) {
        let best: EnemySprite | null = null;
        let bestD2 = Number.POSITIVE_INFINITY;
        for (let i = 0; i < scratch.length; i++) {
          const e = scratch[i];
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
      if (radius >= limit) return null;
      radius = Math.min(radius * 2, limit);
    }
  }
}
