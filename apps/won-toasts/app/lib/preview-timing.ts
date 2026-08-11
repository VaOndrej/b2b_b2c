// Pacing for the admin's animated toast preview. Split into a pure function so
// the "preview must never lie about the setting" doctrine is unit-testable: the
// footer label always states the REAL configured duration, while the animation
// dwell is only capped for practical liveliness (a 60s setting must not freeze
// the looping preview).

export interface PreviewTiming {
  /** Real configured duration in seconds — the honest footer label. */
  labelSec: number;
  /**
   * How long a toast dwells on screen in the animation: the real duration up to
   * a practical bound, compressed beyond it. Never below a readable floor.
   */
  dwellMs: number;
  /** Interval between spawns, derived from the dwell so the loop stays lively. */
  spawnEveryMs: number;
}

const DEFAULT_MS = 3500;
const DWELL_FLOOR_MS = 1000;
/** Above this the animation compresses; the label still shows the real value. */
const DWELL_CAP_MS = 12_000;

export function previewTiming(durationMs: number): PreviewTiming {
  const effectiveMs = durationMs || DEFAULT_MS;
  const dwellMs = Math.max(DWELL_FLOOR_MS, Math.min(effectiveMs, DWELL_CAP_MS));
  const labelSec = Math.round(effectiveMs / 100) / 10;
  const spawnEveryMs = Math.max(1100, Math.min(dwellMs, 2600));
  return { labelSec, dwellMs, spawnEveryMs };
}
