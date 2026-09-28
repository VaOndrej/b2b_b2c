// Shape validators shared by the sanitizer, the function payload and the engine.

import { CONFIG_LIMITS } from "./limits.ts";

const SHOP_LOCAL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/**
 * True for a real calendar date-time in the exact `YYYY-MM-DDTHH:MM:SS` shape of
 * Shopify's `DateTimeWithoutTimezone` (shop-local time, no offset). Campaign
 * windows become the function's `$campaignStart/$campaignEnd` variables, and a
 * value the platform cannot parse fails the whole run (C4), so the shape is
 * checked strictly here rather than trusted.
 */
export function isShopLocalDateTime(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = SHOP_LOCAL_DATETIME_RE.exec(v);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

const ISO_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/;

/**
 * True for an ISO 8601 date-time WITH a zone designator (`Z` or `±HH:MM`), e.g.
 * `2026-11-27T00:00:00Z` or `2026-11-27T00:00:00+01:00` — the shape of Shopify's
 * `DateTime` scalar, which is what a rule's `schedule.startsAt/endsAt` becomes on
 * its discount node. A zone-less value would be read in an unknown zone, so it is
 * refused (campaign windows are the shop-local exception, see isShopLocalDateTime).
 */
export function isIsoDateTime(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = ISO_DATETIME_RE.exec(v);
  if (!m) return false;
  const [year, month, day, hour, minute] = m.slice(1, 6).map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  if (m[7] !== undefined && (Number(m[7]) > 23 || Number(m[8]) > 59)) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth && Number.isFinite(Date.parse(v));
}

const ENTITY_ID_RE = /^[A-Za-z0-9_-]+$/;

/** True for an id the config accepts as-is: 1–64 characters of `[A-Za-z0-9_-]`. */
export function isValidEntityId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= CONFIG_LIMITS.idLength && ENTITY_ID_RE.test(v);
}

/** Native Shopify discount node GID (the backup link of a migrated rule). */
export const NATIVE_DISCOUNT_GID_RE = /^gid:\/\/shopify\/(?:DiscountNode|DiscountCodeNode|DiscountAutomaticNode)\/\d{1,20}$/;
