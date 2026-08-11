// MVP13b — rollback timeline support. Turns two saved config snapshots into a
// short list of HUMAN-READABLE changes ("Toast duration 5000ms → 3000ms",
// "Added notification: announcement") so the merchant sees *what changed* between
// two points in time and can roll back one click with confidence — no JSON, no
// fear (doctrine A6 corollary: every change safe and reversible).

export interface ConfigChange {
  /** Dotted path into the config (stable id for the row). */
  path: string;
  /** A short, human summary of the change. */
  summary: string;
  from?: unknown;
  to?: unknown;
}

// Friendly labels for the paths merchants actually recognise.
const LABELS: Record<string, string> = {
  enabled: "Toasts",
  plan: "Plan",
  "global.durationMs": "Toast duration",
  "global.position": "Position",
  "global.maxVisible": "Max visible toasts",
  "global.frequency.quietMode": "Quiet mode",
  "global.frequency.maxPerSession": "Max per session",
  "theme.mode": "Theme mode",
  "theme.colorBg": "Background colour",
  "theme.colorText": "Text colour",
  notifications: "Notifications",
  milestones: "Milestones",
};

function labelFor(path: string): string {
  return LABELS[path] ?? path;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fmt(v: unknown): string {
  if (v === undefined) return "—";
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "string" || typeof v === "number") return String(v);
  return JSON.stringify(v);
}

function itemLabel(item: unknown): string {
  if (isPlainObject(item)) {
    const t = item.type ?? item.kind ?? item.id;
    if (t != null) return String(t);
  }
  return fmt(item);
}

function idOf(item: unknown, index: number): string {
  if (isPlainObject(item) && typeof item.id === "string" && item.id) return item.id;
  return `#${index}`;
}

// Compare two arrays by item id → add / remove / change counts.
function diffArray(path: string, before: unknown[], after: unknown[]): ConfigChange[] {
  const beforeIds = new Map(before.map((it, i) => [idOf(it, i), it]));
  const afterIds = new Map(after.map((it, i) => [idOf(it, i), it]));
  const changes: ConfigChange[] = [];
  const label = labelFor(path);

  const added: string[] = [];
  for (const [id, it] of afterIds) if (!beforeIds.has(id)) added.push(itemLabel(it));
  const removed: string[] = [];
  for (const [id, it] of beforeIds) if (!afterIds.has(id)) removed.push(itemLabel(it));

  if (added.length) {
    changes.push({
      path,
      summary: `Added ${label.toLowerCase()}: ${added.sort().join(", ")}`,
    });
  }
  if (removed.length) {
    changes.push({
      path,
      summary: `Removed ${label.toLowerCase()}: ${removed.sort().join(", ")}`,
    });
  }
  return changes;
}

function walk(path: string, before: unknown, after: unknown, out: ConfigChange[]): void {
  if (before === after) return;

  if (Array.isArray(before) || Array.isArray(after)) {
    out.push(...diffArray(path, Array.isArray(before) ? before : [], Array.isArray(after) ? after : []));
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      walk(path ? `${path}.${key}` : key, before[key], after[key], out);
    }
    return;
  }

  // Scalar (or type mismatch) → a leaf change.
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  const label = labelFor(path);
  out.push({
    path,
    from: before,
    to: after,
    summary: `${label}: ${fmt(before)} → ${fmt(after)}`,
  });
}

/**
 * Human-readable diff between two config snapshots. Deterministic: results are
 * sorted by path so the timeline row order is stable.
 */
export function describeConfigDiff(before: unknown, after: unknown): ConfigChange[] {
  const out: ConfigChange[] = [];
  walk("", before, after, out);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

// ---- gating recommendation (MVP13c decision #9) ----

export type GatingMode = "test_first" | "apply_now";

// Cosmetic paths — safe to apply straight away (colours, copy). Everything else
// that touches timing, position, frequency, rules, targeting or the plan is
// IMPACTFUL and defaults to being tested first (an experiment).
function isCosmeticPath(path: string): boolean {
  if (path.startsWith("messages")) return true; // copy
  if (path.startsWith("theme.")) {
    // theme is cosmetic EXCEPT customCss, which can change behaviour/layout.
    return path !== "theme.customCss";
  }
  return false;
}

/**
 * Recommend how a set of changes should ship: any impactful change → "test_first"
 * (run it as an experiment so nothing ever breaks the store); purely cosmetic →
 * "apply_now". The merchant can always override.
 */
export function recommendGating(changes: ReadonlyArray<ConfigChange>): GatingMode {
  for (const c of changes) {
    if (!isCosmeticPath(c.path)) return "test_first";
  }
  return "apply_now";
}
