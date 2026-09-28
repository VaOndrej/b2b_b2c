// Native discount → Won rule (spec §2 DiscountRule, §4.1 "Přesun"). Pure apart
// from reading the clock for the "starts later" check (injectable).
//
// Mapping:
//   value     percentage 0–1 → percent 0–100; fixed amount → MoneyByCurrency for
//             the SHOP currency only (principle 6: never converted, other market
//             currencies are a warning to fill in); free shipping → freeShipping
//   target    all items → order; products (+ variants) / collections as is;
//             free shipping → shipping
//   minimum   subtotal (shop currency) / quantity
//   schedule  startsAt / endsAt in the shop's zone (./time.ts)
//   codes     every redeem code, up to CONFIG_LIMITS.codesPerRule (rest = loss)
//   limits    usageLimit → what is LEFT of it (Won counts from zero; keeping the
//             full limit would hand out uses Shopify already counted);
//             appliesOncePerCustomer as is (its history resets = loss)
//   combining Won's own settings (A1) apply; every category where the native
//             setting differs becomes a warning
//   subs      Won does not tell subscriptions apart: a one-time-only native gets
//             a warning, a subscription cycle limit is a stated loss
//   origin    { nativeId } links the rule to its backup

import {
  CONFIG_LIMITS,
  type DiscountRule,
  type DiscountRuleValueFixed,
  type EngineSettings,
  type WonDiscountsConfig,
} from "@won/core/discounts/config";

import { decimalToMinor } from "./amounts.ts";
import { classifyNative } from "./classify.ts";
import {
  type CombinationCategory,
  type LossItem,
  lossText,
  notMovableReasonText,
  type WarningItem,
  warningText,
} from "./copy.ts";
import { isShopMidnight, toShopLocalIso } from "./time.ts";
import type { MovePlan, NativeDiscount, NativeLocale, NotMovableReason } from "./types.ts";

type MoneyByCurrency = DiscountRuleValueFixed["amount"];

export class NotMovableError extends Error {
  readonly reason: NotMovableReason;
  constructor(reason: NotMovableReason, message: string) {
    super(message);
    this.name = "NotMovableError";
    this.reason = reason;
  }
}

export interface PlanMoveOptions {
  locale?: NativeLocale;
  /** "Now" for the starts-later check. Default: the current time. */
  now?: Date;
}

export { decimalToMinor } from "./amounts.ts";

/** Shop decimal → MoneyByCurrency; an unreadable amount refuses the move (never an empty amount). */
function money(amount: string, currency: string, locale: NativeLocale): MoneyByCurrency {
  const minor = decimalToMinor(amount, currency);
  if (minor === null) {
    const reason: NotMovableReason = { code: "unsupported_value" };
    throw new NotMovableError(reason, notMovableReasonText(reason, locale));
  }
  return { [currency.toUpperCase()]: minor };
}

/**
 * A config rule id (`[A-Za-z0-9_-]{1,64}`) derived from the native id, unique in
 * `config`. A rule already linked to this native (a resumed move) keeps its id,
 * so the sync updates its node instead of replacing it.
 */
export function ruleIdFor(nativeId: string, config: WonDiscountsConfig): string {
  const linked = config.modules.codes.rules.find((r) => r.origin?.nativeId === nativeId);
  if (linked) return linked.id;
  const numeric = /(\d+)$/.exec(nativeId)?.[1] ?? "0";
  const base = `native-${numeric}`.slice(0, 56);
  const taken = new Set(config.modules.codes.rules.map((r) => r.id));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function categoryOf(target: NonNullable<NativeDiscount["target"]>): CombinationCategory {
  if (target.kind === "order") return "order";
  if (target.kind === "shipping") return "shipping";
  return "product";
}

/** Does a Won rule of category `a` add up with one of category `b`? (A1, engine.combination) */
export function wonCombines(a: CombinationCategory, b: CombinationCategory, engine: EngineSettings): boolean {
  if (a === b) return false; // product vs product / order vs order / shipping: the better one wins
  const pair = [a, b].sort().join("+");
  const c = engine.combination;
  if (pair === "order+product") return c.productWithOrder;
  if (pair === "product+shipping") return c.productWithShipping;
  return c.orderWithShipping; // order+shipping
}

const NATIVE_FLAG: Record<CombinationCategory, keyof NativeDiscount["combinesWith"]> = {
  product: "productDiscounts",
  order: "orderDiscounts",
  shipping: "shippingDiscounts",
};

function dedupeCodes(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of codes) {
    const code = raw.trim().toUpperCase();
    if (!code || code.length > CONFIG_LIMITS.codeLength || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

/**
 * The Won rule for a movable native discount plus the dialog's losses and
 * warnings (in `options.locale`, default Czech). Throws NotMovableError when
 * `native` cannot move (callers classify first; this is the backstop).
 */
export function planMove(native: NativeDiscount, config: WonDiscountsConfig, options: PlanMoveOptions = {}): MovePlan {
  const locale = options.locale ?? "cs";
  const now = options.now ?? new Date();
  const reason = classifyNative(native);
  if (reason || !native.value || !native.target) {
    const why: NotMovableReason = reason ?? { code: "unsupported_value" };
    throw new NotMovableError(why, notMovableReasonText(why, locale));
  }

  const losses: LossItem[] = [];
  const warnings: WarningItem[] = [];
  const shopCurrency = native.shop.currencyCode.toUpperCase();
  const timeZone = native.shop.ianaTimezone;

  const rule: DiscountRule = {
    id: ruleIdFor(native.id, config),
    enabled: true,
    name: native.title.slice(0, 200) || (locale === "en" ? "Shopify discount" : "Sleva ze Shopify"),
    method: native.method,
    value:
      native.value.kind === "percentage"
        ? { kind: "percentage", percent: Math.min(100, Math.max(0, native.value.percent)) }
        : native.value.kind === "fixed"
          ? { kind: "fixed", amount: money(native.value.amount, native.value.currencyCode || shopCurrency, locale) }
          : { kind: "freeShipping" },
    target:
      native.target.kind === "products"
        ? {
            kind: "products",
            productIds: [...new Set(native.target.productIds)],
            variantIds: [...new Set(native.target.variantIds)],
          }
        : native.target.kind === "collections"
          ? { kind: "collections", ids: [...new Set(native.target.ids)] }
          : { kind: native.target.kind },
    origin: { nativeId: native.id },
  };

  // Minimum
  let usesMoney = native.value.kind === "fixed";
  if (native.minimum?.kind === "subtotal") {
    rule.minimum = { subtotal: money(native.minimum.amount, native.minimum.currencyCode || shopCurrency, locale) };
    usesMoney = true;
  } else if (native.minimum?.kind === "quantity") {
    rule.minimum = { quantity: native.minimum.quantity };
  }

  // Schedule, in the shop's zone so the engine's day reading is the shop's day.
  const schedule: NonNullable<DiscountRule["schedule"]> = {};
  if (native.startsAt) schedule.startsAt = toShopLocalIso(native.startsAt, timeZone);
  if (native.endsAt) schedule.endsAt = toShopLocalIso(native.endsAt, timeZone);
  if (schedule.startsAt || schedule.endsAt) rule.schedule = schedule;
  if (native.method === "automatic") {
    const startsLater = native.startsAt && Date.parse(native.startsAt) > now.getTime();
    if (startsLater && !isShopMidnight(native.startsAt, timeZone)) {
      warnings.push({ code: "starts_by_day", at: native.startsAt, timeZone });
    }
    if (native.endsAt && !isShopMidnight(native.endsAt, timeZone)) {
      warnings.push({ code: "ends_by_day", at: native.endsAt, timeZone });
    }
  }

  // Codes and limits (code discounts only; automatic ones have neither).
  if (native.method === "code") {
    const codes = dedupeCodes(native.codes);
    rule.codes = codes.slice(0, CONFIG_LIMITS.codesPerRule);
    if (native.codesCount > CONFIG_LIMITS.codesPerRule) {
      losses.push({ code: "codes_over_limit", count: native.codesCount, limit: CONFIG_LIMITS.codesPerRule });
    }
    const limits: NonNullable<DiscountRule["limits"]> = {};
    if (native.usageLimit !== null) {
      const remaining = Math.max(0, native.usageLimit - native.usageCount);
      limits.usageLimit = remaining;
      if (native.usageCount > 0) {
        warnings.push({ code: "usage_limit_remaining", used: native.usageCount, limit: native.usageLimit, remaining });
      }
    }
    if (native.oncePerCustomer) {
      limits.oncePerCustomer = true;
      losses.push({ code: "once_per_customer" });
    }
    if (limits.usageLimit !== undefined || limits.oncePerCustomer !== undefined) rule.limits = limits;
  }
  losses.unshift({ code: "usage_history", used: native.usageCount });

  // Subscriptions: Won does not tell them apart. Say both ways it differs (never widen quietly).
  if (!native.appliesOnSubscription) warnings.push({ code: "subscriptions_included" });
  else if (native.recurringCycleLimit !== null && native.recurringCycleLimit > 0) {
    losses.push({ code: "subscription_cycles", cycles: native.recurringCycleLimit });
  }

  // Money in other currencies is never invented (principle 6).
  if (usesMoney) {
    const others = [
      ...new Set(
        config.markets
          .filter((m) => m.enabled)
          .map((m) => m.currency.toUpperCase())
          .filter((c) => c !== shopCurrency),
      ),
    ];
    if (config.markets.length === 0) warnings.push({ code: "other_currencies_unknown", shopCurrency });
    else if (others.length > 0) warnings.push({ code: "other_currencies", shopCurrency, missing: others });
  }

  // Combining: Won's settings apply; say where they differ from Shopify's.
  const own = categoryOf(native.target);
  for (const other of ["product", "order", "shipping"] as const) {
    const nativeCombines = native.combinesWith[NATIVE_FLAG[other]];
    const won = wonCombines(own, other, config.engine);
    if (nativeCombines !== won) warnings.push({ code: "combination_differs", category: other, native: nativeCombines, won });
  }

  return {
    rule,
    losses: losses.map((item) => lossText(item, locale)),
    warnings: warnings.map((item) => warningText(item, locale)),
  };
}
