// Ochrana marže in the admin (MVP 2): the wording and the small pure helpers the
// margin screen, the Přehled card, the rule editor note and Vyzkoušet košík share.
// The arithmetic and the state line come from the engine (DATA-4, §17a):
//   - the state line is core describeMarginSettings over what the PLAN runs —
//     Free folds collection settings into the global values, strictest wins
//     (core gateConfigForPlan, BILL-1), so the header never states a Pro setting
//     as working where checkout ignores it (§17c);
//   - the §10 proof is core marginFloorUnit, the same floor checkout uses.
// Pure (no React), unit tested in tests/ui/margin.test.ts.

import { DEFAULT_CONFIG, type MarginCollectionOverride, type MarginModule } from "@won/core/discounts/config";
import { describeMarginSettings, formatPercent } from "@won/core/discounts/describe";
import { marginFloorUnit } from "@won/core/discounts/margin";
import { currencyExponent } from "@won/core/discounts/money";
import { gateConfigForPlan } from "@won/core/discounts/plan-gate";

import type { Translator } from "../../i18n";
import type { FormDataLike } from "./rule-form";
import { formatDateTime } from "./signals";
import type { CostMirrorView, MarginImpactRowView, MarginImpactView, MarginSettingsView } from "./types";

/** Form fields the margin action posts (app/lib/integration/margin.server.ts readMarginForm parses them). */
export const MARGIN_FIELD = {
  intent: "intent",
  enabled: "enabled",
  minMarginPercent: "minMarginPercent",
  maxDiscountPercent: "maxDiscountPercent",
  configVersion: "configVersion",
  replaceUnreadable: "replaceUnreadable",
  collectionId: "collectionId[]",
  collectionMin: "collectionMin[]",
  collectionMax: "collectionMax[]",
} as const;

/** `intent`: the settings form saves; "Obnovit nákupní ceny" asks for a new read of the costs. */
export const MARGIN_INTENT = { save: "save", refreshCosts: "refreshCosts" } as const;

/** Where the margin forms post (the app.margin.tsx action), also from Přehled. */
export const MARGIN_ACTION = "/app/margin";

/** The Přehled zásahů block, optionally narrowed to one rule (§13c: the rule editor links to its own rows). */
export function marginImpactHref(ruleId?: string | null): string {
  return ruleId ? `${MARGIN_ACTION}?rule=${encodeURIComponent(ruleId)}#impact` : `${MARGIN_ACTION}#impact`;
}

// --- What the plan runs, in one line -------------------------------------------------------

function toModule(settings: MarginSettingsView): MarginModule {
  return {
    enabled: settings.enabled,
    global: {
      maxDiscountPercent: settings.maxDiscountPercent,
      ...(settings.minMarginPercent !== null ? { minMarginPercent: settings.minMarginPercent } : {}),
    },
    perCollection: settings.collections.map((c): MarginCollectionOverride => ({
      collectionId: c.collectionId,
      ...(c.minMarginPercent !== null ? { minMarginPercent: c.minMarginPercent } : {}),
      ...(c.maxDiscountPercent !== null ? { maxDiscountPercent: c.maxDiscountPercent } : {}),
    })),
  };
}

/**
 * The margin settings the shop's plan actually runs: Pro → as stored; Free →
 * collection settings folded into the global values (core gateConfigForPlan,
 * the same gate the sync applies before anything reaches checkout).
 */
export function marginInForce(settings: MarginSettingsView, plan: "free" | "pro"): MarginModule {
  const margin = toModule(settings);
  if (plan === "pro") return margin;
  return gateConfigForPlan({ ...DEFAULT_CONFIG, modules: { ...DEFAULT_CONFIG.modules, margin } }, "free").config.modules.margin;
}

/** The section's state line (§17 slot 2): "Min. marže 20 % · bez nákupní ceny sleva nejvýš 50 %" / "Ochrana marže je vypnutá". */
export function marginSummary(settings: MarginSettingsView, plan: "free" | "pro", tr: Translator): string {
  return describeMarginSettings(marginInForce(settings, plan), tr.locale);
}

// --- The live draft (§2 / §17b) -----------------------------------------------------------

/** A percent field: "" → null; "12,5" / "12.5" → 12.5; junk → NaN (the server refuses it, the summary keeps the stored value). */
export function readPercentField(raw: FormDataEntryValue | null): number | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  return Number(raw.trim().replace(",", "."));
}

/**
 * The settings as typed, for the live state line and the proof only — never
 * what is saved: the server parses and validates the same fields itself
 * (readMarginForm, SEC-1). A value that does not parse keeps `stored`'s.
 */
export function readMarginDraft(form: FormDataLike, stored: MarginSettingsView): MarginSettingsView {
  const pct = (raw: FormDataEntryValue | null, max: number): number | null | undefined => {
    const n = readPercentField(raw);
    if (n === null) return null;
    return Number.isFinite(n) && n >= 0 && n <= max ? n : undefined;
  };
  const min = pct(form.get(MARGIN_FIELD.minMarginPercent), 95);
  const max = pct(form.get(MARGIN_FIELD.maxDiscountPercent), 100);
  const ids = form.getAll(MARGIN_FIELD.collectionId).map(String);
  const mins = form.getAll(MARGIN_FIELD.collectionMin);
  const maxes = form.getAll(MARGIN_FIELD.collectionMax);
  const titles = new Map(stored.collections.map((c) => [c.collectionId, c.title]));
  return {
    enabled: form.get(MARGIN_FIELD.enabled) === "on",
    minMarginPercent: min === undefined ? stored.minMarginPercent : min,
    maxDiscountPercent: max === undefined || max === null ? stored.maxDiscountPercent : max,
    collections: ids.map((collectionId, i) => ({
      collectionId,
      title: titles.get(collectionId) ?? collectionId,
      minMarginPercent: pct(mins[i] ?? null, 95) ?? null,
      maxDiscountPercent: pct(maxes[i] ?? null, 100) ?? null,
    })),
  };
}

/** A stored percent as the field value ("" when not set). */
export function percentInput(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? String(n) : "";
}

// --- The cost mirror -----------------------------------------------------------------------

/** One honest sentence about the cost mirror (§11d, §12). */
export function mirrorText(view: CostMirrorView, tr: Translator): string {
  switch (view.state) {
    case "running":
      return view.total !== null
        ? tr.t("margin.mirror.running", { done: view.done, total: view.total })
        : tr.t("margin.mirror.runningUnknown", { done: view.done });
    case "fresh":
      return tr.t("margin.mirror.fresh", { date: formatDateTime(view.at, tr.locale) });
    case "stale":
      return view.at ? tr.t("margin.mirror.stale", { date: formatDateTime(view.at, tr.locale) }) : tr.t("margin.mirror.staleNever");
    case "failed":
      return tr.t("margin.mirror.failed", { date: formatDateTime(view.at, tr.locale) });
    case "off":
    default:
      return tr.t("margin.mirror.off");
  }
}

/** The mirror is behind or failed: "Obnovit nákupní ceny" is the one button that fixes it (§13a). */
export function mirrorNeedsRefresh(view: CostMirrorView): boolean {
  return view.state === "stale" || view.state === "failed";
}

/** "Obnovit nákupní ceny" makes sense only while protection is on and no read is running. */
export function mirrorCanRefresh(view: CostMirrorView): boolean {
  return view.state !== "off" && view.state !== "running";
}

// --- §10 proof: one product, the same floor checkout uses ----------------------------------

export interface MarginProof {
  price: number;
  cost: number;
  /** The discount the example rule wants, in %. */
  wantedPercent: number;
  /** What the shopper pays without protection. */
  withoutPays: number;
  withoutMarginPercent: number;
  /** With protection (the cost floor). */
  withPays: number;
  withMarginPercent: number;
  withDiscountPercent: number;
  /** A product without a cost price: the % ceiling. */
  noCostPays: number;
  noCostDiscountPercent: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A 1 000 (shop currency) product with a 600 cost and a 50 % discount, under the
 * typed settings — through core marginFloorUnit, so the example can never
 * disagree with checkout (§10b).
 */
export function marginProof(settings: Pick<MarginSettingsView, "minMarginPercent" | "maxDiscountPercent">, currency: string): MarginProof {
  const scale = 10 ** currencyExponent(currency);
  const price = 1000 * scale;
  const cost = 600 * scale;
  const wantedPercent = 50;
  const wantedPays = Math.round((price * (100 - wantedPercent)) / 100);
  const m = settings.minMarginPercent ?? 0;
  const p = settings.maxDiscountPercent;
  const withCost = marginFloorUnit({ unitPrice: price, costMinor: cost, minMarginPercent: m, maxDiscountPercent: p });
  const noCost = marginFloorUnit({ unitPrice: price, costMinor: null, minMarginPercent: m, maxDiscountPercent: p });
  const withPays = Math.max(wantedPays, withCost.floorUnit);
  const noCostPays = Math.max(wantedPays, noCost.floorUnit);
  const marginOf = (pays: number) => (pays > 0 ? round1(((pays - cost) / pays) * 100) : 0);
  return {
    price,
    cost,
    wantedPercent,
    withoutPays: wantedPays,
    withoutMarginPercent: marginOf(wantedPays),
    withPays,
    withMarginPercent: marginOf(withPays),
    withDiscountPercent: round1(((price - withPays) / price) * 100),
    noCostPays,
    noCostDiscountPercent: round1(((price - noCostPays) / price) * 100),
  };
}

// --- Přehled zásahů ------------------------------------------------------------------------

export interface ImpactGroup {
  ruleId: string;
  ruleName: string;
  rows: MarginImpactRowView[];
}

/** The rows grouped by rule (pravidlo → produkt), in the order of their biggest loss. */
export function impactGroups(rows: readonly MarginImpactRowView[], ruleId?: string | null): ImpactGroup[] {
  const groups = new Map<string, ImpactGroup>();
  for (const row of rows) {
    if (ruleId && row.ruleId !== ruleId) continue;
    const group = groups.get(row.ruleId) ?? { ruleId: row.ruleId, ruleName: row.ruleName, rows: [] };
    group.rows.push(row);
    groups.set(row.ruleId, group);
  }
  return [...groups.values()];
}

/** Distinct products the protection lowers a discount on (the section's state line). */
export function impactProductCount(impact: MarginImpactView): number {
  return new Set(impact.rows.map((r) => r.productId)).size;
}

/** Why one row is lowered, in words (§4c: basis/source never render raw). */
export function impactReason(row: Pick<MarginImpactRowView, "basis" | "source">, tr: Translator): string {
  const basis = tr.t(row.basis === "cost" ? "margin.impact.basis.cost" : "margin.impact.basis.maxPercent");
  return row.source === "collection" ? `${basis} · ${tr.t("margin.impact.source.collection")}` : basis;
}

/** "50 %" in the admin language. */
export function percentText(n: number, tr: Translator): string {
  return formatPercent(n, tr.locale);
}
