// Shopify returns discount dates as UTC instants. The Won engine reads a rule's
// schedule at DAY granularity from the date written in the ISO string itself
// (plan.ts startDate/endDate), so a UTC string would shift a Prague midnight
// start to the previous day. Rule schedules are therefore written in the SHOP'S
// zone with an explicit offset (still a valid zoned ISO date-time for the
// config sanitizer and for the node's startsAt/endsAt).

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(date: Date, timeZone: string): LocalParts | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(date);
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
    const out = {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
      second: get("second"),
    };
    return Object.values(out).every(Number.isFinite) ? out : null;
  } catch {
    return null; // unknown time zone
  }
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, "0");

/**
 * "2026-09-30T22:00:00Z" in Europe/Prague → "2026-10-01T00:00:00+02:00".
 * Returns the input unchanged when it is not a date or the zone is unknown.
 */
export function toShopLocalIso(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const whole = new Date(Math.floor(date.getTime() / 1000) * 1000);
  const p = localParts(whole, timeZone);
  if (!p) return iso;
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMinutes = Math.round((asUtc - whole.getTime()) / 60_000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const offset = `${sign}${pad(Math.floor(Math.abs(offsetMinutes) / 60))}:${pad(Math.abs(offsetMinutes) % 60)}`;
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${offset}`;
}

/** True when the instant is exactly midnight in the shop's zone (unknown zone: false). */
export function isShopMidnight(iso: string, timeZone: string): boolean {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return false;
  const p = localParts(date, timeZone);
  return p !== null && p.hour === 0 && p.minute === 0 && p.second === 0 && date.getUTCMilliseconds() === 0;
}
