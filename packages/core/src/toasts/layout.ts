// MVP14 — collision avoidance. Given fixed obstacles on the same screen edge as
// the toast stack (sticky header, cookie bar, chat launcher), compute an offset
// that clears the tallest one plus a small gap. Pure; the storefront measures
// the real elements and feeds their sizes in.

export type Edge = "top" | "bottom";

export interface Obstacle {
  edge: Edge;
  /** Height (top/bottom) the obstacle occupies, in px. */
  size: number;
}

const GAP = 8;

/**
 * Offset (px) for a toast stack on `edge` so it clears overlapping obstacles.
 * Returns `base` when nothing overlaps.
 */
export function stackOffset(
  base: number,
  obstacles: readonly Obstacle[] | null | undefined,
  edge: Edge = "top",
): number {
  if (!Array.isArray(obstacles) || obstacles.length === 0) return base;
  let tallest = 0;
  for (const o of obstacles) {
    if (!o || o.edge !== edge) continue;
    const size = Number(o.size);
    if (Number.isFinite(size) && size > tallest) tallest = size;
  }
  if (tallest <= 0) return base;
  return Math.max(base, tallest + GAP);
}
