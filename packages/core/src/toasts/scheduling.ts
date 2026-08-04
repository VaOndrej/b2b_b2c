// MVP10 — per-rule scheduling. A rule may declare an active window: a date
// range, allowed weekdays, and an hours-of-day window, all evaluated in the
// SHOP's timezone (IANA name from the Admin API). Outside the window the rule is
// inactive. Pure + deterministic: the caller supplies `now` and the timezone.

export interface NotificationSchedule {
  /** ISO 8601 start; before this the rule is inactive. */
  startsAt?: string;
  /** ISO 8601 end; after this the rule is inactive. */
  endsAt?: string;
  /** Allowed weekdays, 0=Sunday..6=Saturday (shop-local). Empty/absent = all. */
  daysOfWeek?: number[];
  /** Hours-of-day window [from, to) in shop-local 24h. from>to wraps midnight. */
  hours?: [number, number];
}

/** Shop-local weekday (0=Sun..6=Sat) and fractional hour for an instant. */
function shopLocalParts(
  ms: number,
  timeZone: string,
): { dow: number; hour: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const DOW: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dow = DOW[get("weekday")] ?? 0;
  // Intl may emit "24" for midnight in hour12:false; normalize to 0.
  let hh = parseInt(get("hour"), 10);
  if (!Number.isFinite(hh) || hh === 24) hh = 0;
  const mm = parseInt(get("minute"), 10) || 0;
  return { dow, hour: hh + mm / 60 };
}

/** Whether a scheduled rule is active at `now` (epoch ms) in the shop timezone. */
export function isScheduledNow(
  schedule: NotificationSchedule | null | undefined,
  now: number,
  shopTimeZone: string,
): boolean {
  if (!schedule) return true;
  const tz = shopTimeZone || "UTC";

  if (schedule.startsAt) {
    const t = Date.parse(schedule.startsAt);
    if (Number.isFinite(t) && now < t) return false;
  }
  if (schedule.endsAt) {
    const t = Date.parse(schedule.endsAt);
    if (Number.isFinite(t) && now > t) return false;
  }

  const needsLocal =
    (schedule.daysOfWeek && schedule.daysOfWeek.length > 0) ||
    (Array.isArray(schedule.hours) && schedule.hours.length === 2);
  if (!needsLocal) return true;

  const { dow, hour } = shopLocalParts(now, tz);

  if (schedule.daysOfWeek && schedule.daysOfWeek.length > 0) {
    if (!schedule.daysOfWeek.includes(dow)) return false;
  }

  if (Array.isArray(schedule.hours) && schedule.hours.length === 2) {
    const [from, to] = schedule.hours;
    if (from === to) {
      // Zero-width window → never (avoids "always" ambiguity).
      return false;
    } else if (from < to) {
      if (!(hour >= from && hour < to)) return false;
    } else {
      // Overnight wrap, e.g. 22–6.
      if (!(hour >= from || hour < to)) return false;
    }
  }

  return true;
}

// ---- sanitation ----

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isoOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return Number.isFinite(Date.parse(value)) ? value : undefined;
}
function clampHour(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(23, Math.max(0, Math.round(n)));
}

/** Validate a schedule; return undefined when nothing usable remains. */
export function sanitizeSchedule(
  input: unknown,
): NotificationSchedule | undefined {
  if (!isPlainObject(input)) return undefined;
  const out: NotificationSchedule = {};

  const startsAt = isoOrUndefined(input.startsAt);
  if (startsAt) out.startsAt = startsAt;
  const endsAt = isoOrUndefined(input.endsAt);
  if (endsAt) out.endsAt = endsAt;

  if (Array.isArray(input.daysOfWeek)) {
    const days = input.daysOfWeek
      .map((d) => Number(d))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
    const unique = Array.from(new Set(days)).sort((a, b) => a - b);
    if (unique.length > 0) out.daysOfWeek = unique;
  }

  if (Array.isArray(input.hours) && input.hours.length === 2) {
    const from = clampHour(input.hours[0]);
    const to = clampHour(input.hours[1]);
    if (from !== undefined && to !== undefined) out.hours = [from, to];
  }

  return Object.keys(out).length > 0 ? out : undefined;
}
