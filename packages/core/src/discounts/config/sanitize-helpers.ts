// Internal sanitize helpers shared by the per-module sanitizers (not part of
// the public `@won/core/discounts/config` surface).

import { type MoneyByCurrency, sanitizeMoneyByCurrency } from "../money.ts";
import { CONFIG_LIMITS } from "./limits.ts";
import type { ConfigIssue } from "./types.ts";
import { isValidEntityId } from "./validators.ts";

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function listPreview(values: string[], max = 5): string {
  const shown = values.slice(0, max).join(", ");
  return values.length > max ? `${shown} and ${values.length - max} more` : shown;
}

/**
 * The same list as issue params: the values listPreview names under `name`
 * (the first `max`, joined by ", ") and `more` = how many it leaves out (0 when
 * none). No "and N more" wording: a UI words that in its own language.
 */
export function listParams(name: string, values: string[], max = 5): Record<string, string | number> {
  return { [name]: values.slice(0, max).join(", "), more: Math.max(0, values.length - max) };
}

/** Record an issue; `params` = the values `message` names, structured (see ConfigIssue.params). */
export function pushIssue(issues: ConfigIssue[], path: string, code: string, message: string, params?: ConfigIssue["params"]): void {
  issues.push(params ? { path, code, message, params } : { path, code, message });
}

/** Only reports an issue when a value was actually supplied and was wrong — a field
 * left out entirely is not an error, it just takes the default silently. */
export function sanitizeBoolWithIssue(
  v: unknown,
  fallback: boolean,
  path: string,
  issues: ConfigIssue[],
): boolean {
  if (typeof v === "boolean") return v;
  if (v !== undefined) {
    pushIssue(
      issues,
      path,
      "invalid_boolean",
      `Expected a boolean, got ${preview(v)}; using default ${fallback}.`,
      { value: preview(v), fallback: String(fallback) },
    );
  }
  return fallback;
}

export function sanitizeBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export function sanitizeEnum<T extends string>(
  v: unknown,
  allowed: readonly T[],
  fallback: T,
  path: string,
  issues: ConfigIssue[],
): T {
  if (v === undefined) return fallback;
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  pushIssue(
    issues,
    path,
    "invalid_enum",
    `Expected one of ${allowed.join(", ")}; got ${preview(v)}. Using default "${fallback}".`,
    { allowed: allowed.join(", "), value: preview(v), fallback },
  );
  return fallback;
}

/**
 * Clamps to 0-100. Only a finite `number` is accepted (same policy as
 * sanitizeMoneyByCurrency, audit P3-10): a string like "50", a boolean or null is
 * never coerced, it is reported as invalid and the default is used. Reports an
 * issue only for a supplied-but-invalid/out-of-range value.
 */
export function sanitizePercent(
  v: unknown,
  fallback: number,
  path: string,
  issues: ConfigIssue[],
): number {
  if (v === undefined) return fallback;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    pushIssue(
      issues,
      path,
      "invalid_percent",
      `Expected a number between 0 and 100, got ${preview(v)}. Using default ${fallback}.`,
      { min: 0, max: 100, value: preview(v), fallback },
    );
    return fallback;
  }
  const n = v;
  if (n < 0 || n > 100) {
    const clamped = Math.min(100, Math.max(0, n));
    pushIssue(
      issues,
      path,
      "clamped_percent",
      `Percent ${n} is out of range 0-100; clamped to ${clamped}.`,
      { value: n, min: 0, max: 100, to: clamped },
    );
    return clamped;
  }
  return n;
}

/**
 * A text of at most `maxLen` UTF-16 units, cut at a whole code point (a
 * surrogate pair is never split) and without lone surrogates: those are not
 * valid UTF-8, so they must never reach the function payload, which Shopify
 * stores as UTF-8 (audit MVP 1 drift #10). Anything but a string → `fallback`.
 */
export function sanitizeString(v: unknown, fallback: string, maxLen = 200): string {
  if (typeof v !== "string") return fallback;
  const head = v.length > maxLen ? v.slice(0, maxLen + 1) : v;
  if (!SURROGATE_RE.test(head)) return head.slice(0, maxLen);
  let out = "";
  for (let i = 0; i < v.length; i++) {
    const unit = v.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = v.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        if (out.length + 2 > maxLen) break;
        out += v[i] + v[i + 1];
        i++;
      }
      continue; // a lone high surrogate is dropped
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) continue; // a lone low surrogate is dropped
    if (out.length + 1 > maxLen) break;
    out += v[i];
  }
  return out;
}

const SURROGATE_RE = /[\uD800-\uDFFF]/;

/** A raw key echoed into an issue's path or message, bounded so an unbounded
 * input (e.g. a multi-MB patch key) can never blow up the issues payload
 * (audit fix4-1: a 3 MB patch key produced ~6 MB of issues). */
export function truncateKey(key: string, max = 64): string {
  return key.length > max ? `${key.slice(0, max)}…` : key;
}

/** A user-supplied value shortened for an issue message (issues must stay small too). */
export function preview(v: unknown, max = 80): string {
  let text: string;
  try {
    text = typeof v === "string" ? JSON.stringify(v.slice(0, max + 1)) : (JSON.stringify(v) ?? String(v));
  } catch {
    text = typeof v; // never throw from an issue message (cyclic/BigInt input)
  }
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * A list of references (Shopify GIDs, segment ids, market handles, rule ids):
 * strings only, each at most CONFIG_LIMITS.referenceLength characters, at most
 * CONFIG_LIMITS.listItems of them. Anything cut is reported (audit P2-1: an
 * uncapped list here let a 3 MB config through a ~500 B function payload).
 */
export function sanitizeStringArray(v: unknown, issues: ConfigIssue[], path: string): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  let tooLong = 0;
  let overLimit = 0;
  for (const item of v) {
    if (typeof item !== "string") continue;
    if (item.length > CONFIG_LIMITS.referenceLength) {
      tooLong++;
      continue;
    }
    if (out.length >= CONFIG_LIMITS.listItems) {
      overLimit++;
      continue;
    }
    out.push(item);
  }
  if (tooLong > 0) {
    pushIssue(
      issues,
      path,
      "reference_too_long",
      `${tooLong} value(s) longer than ${CONFIG_LIMITS.referenceLength} characters were dropped.`,
      { count: tooLong, max: CONFIG_LIMITS.referenceLength },
    );
  }
  if (overLimit > 0) {
    pushIssue(
      issues,
      path,
      "too_many_items",
      `A list can have at most ${CONFIG_LIMITS.listItems} items; ${overLimit} more were dropped.`,
      { max: CONFIG_LIMITS.listItems, count: overLimit },
    );
  }
  return out;
}

/** A single optional reference (e.g. a variant GID): dropped with an issue when too long. */
export function sanitizeReference(v: unknown, issues: ConfigIssue[], path: string): string | undefined {
  if (typeof v !== "string") return undefined;
  if (v.length <= CONFIG_LIMITS.referenceLength) return v;
  pushIssue(
    issues,
    path,
    "reference_too_long",
    `Value longer than ${CONFIG_LIMITS.referenceLength} characters was dropped.`,
    { count: 1, max: CONFIG_LIMITS.referenceLength },
  );
  return undefined;
}

/**
 * MoneyByCurrency with at most CONFIG_LIMITS.currenciesPerAmount currencies
 * (first ones win), each amount at most CONFIG_LIMITS.moneyMinorUnits.
 */
export function sanitizeMoney(v: unknown, issues: ConfigIssue[], path: string): MoneyByCurrency {
  const money = sanitizeMoneyByCurrency(v, { max: CONFIG_LIMITS.moneyMinorUnits });
  const over = Object.keys(money).filter((k) => money[k] === CONFIG_LIMITS.moneyMinorUnits && overCap(v, k));
  if (over.length > 0) {
    pushIssue(
      issues,
      path,
      "clamped_money",
      `An amount can be at most ${CONFIG_LIMITS.moneyMinorUnits} minor units; ${listPreview(over)} was lowered to that.`,
      { max: CONFIG_LIMITS.moneyMinorUnits, ...listParams("currencies", over), count: over.length },
    );
  }
  const keys = Object.keys(money);
  if (keys.length <= CONFIG_LIMITS.currenciesPerAmount) return money;
  pushIssue(
    issues,
    path,
    "too_many_currencies",
    `An amount can have at most ${CONFIG_LIMITS.currenciesPerAmount} currencies; ${keys.length - CONFIG_LIMITS.currenciesPerAmount} more were dropped.`,
    { max: CONFIG_LIMITS.currenciesPerAmount, count: keys.length - CONFIG_LIMITS.currenciesPerAmount },
  );
  return Object.fromEntries(keys.slice(0, CONFIG_LIMITS.currenciesPerAmount).map((k) => [k, money[k]]));
}

/** True when the raw map's value for currency `key` (any key casing) was above the money cap. */
function overCap(raw: unknown, key: string): boolean {
  if (!isRecord(raw)) return false;
  return Object.entries(raw).some(
    ([k, value]) => k.toUpperCase() === key && typeof value === "number" && Math.floor(value) > CONFIG_LIMITS.moneyMinorUnits,
  );
}

/** FNV-1a (32 bit): a tiny, stable string hash — the same input always gives the same id. */
export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export type EntityKind = "rule" | "tier" | "gift" | "campaign";

/**
 * Ids of rules, tier sets, gift tiers and campaigns key the Shopify discount
 * nodes (MVP 1: one node per code rule), metafield payloads and admin URLs, so
 * they must be short and URL/GID-safe: `[A-Za-z0-9_-]{1,64}`.
 *
 * Policy for a non-empty id that breaks that rule: it is REGENERATED
 * deterministically as `<kind>-<fnv1a(original)>` (e.g. `rule-1x9k2ab`) with an
 * `invalid_id` issue, and every reference to the original id (combinesWith,
 * campaign override targets) is remapped to the new one. Regenerating instead
 * of dropping keeps the merchant's rule; determinism keeps readStoredConfig
 * stable (the same stored row always yields the same id) and the sanitizer
 * idempotent (the new id is valid). A missing/empty id carries no identity to
 * derive from, so that entry is still dropped (`missing_id`), as before.
 */
export function sanitizeEntityId(
  v: unknown,
  kind: EntityKind,
  issues: ConfigIssue[],
  path: string,
): { id: string; original?: string } | null {
  if (typeof v !== "string" || v === "") return null;
  if (isValidEntityId(v)) return { id: v };
  const id = `${kind}-${fnv1a(v)}`;
  pushIssue(
    issues,
    `${path}.id`,
    "invalid_id",
    `Id ${preview(v, 40)} is not 1-${CONFIG_LIMITS.idLength} characters of letters, digits, "-" or "_"; it was replaced by "${id}".`,
    { value: preview(v, 40), min: 1, max: CONFIG_LIMITS.idLength, id },
  );
  return { id, original: v };
}

/** Original (invalid) id → regenerated id, per entity kind (see sanitizeEntityId). */
export type IdAliases = Map<string, string>;

export function rememberAlias(aliases: IdAliases, raw: unknown, id: string): void {
  if (typeof raw === "string" && raw !== id && !aliases.has(raw)) aliases.set(raw, id);
}
