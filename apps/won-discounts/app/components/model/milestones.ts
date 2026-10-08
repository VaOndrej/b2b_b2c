// Milníky (feedback 6 Oct 2026, bod 9) — the form model shared by the screen (live draft) and the server (SEC-1:
// the action parses exactly these fields). One ladder of steps by the value of the cart; a step is an amount per
// market (one column each, model/markets.ts) and ONE reward: free shipping, a free gift, or a discount off the
// whole order. Where each kind is stored is core milestones.ts (nothing new in the config, the checkout function
// is not touched).
//
// A row of the form has a stable key (`uid`): the stored step's id, or "new-…" for a row added on the page. The
// reward's kind is a field of the row, so switching it keeps what was typed; the id the step is stored under
// follows from the kind (stepId). Limits (Free 2 steps in each market, Pro 6) are checked here and again by the
// gate (plan-gate.ts): a step past a market's limit stays stored and visible, it is only not in force there (§14a).

import { CONFIG_LIMITS } from "@won/core/discounts/config";
import { formatMoney, formatPercent } from "@won/core/discounts/describe";
import { MILESTONE_LIMITS, MILESTONE_RULE_PREFIX, MILESTONE_SHIPPING_ID, type MilestoneKind, type MilestoneStep } from "@won/core/discounts/milestones";

import type { Translator } from "../../i18n";
import { minorToInput, parseMoneyInput, type FormDataLike } from "./rule-form";
import type { FieldError, GiftVariantView, MilestoneStepView } from "./types";

export const MILESTONES_ACTION = "/app/rewards";
export const MILESTONES_INTENT = { save: "save" } as const;
export const MILESTONE_KINDS: readonly MilestoneKind[] = ["gift", "shipping", "discount"];

export const MS_FIELD = {
  intent: "intent",
  /** Row keys in the page's order (one value per row). */
  step: "ms.step",
  kind: (uid: string) => `ms.${uid}.kind`,
  /** The cart value the step starts at, per amount column. */
  amount: (uid: string, key: string) => `ms.${uid}.amount.${key}`,
  /** Gift variant GIDs (one value per choice). */
  choice: (uid: string) => `ms.${uid}.choice`,
  fallback: (uid: string) => `ms.${uid}.fallback`,
  /** "percentage" | "fixed". */
  valueKind: (uid: string) => `ms.${uid}.value`,
  percent: (uid: string) => `ms.${uid}.percent`,
  /** The fixed discount, per amount column. */
  off: (uid: string, key: string) => `ms.${uid}.off.${key}`,
  /** countOtherDiscounts: one switch for the whole ladder. */
  other: "ms.other",
} as const;

/** Rows the page holds at most (each market runs its own few of them; the checkout's payload has room for these). */
export const MILESTONE_ROWS_MAX = 12;

/** The rows a shop may hold on its plan: the plan's steps for every market column. */
export function milestoneRowsMax(plan: "free" | "pro", columns: number): number {
  return Math.min(MILESTONE_ROWS_MAX, MILESTONE_LIMITS[plan] * Math.max(1, columns));
}

/** The amount columns a step is offered in: a cart value there and — a fixed discount — the discount's amount too. */
function offeredOf(step: MilestoneStep): Record<string, number> {
  const off = step.kind === "discount" && step.value.kind === "fixed" ? step.value.amount : null;
  return Object.fromEntries(Object.entries(step.threshold).filter(([key, value]) => typeof value === "number" && value > 0 && (!off || typeof off[key] === "number")));
}

function stepsPerColumn(offered: readonly Record<string, number>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const map of offered) for (const key of Object.keys(map)) out.set(key, (out.get(key) ?? 0) + 1);
  return out;
}

const KIND_RANK: Record<MilestoneKind, number> = { shipping: 0, gift: 1, discount: 2 };

/**
 * Per row: the amount columns where the step is past the plan's limit (the same ranking as core
 * milestonesOverLimit: the lowest cart values of each market stay) — from what the form holds now.
 */
export function overLimitColumns(rows: readonly Pick<MilestoneStepView, "id" | "kind" | "value" | "off" | "threshold">[], columns: readonly string[], limit: number): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const key of columns) {
    const ranked = rows
      .map((row, index) => ({ row, index, at: row.threshold[key], fixed: row.kind === "discount" && row.value === "fixed" }))
      .filter((x) => typeof x.at === "number" && (!x.fixed || typeof x.row.off[key] === "number"))
      .sort((a, b) => a.at! - b.at! || KIND_RANK[a.row.kind] - KIND_RANK[b.row.kind] || a.index - b.index);
    for (const x of ranked.slice(limit)) out.set(x.row.id, [...(out.get(x.row.id) ?? []), key]);
  }
  return out;
}

const UID = /^[A-Za-z0-9_-]{1,64}$/;
const VARIANT = /^gid:\/\/shopify\/ProductVariant\/\d{1,20}$/;
const NEW_PREFIX = "new-";

const random = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");

/** The key of a row added on the page. */
export function newStepUid(): string {
  return `${NEW_PREFIX}${random()}`;
}

/**
 * The id a row is stored under: free shipping has one fixed id, a discount step is an order rule with the "ms-"
 * prefix, a gift tier any other id (the cart's gift lines name it, so a stored gift keeps its id). A row that
 * changed its kind gets an id of the new kind derived from its key; `taken` keeps ids apart.
 */
export function stepId(uid: string, kind: MilestoneKind, taken: ReadonlySet<string>): string {
  if (kind === "shipping") return MILESTONE_SHIPPING_ID;
  const tail = uid.startsWith(NEW_PREFIX) ? uid.slice(NEW_PREFIX.length) : uid.startsWith(MILESTONE_RULE_PREFIX) ? uid.slice(MILESTONE_RULE_PREFIX.length) : uid.replace(/^gift-/, "");
  const isRule = uid.startsWith(MILESTONE_RULE_PREFIX);
  let id = kind === "discount" ? (isRule ? uid : `${MILESTONE_RULE_PREFIX}${tail}`) : isRule || uid.startsWith(NEW_PREFIX) || uid === MILESTONE_SHIPPING_ID ? `gift-${tail}` : uid;
  id = id.slice(0, CONFIG_LIMITS.idLength - 3);
  for (let n = 2; taken.has(id); n += 1) id = `${id.replace(/-\d+$/, "")}-${n}`;
  return id;
}

export interface MilestonesFormContext {
  /** The amount columns of the enabled markets (model/markets.ts enabledCurrencies). */
  columns: readonly string[];
  /** The stored ladder (the admin's columns), by step id: kept rows and amounts of switched-off markets come from it. */
  stored: ReadonlyMap<string, MilestoneStep>;
  plan: "free" | "pro";
}

export interface MilestonesFormResult {
  steps: MilestoneStep[];
  countOther: boolean;
  errors: FieldError[];
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

function readAmounts(form: FormDataLike, field: (key: string) => string, columns: readonly string[], errors: FieldError[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of columns) {
    const minor = parseMoneyInput(str(form.get(field(key))), key);
    if (minor === null) continue;
    if (!Number.isFinite(minor) || minor <= 0 || minor > CONFIG_LIMITS.moneyMinorUnits) {
      errors.push({ field: field(key), key: "rewards.error.amount" });
      continue;
    }
    out[key] = minor;
  }
  return out;
}

/** Stored amounts under keys the form does not ask for (a switched-off market): kept (§14a). */
function outside(amounts: Readonly<Record<string, number>> | undefined, columns: readonly string[]): Record<string, number> {
  return Object.fromEntries(Object.entries(amounts ?? {}).filter(([key]) => !columns.includes(key)));
}

/** The page's form → the ladder to store, or the errors (server and live draft alike). */
export function readMilestonesForm(form: FormDataLike, ctx: MilestonesFormContext): MilestonesFormResult {
  const errors: FieldError[] = [];
  const F = MS_FIELD;
  const steps: MilestoneStep[] = [];
  const seen = new Set<string>();
  const taken = new Set<string>();
  // Ids of the rows that keep theirs come first, so a row that changed its kind never takes a stored step's id.
  const uids = form.getAll(F.step).map(str).filter((uid) => UID.test(uid) && !seen.has(uid) && seen.add(uid));
  for (const uid of uids) if (ctx.stored.has(uid)) taken.add(uid);
  const first = ctx.columns[0] ?? "";
  for (const uid of uids) {
    const before = ctx.stored.get(uid);
    const kindRaw = str(form.get(F.kind(uid)));
    const kind: MilestoneKind = kindRaw === "shipping" || kindRaw === "discount" ? kindRaw : "gift";
    // The stored step of this row while its kind is the same: its id, and its amounts for switched-off markets.
    const prev = before && before.kind === kind ? before : undefined;
    const threshold = { ...outside(prev?.threshold, ctx.columns), ...readAmounts(form, (key) => F.amount(uid, key), ctx.columns, errors) };
    if (Object.keys(threshold).length === 0) errors.push({ field: F.amount(uid, first), key: "milestones.error.amount" });
    if (kind === "shipping") {
      if (steps.some((s) => s.kind === "shipping")) errors.push({ field: F.kind(uid), key: "milestones.error.shippingTwice" });
      else steps.push({ kind, id: MILESTONE_SHIPPING_ID, threshold });
      continue;
    }
    const id = prev ? prev.id : stepId(uid, kind, taken);
    taken.add(id);
    if (kind === "gift") {
      const choices = [...new Set(form.getAll(F.choice(uid)).map(str).filter((v) => VARIANT.test(v)))];
      if (choices.length === 0) errors.push({ field: F.choice(uid), key: "rewards.error.giftChoice" });
      if (choices.length > CONFIG_LIMITS.giftChoices) errors.push({ field: F.choice(uid), key: "rewards.error.tooManyChoices", params: { max: CONFIG_LIMITS.giftChoices } });
      const fallback = str(form.get(F.fallback(uid)));
      steps.push({
        kind,
        id,
        threshold,
        choices: choices.slice(0, CONFIG_LIMITS.giftChoices),
        ...(VARIANT.test(fallback) && !choices.includes(fallback) ? { fallbackVariantId: fallback } : {}),
      });
      continue;
    }
    if (str(form.get(F.valueKind(uid))) === "fixed") {
      const beforeOff = prev?.kind === "discount" && prev.value.kind === "fixed" ? prev.value.amount : undefined;
      const amount = { ...outside(beforeOff, ctx.columns), ...readAmounts(form, (key) => F.off(uid, key), ctx.columns, errors) };
      if (Object.keys(amount).length === 0) errors.push({ field: F.off(uid, first), key: "milestones.error.off" });
      // A discount as large as the cart value it starts at would give the order away.
      for (const key of ctx.columns) {
        if (typeof amount[key] === "number" && typeof threshold[key] === "number" && amount[key]! >= threshold[key]!) errors.push({ field: F.off(uid, key), key: "milestones.error.offTooHigh" });
      }
      steps.push({ kind, id, threshold, value: { kind: "fixed", amount } });
    } else {
      const raw = str(form.get(F.percent(uid))).trim();
      const percent = Number(raw.replace(",", "."));
      const valid = raw !== "" && Number.isFinite(percent) && percent >= 1 && percent <= 100;
      if (!valid) errors.push({ field: F.percent(uid), key: "editor.error.percent" });
      steps.push({ kind, id, threshold, value: { kind: "percentage", percent: valid ? Math.round(percent * 100) / 100 : 0 } });
    }
  }
  // Limits hold per market (core milestones.ts): never MORE steps in a market than the plan runs there, unless that
  // market had as many stored already (a downgrade keeps what is stored; the gate decides what is in force).
  const limit = MILESTONE_LIMITS[ctx.plan];
  const storedCount = stepsPerColumn([...ctx.stored.values()].map(offeredOf));
  const count = stepsPerColumn(steps.map(offeredOf));
  if ([...count].some(([key, n]) => n > limit && n > (storedCount.get(key) ?? 0))) {
    errors.push({ field: F.step, key: ctx.plan === "free" ? "milestones.error.limitFree" : "milestones.error.limit", params: { max: limit, pro: MILESTONE_LIMITS.pro } });
  }
  if (steps.length > MILESTONE_ROWS_MAX && steps.length > ctx.stored.size) errors.push({ field: F.step, key: "milestones.error.rows", params: { max: MILESTONE_ROWS_MAX } });
  if (steps.filter((s) => s.kind === "gift").length > CONFIG_LIMITS.giftTiers) {
    errors.push({ field: F.step, key: "milestones.error.tooManyGifts", params: { max: CONFIG_LIMITS.giftTiers } });
  }
  return { steps, countOther: form.get(F.other) === "1", errors };
}

// --- Views --------------------------------------------------------------------------------------------

/** A stored step as the screen edits it (titles from Shopify; an unknown variant keeps its id, titled ""). */
export function milestoneStepView(step: MilestoneStep, titles: ReadonlyMap<string, string>): MilestoneStepView {
  const variant = (id: string): GiftVariantView => ({ id, title: titles.get(id) ?? "" });
  return {
    id: step.id,
    kind: step.kind,
    threshold: { ...step.threshold },
    choices: step.kind === "gift" ? step.choices.map(variant) : [],
    fallback: step.kind === "gift" && step.fallbackVariantId ? variant(step.fallbackVariantId) : null,
    value: step.kind === "discount" ? step.value.kind : "percentage",
    percent: step.kind === "discount" && step.value.kind === "percentage" ? step.value.percent : null,
    off: step.kind === "discount" && step.value.kind === "fixed" ? { ...step.value.amount } : {},
  };
}

/** A new row of a kind, with nothing typed yet (`threshold` may be prefilled: the setup guide's first step). */
export function emptyStepView(kind: MilestoneKind, threshold: Record<string, number> = {}): MilestoneStepView {
  return { id: kind === "shipping" ? MILESTONE_SHIPPING_ID : newStepUid(), kind, threshold, choices: [], fallback: null, value: "percentage", percent: null, off: {} };
}

type RewardLike = Pick<MilestoneStepView, "kind" | "choices" | "value" | "percent" | "off">;

/** "1 500 Kč / 40 €" in the columns' order; "" = no amount. */
export function amountsText(amounts: Readonly<Record<string, number>>, columns: readonly string[], tr: Translator): string {
  return columns
    .filter((key) => typeof amounts[key] === "number")
    .map((key) => formatMoney(amounts[key]!, key, tr.locale))
    .join(" / ");
}

/**
 * What a step gives, as the customer reads it: "Doprava zdarma", "Dárek: Ponožky Won — M" (a choice: "A, B nebo
 * C"), "Sleva 5 %", "Sleva 100 Kč / 4 €". What is not set yet is said ("Dárek není vybraný", "Sleva bez hodnoty").
 * `column` = one market's column: a fixed discount is then worded for that market only.
 */
export function rewardText(step: RewardLike, columns: readonly string[], tr: Translator, column?: string): string {
  if (step.kind === "shipping") return tr.t("milestones.reward.shipping");
  if (step.kind === "gift") {
    const names = step.choices.map((c) => c.title.trim() || tr.t("rewards.gift.unknown"));
    if (names.length === 0) return tr.t("rewards.gift.summaryNoGift");
    return tr.t("milestones.reward.gift", { gift: names.length === 1 ? names[0]! : tr.t("rewards.gift.summaryChoice", { gifts: names.slice(0, -1).join(", "), last: names[names.length - 1]! }) });
  }
  if (step.value === "percentage") return step.percent !== null && step.percent > 0 ? tr.t("milestones.reward.discount", { value: formatPercent(step.percent, tr.locale) }) : tr.t("milestones.reward.discountNone");
  const off = amountsText(step.off, column ? [column] : columns, tr);
  return off ? tr.t("milestones.reward.discount", { value: off }) : tr.t("milestones.reward.discountNone");
}

/** One step in a sentence: "Dárek: Ponožky Won — M od 1 500 Kč / 40 €"; without an amount it says so. */
export function stepSummary(step: RewardLike & { threshold: Readonly<Record<string, number>> }, columns: readonly string[], tr: Translator): string {
  const reward = rewardText(step, columns, tr);
  const from = amountsText(step.threshold, columns, tr);
  return from ? tr.t("milestones.step.from", { reward, amount: from }) : tr.t("milestones.step.noAmount", { reward });
}

/**
 * The amount columns a step is not offered in (MKT-1): no cart value there, or — a fixed discount — no discount
 * amount there. Only once the step has an amount somewhere (an untouched row is not "missing" everywhere).
 */
export function stepMissingColumns(step: Pick<MilestoneStepView, "kind" | "value" | "off" | "threshold">, columns: readonly string[]): string[] {
  if (!columns.some((key) => typeof step.threshold[key] === "number")) return [];
  const fixed = step.kind === "discount" && step.value === "fixed";
  return columns.filter((key) => typeof step.threshold[key] !== "number" || (fixed && typeof step.off[key] !== "number"));
}

// --- The live form: the state lines and the preview say the real values, from what is typed -------------------

/** The editable value of an amount ("" = none). */
export function amountInput(amounts: Record<string, number> | null | undefined, key: string): string {
  const v = amounts?.[key];
  return typeof v === "number" ? minorToInput(v, key) : "";
}

/**
 * Amounts as the form holds them NOW: per amount column the typed amount (`typed(key)`, null = the field was not
 * read yet → the stored one), valid positive amounts only — what a save would take.
 */
export function liveAmounts(typed: (key: string) => string | null, stored: Record<string, number> | null | undefined, columns: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of columns) {
    const raw = typed(key);
    const minor = raw === null ? (stored?.[key] ?? null) : parseMoneyInput(raw, key);
    if (minor !== null && Number.isFinite(minor) && minor > 0 && minor <= CONFIG_LIMITS.moneyMinorUnits) out[key] = minor;
  }
  return out;
}
