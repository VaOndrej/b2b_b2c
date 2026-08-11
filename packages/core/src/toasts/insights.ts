// MVP13a — instrumentation core. The rich toast lifecycle "atoms" the storefront
// emits, the dimensions each carries, a PII-scrub gate (doctrine A6 corollary +
// EU privacy: nothing but a whitelisted, typed shape ever reaches analytics),
// and a DETERMINISTIC daily rollup (dashboard reads the rollup, never raw rows).
//
// Doctrine A6 — "simple surface, sophisticated engine": the sophistication of the
// whole insights stack lives here (pure, unit-tested); the merchant UI stays a
// few honest cards. NO false attribution happens at this layer — we only count
// what was shown, seen, read, clicked, dismissed, or silently suppressed.

// ---- Atoms ---------------------------------------------------------------

/** One toast's measurable lifecycle. `suppressed` = wanted to show but a
 *  cooldown/cap/quiet/exclusion blocked it — a silent block is as valuable a
 *  signal as a shown toast, so it is a first-class atom (with a reason). */
export type ToastAtom =
  | "shown"
  | "visible"
  | "read_through"
  | "hover"
  | "click"
  | "dismiss"
  | "auto_fade"
  | "suppressed"
  // MVP13c guardrail telemetry — one `session` per shopper session, and a
  // `js_error` whenever the storefront engine throws. These feed the live
  // conversion / error-rate guardrails, not per-toast metrics.
  | "session"
  | "js_error";

export const TOAST_ATOMS: readonly ToastAtom[] = [
  "shown",
  "visible",
  "read_through",
  "hover",
  "click",
  "dismiss",
  "auto_fade",
  "suppressed",
  "session",
  "js_error",
];

export type ClickTarget = "cta" | "body";
export const CLICK_TARGETS: readonly ClickTarget[] = ["cta", "body"];

/** Why a toast that wanted to appear was blocked. */
export type SuppressReason = "cooldown" | "cap" | "quiet" | "exclusion" | "dedupe";
export const SUPPRESS_REASONS: readonly SuppressReason[] = [
  "cooldown",
  "cap",
  "quiet",
  "exclusion",
  "dedupe",
];

// ---- Dimensions ----------------------------------------------------------

/** Every analytic dimension. All non-PII, all bounded. The scrub whitelist below
 *  is the ONLY path dimensions take into storage — an unknown key (e.g. a stray
 *  `customerId`) is dropped, not stored. */
export interface ToastDimensions {
  /** Toast type key (cart, countdown, announcement, stock.low, …). */
  type: string;
  semantic?: string;
  surface?: string;
  pageType?: string;
  device?: string;
  /** guest | returning | first-time … — a coarse state, never a customer id. */
  customerState?: string;
  locale?: string;
  currency?: string;
  hourOfDay?: number;
  dayOfWeek?: number;
  lookPreset?: string;
  abVariant?: number;
}

export interface RawToastEvent {
  atom: ToastAtom;
  /** Rule/recipe id this toast came from (bounded; not PII). */
  ruleId?: string;
  dims: ToastDimensions;
  /** How long the toast was on screen (ms) — present on dismiss/auto_fade. */
  dwellMs?: number;
  clickTarget?: ClickTarget;
  suppressReason?: SuppressReason;
}

// String dimensions we accept, and how tightly to bound them.
const STRING_DIMS: readonly (keyof ToastDimensions)[] = [
  "type",
  "semantic",
  "surface",
  "pageType",
  "device",
  "customerState",
  "locale",
  "currency",
  "lookPreset",
];
const MAX_DIM_LEN = 40;

function cleanString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().slice(0, MAX_DIM_LEN);
  return s || undefined;
}

function clampInt(v: unknown, lo: number, hi: number): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/**
 * The single gate every event passes before storage. Returns a fresh object
 * containing ONLY whitelisted, typed fields — any extra key (PII or junk) is
 * dropped. Returns null when the atom is unknown (nothing worth storing).
 */
export function scrubEvent(input: unknown): RawToastEvent | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  const atom = raw.atom;
  if (typeof atom !== "string" || !(TOAST_ATOMS as readonly string[]).includes(atom)) {
    return null;
  }

  const rawDims =
    typeof raw.dims === "object" && raw.dims !== null
      ? (raw.dims as Record<string, unknown>)
      : {};
  const dims: ToastDimensions = { type: cleanString(rawDims.type) ?? "unknown" };
  for (const key of STRING_DIMS) {
    if (key === "type") continue;
    const val = cleanString(rawDims[key]);
    if (val !== undefined) (dims as unknown as Record<string, unknown>)[key] = val;
  }
  const hourOfDay = clampInt(rawDims.hourOfDay, 0, 23);
  if (hourOfDay !== undefined) dims.hourOfDay = hourOfDay;
  const dayOfWeek = clampInt(rawDims.dayOfWeek, 0, 6);
  if (dayOfWeek !== undefined) dims.dayOfWeek = dayOfWeek;
  const abVariant = clampInt(rawDims.abVariant, 0, 25);
  if (abVariant !== undefined) dims.abVariant = abVariant;

  const event: RawToastEvent = { atom: atom as ToastAtom, dims };

  const ruleId = cleanString(raw.ruleId);
  if (ruleId !== undefined) event.ruleId = ruleId.slice(0, 80);

  const dwellMs = Number(raw.dwellMs);
  if (Number.isFinite(dwellMs) && dwellMs >= 0) {
    event.dwellMs = Math.min(3_600_000, Math.round(dwellMs));
  }

  if (
    atom === "click" &&
    typeof raw.clickTarget === "string" &&
    (CLICK_TARGETS as readonly string[]).includes(raw.clickTarget)
  ) {
    event.clickTarget = raw.clickTarget as ClickTarget;
  }

  if (
    atom === "suppressed" &&
    typeof raw.suppressReason === "string" &&
    (SUPPRESS_REASONS as readonly string[]).includes(raw.suppressReason)
  ) {
    event.suppressReason = raw.suppressReason as SuppressReason;
  }

  return event;
}

// ---- Rollup --------------------------------------------------------------

export interface RollupCounters {
  shown: number;
  visible: number;
  readThrough: number;
  hover: number;
  clicks: number;
  ctaClicks: number;
  bodyClicks: number;
  dismiss: number;
  autoFade: number;
  suppressed: number;
  suppressedByReason: Record<string, number>;
  /** Sum of dwellMs over dismiss+auto_fade events; divide by dwellCount for avg. */
  dwellMsTotal: number;
  dwellCount: number;
  /** MVP13c: shopper sessions (one per session) — the conversion denominator. */
  sessions: number;
  /** MVP13c: storefront engine errors — the JS-error guardrail signal. */
  jsErrors: number;
}

export function emptyRollupCounters(): RollupCounters {
  return {
    shown: 0,
    visible: 0,
    readThrough: 0,
    hover: 0,
    clicks: 0,
    ctaClicks: 0,
    bodyClicks: 0,
    dismiss: 0,
    autoFade: 0,
    suppressed: 0,
    suppressedByReason: {},
    dwellMsTotal: 0,
    dwellCount: 0,
    sessions: 0,
    jsErrors: 0,
  };
}

/** The dimensions a rollup row is keyed by (the segmentation axes 13b/13c use). */
export interface RollupDims {
  type: string;
  device: string;
  pageType: string;
  customerState: string;
  abVariant: number;
}

export interface RollupRow {
  date: string;
  dims: RollupDims;
  counters: RollupCounters;
}

export type RollupInput = RawToastEvent & { date: string };

function rollupDims(dims: ToastDimensions): RollupDims {
  return {
    type: dims.type || "unknown",
    device: dims.device || "unknown",
    pageType: dims.pageType || "unknown",
    customerState: dims.customerState || "unknown",
    abVariant: typeof dims.abVariant === "number" ? dims.abVariant : 0,
  };
}

function keyOf(date: string, d: RollupDims): string {
  return [date, d.type, d.device, d.pageType, d.customerState, d.abVariant].join("");
}

function tally(counters: RollupCounters, e: RollupInput): void {
  switch (e.atom) {
    case "shown":
      counters.shown += 1;
      break;
    case "visible":
      counters.visible += 1;
      break;
    case "read_through":
      counters.readThrough += 1;
      break;
    case "hover":
      counters.hover += 1;
      break;
    case "click":
      counters.clicks += 1;
      if (e.clickTarget === "cta") counters.ctaClicks += 1;
      else if (e.clickTarget === "body") counters.bodyClicks += 1;
      break;
    case "dismiss":
      counters.dismiss += 1;
      break;
    case "auto_fade":
      counters.autoFade += 1;
      break;
    case "suppressed":
      counters.suppressed += 1;
      if (e.suppressReason) {
        counters.suppressedByReason[e.suppressReason] =
          (counters.suppressedByReason[e.suppressReason] ?? 0) + 1;
      }
      break;
    case "session":
      counters.sessions += 1;
      break;
    case "js_error":
      counters.jsErrors += 1;
      break;
  }
  if (
    (e.atom === "dismiss" || e.atom === "auto_fade") &&
    typeof e.dwellMs === "number" &&
    e.dwellMs >= 0
  ) {
    counters.dwellMsTotal += e.dwellMs;
    counters.dwellCount += 1;
  }
}

const COUNTER_KEYS: readonly (keyof RollupCounters)[] = [
  "shown",
  "visible",
  "readThrough",
  "hover",
  "clicks",
  "ctaClicks",
  "bodyClicks",
  "dismiss",
  "autoFade",
  "suppressed",
  "dwellMsTotal",
  "dwellCount",
  "sessions",
  "jsErrors",
];

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Sum two counter blobs (existing rollup row + new batch) for the incremental
 * upsert. Tolerates a malformed/partial existing blob — missing numeric fields
 * count as zero, so a legacy or hand-edited row never poisons the merge.
 */
export function mergeCounters(
  a: Partial<RollupCounters>,
  b: Partial<RollupCounters>,
): RollupCounters {
  const out = emptyRollupCounters();
  for (const k of COUNTER_KEYS) {
    (out[k] as number) = num(a?.[k]) + num(b?.[k]);
  }
  const reasons: Record<string, number> = {};
  for (const src of [a?.suppressedByReason, b?.suppressedByReason]) {
    if (src && typeof src === "object") {
      for (const key of Object.keys(src)) reasons[key] = (reasons[key] ?? 0) + num(src[key]);
    }
  }
  out.suppressedByReason = reasons;
  return out;
}

/** Stable UTC date bucket key (YYYY-MM-DD) for a timestamp or Date. */
export function dateKeyUTC(at: number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  return d.toISOString().slice(0, 10);
}

/**
 * Fold raw lifecycle events into one row per (date, type, segment). Pure and
 * DETERMINISTIC — identical input (any order) yields identical output, and rows
 * come back in a stable, sorted order so snapshots and diffs are reproducible.
 */
export function rollupEvents(events: ReadonlyArray<RollupInput>): RollupRow[] {
  const byKey = new Map<string, RollupRow>();
  if (!Array.isArray(events)) return [];
  for (const e of events) {
    if (!e || typeof e.date !== "string" || !e.date) continue;
    const dims = rollupDims(e.dims ?? { type: "unknown" });
    const key = keyOf(e.date, dims);
    let row = byKey.get(key);
    if (!row) {
      row = { date: e.date, dims, counters: emptyRollupCounters() };
      byKey.set(key, row);
    }
    tally(row.counters, e);
  }
  return Array.from(byKey.values()).sort((a, b) =>
    keyOf(a.date, a.dims) < keyOf(b.date, b.dims) ? -1 : 1,
  );
}
