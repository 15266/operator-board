/**
 * Looping array coordinates, adapted from RhineLabUI `src/archive-loop.ts`
 * (MIT, Copyright (c) 2026 LBEILC). See LICENSE-RHINE-REFERENCE.txt.
 */
export type ArchiveCell = { lane: number; row: number };

export const LOOP_COLUMNS = 9;
export const LOOP_ROWS = 32;
export const COLUMN_SPACING = 5.2;
export const ROW_SPACING = 0.62;
const POOL_LANES = [0, 1, 2, 3, 4, -2, -1, 5, 6];

export function wrap(value: number, count: number) {
  return ((value % count) + count) % count;
}

export function nearestOccurrence(value: number, center: number, period: number) {
  return value + Math.floor((center - value + period / 2) / period) * period;
}

export function poolCell(index: number): ArchiveCell {
  return {
    lane: POOL_LANES[Math.floor(index / LOOP_ROWS)],
    row: index % LOOP_ROWS,
  };
}

export function cellKey(cell: ArchiveCell) {
  return `${cell.lane}:${cell.row}`;
}

export function sameCell(a: ArchiveCell, b: ArchiveCell) {
  return a.lane === b.lane && a.row === b.row;
}
