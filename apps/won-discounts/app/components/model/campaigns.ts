// Kampaně (MVP 6, Pro; contract K7) — the form model shared by the screen and the server (SEC-1: the action parses
// exactly these fields). A campaign: a name, a window in the shop's time (a date and a time picked from a list for
// each end) and, per
// discount rule (only a TICKED one: the screen shows its fields only then, B7), an override (D2): switch it on / off during the campaign and / or give it another value; MVP 6.1
// (L8): per quantity tier set, its breaks during the campaign (rows of a quantity and a value). Core
// validateCampaignDraft checks the draft (window, overlap, rules, values, breaks at least as generous as the base).

import type { CampaignDraft, CampaignDraftField, CampaignDraftOverride, CampaignDraftTiers } from "@won/core/discounts/campaigns";
import type { TierBreak } from "@won/core/discounts/config";

import type { FormDataLike } from "./rule-form";
import type { CampaignRuleChoice, CampaignTierChoice, CampaignTierRow, CampaignView, SubmittedValues } from "./types";

export const CAMPAIGNS_ACTION = "/app/campaigns";
export const CAMPAIGN_INTENT = { save: "save", kill: "kill", delete: "delete" } as const;
export type CampaignIntent = (typeof CAMPAIGN_INTENT)[keyof typeof CAMPAIGN_INTENT];

export const CAMPAIGN_FIELD = {
  intent: "intent",
  /** The campaign being edited / killed / deleted (empty = a new one). */
  id: "cp.id",
  name: "cp.name",
  startDate: "cp.startDate",
  startTime: "cp.startTime",
  endDate: "cp.endDate",
  endTime: "cp.endTime",
  /** One value per rule the campaign changes (its id). */
  use: "cp.use",
  /** `cp.enabled.<ruleId>`: "" (unchanged) | "on" | "off". */
  enabled: "cp.enabled.",
  /** `cp.percent.<ruleId>`: a whole percent ("" = value unchanged). */
  percent: "cp.percent.",
  /** `cp.amount.<ruleId>.<CUR>`: an amount in major units ("" = value unchanged). */
  amount: "cp.amount.",
  /** MVP 6.1: one value per tier set the campaign changes (its id). */
  tierUse: "cp.tierUse",
  /** `cp.tq.<setId>.<row>`: the row's quantity ("" = the row is not used). */
  tierQty: "cp.tq.",
  /** `cp.tp.<setId>.<row>`: a percent set's value in the campaign. */
  tierPercent: "cp.tp.",
  /** `cp.ta.<setId>.<row>.<CUR>`: an amount set's value per item in major units. */
  tierAmount: "cp.ta.",
} as const;

/** Rows a set's breaks take in the form (core CONFIG_LIMITS.breaksPerTierSet). */
export const CAMPAIGN_TIER_ROWS = 10;

/** The form fields a core draft error lands on. */
export const CAMPAIGN_ERROR_FIELD: Record<CampaignDraftField, string> = {
  name: CAMPAIGN_FIELD.name,
  start: CAMPAIGN_FIELD.startDate,
  end: CAMPAIGN_FIELD.endDate,
  overrides: CAMPAIGN_FIELD.use,
  tiers: CAMPAIGN_FIELD.tierUse,
};

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** `YYYY-MM-DD` + `HH:MM` → shop-local `YYYY-MM-DDTHH:MM:00` ("" when either is not well formed). */
export function localDateTime(date: string, time: string): string {
  const d = date.trim();
  const t = time.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && HHMM.test(t) ? `${d}T${t}:00` : "";
}

/** Minor units from a typed amount ("199", "199,50", "199.5"); null when not a positive amount with ≤ 2 decimals. */
export function minorFromInput(text: string, exponent = 2): number | null {
  const m = /^(\d{1,9})(?:[.,](\d{1,2}))?$/.exec(text.trim().replace(/\s/g, ""));
  if (!m) return null;
  const minor = Number(m[1]) * 10 ** exponent + Number((m[2] ?? "").padEnd(exponent, "0").slice(0, exponent) || 0);
  return Number.isSafeInteger(minor) ? minor : null;
}

/**
 * The draft from the form. `kinds` = each rule's value kind and currencies (from the stored config), so a value is
 * read only in the rule's own shape; an unreadable value is kept as an impossible one (core rejects it on the field).
 */
export function readCampaignForm(
  form: FormDataLike,
  kinds: ReadonlyMap<string, { kind: string; currencies: readonly string[] }>,
  sets: ReadonlyMap<string, { kind: "percent" | "amount"; currencies: readonly string[]; exponent?: (currency: string) => number }> = new Map(),
): { intent: string; id: string | null; draft: CampaignDraft } {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const id = text(CAMPAIGN_FIELD.id) || null;
  const overrides: CampaignDraftOverride[] = [];
  for (const ruleId of [...new Set(form.getAll(CAMPAIGN_FIELD.use).map(String))].slice(0, 200)) {
    const o: CampaignDraftOverride = { ruleId };
    const enabled = text(`${CAMPAIGN_FIELD.enabled}${ruleId}`);
    if (enabled === "on") o.enabled = true;
    else if (enabled === "off") o.enabled = false;
    const rule = kinds.get(ruleId);
    if (rule?.kind === "percentage") {
      const p = text(`${CAMPAIGN_FIELD.percent}${ruleId}`);
      if (p !== "") o.value = { kind: "percentage", percent: /^\d{1,3}$/.test(p) ? Number(p) : -1 };
    } else if (rule?.kind === "fixed") {
      const amount: Record<string, number> = {};
      let any = false;
      for (const currency of rule.currencies) {
        const raw = text(`${CAMPAIGN_FIELD.amount}${ruleId}.${currency}`);
        if (raw === "") continue;
        any = true;
        amount[currency] = minorFromInput(raw) ?? -1;
      }
      if (any) o.value = { kind: "fixed", amount };
    }
    overrides.push(o);
  }
  // MVP 6.1: the ticked tier sets' rows. A row without a value is not used; an unreadable quantity or value stays
  // an impossible one (NaN / −1), which core refuses on the set's field.
  const tiers: CampaignDraftTiers[] = [];
  for (const setId of [...new Set(form.getAll(CAMPAIGN_FIELD.tierUse).map(String))].slice(0, 50)) {
    const set = sets.get(setId);
    const breaks: TierBreak[] = [];
    for (let row = 0; set && row < CAMPAIGN_TIER_ROWS; row += 1) {
      const qtyText = text(`${CAMPAIGN_FIELD.tierQty}${setId}.${row}`);
      const minQty = /^\d{1,5}$/.test(qtyText) ? Number(qtyText) : Number.NaN;
      if (set.kind === "percent") {
        const p = text(`${CAMPAIGN_FIELD.tierPercent}${setId}.${row}`);
        if (p === "") continue;
        breaks.push({ minQty, percent: /^\d{1,3}(?:[.,]\d{1,2})?$/.test(p) ? Number(p.replace(",", ".")) : Number.NaN });
      } else {
        const amountOff: Record<string, number> = {};
        let any = false;
        for (const currency of set.currencies) {
          const raw = text(`${CAMPAIGN_FIELD.tierAmount}${setId}.${row}.${currency}`);
          if (raw === "") continue;
          any = true;
          amountOff[currency] = minorFromInput(raw, set.exponent?.(currency) ?? 2) ?? -1;
        }
        if (any) breaks.push({ minQty, amountOff });
      }
    }
    tiers.push({ setId, breaks });
  }
  return {
    intent: text(CAMPAIGN_FIELD.intent),
    id,
    draft: {
      id,
      name: text(CAMPAIGN_FIELD.name),
      start: localDateTime(text(CAMPAIGN_FIELD.startDate), text(CAMPAIGN_FIELD.startTime)),
      end: localDateTime(text(CAMPAIGN_FIELD.endDate), text(CAMPAIGN_FIELD.endTime)),
      overrides,
      ...(tiers.length > 0 ? { tiers } : {}),
    },
  };
}

// --- The form's values (B14 seed, P5 live summary) ----------------------------------------------------------

/** The times the form offers: every quarter of an hour, and 23:59 for "to the end of the day". */
export function campaignTimeOptions(current = ""): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += 15) out.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  out.push("23:59");
  // A stored time off the grid (set before the list existed) stays selectable, in its place.
  if (HHMM.test(current) && !out.includes(current)) out.push(current);
  return out.sort();
}

/** Extra empty rows under a set's breaks, for a break only the campaign has. */
export const CAMPAIGN_EXTRA_TIER_ROWS = 2;

/** The rows the form shows for a set: the campaign's own (when it changes the set), else the set's, plus the empty ones. */
export function campaignTierFormRows(set: Pick<CampaignTierChoice, "id" | "rows">, editing: Pick<CampaignView, "tiers"> | null): { rows: CampaignTierRow[]; own: number } {
  const stored = editing?.tiers.find((x) => x.setId === set.id)?.rows ?? set.rows;
  const extra = Math.max(0, Math.min(CAMPAIGN_TIER_ROWS - stored.length, CAMPAIGN_EXTRA_TIER_ROWS));
  return { rows: [...stored, ...Array.from({ length: extra }, () => ({ qty: "" }))], own: stored.length };
}

type RuleShape = Pick<CampaignRuleChoice, "id" | "kind" | "currencies">;
type SetShape = Pick<CampaignTierChoice, "id" | "kind" | "currencies">;

/** Every field name the form can post for these rules and sets (the server echoes them to a refused form). */
export function campaignFieldNames(rules: readonly RuleShape[], sets: readonly SetShape[]): string[] {
  const F = CAMPAIGN_FIELD;
  const names: string[] = [F.id, F.name, F.startDate, F.startTime, F.endDate, F.endTime, F.use, F.tierUse];
  for (const r of rules) {
    names.push(`${F.enabled}${r.id}`);
    if (r.kind === "percentage") names.push(`${F.percent}${r.id}`);
    if (r.kind === "fixed") for (const cur of r.currencies) names.push(`${F.amount}${r.id}.${cur}`);
  }
  for (const set of sets) {
    for (let row = 0; row < CAMPAIGN_TIER_ROWS; row += 1) {
      names.push(`${F.tierQty}${set.id}.${row}`);
      if (set.kind === "percent") names.push(`${F.tierPercent}${set.id}.${row}`);
      else for (const cur of set.currencies) names.push(`${F.tierAmount}${set.id}.${row}.${cur}`);
    }
  }
  return names;
}

/** What the form shows before anything is typed: the edited campaign, or a new one's defaults. Empty values are left out. */
export function campaignFormValues(editing: CampaignView | null, rules: readonly CampaignRuleChoice[], sets: readonly CampaignTierChoice[]): SubmittedValues {
  const F = CAMPAIGN_FIELD;
  const out: SubmittedValues = {};
  const put = (name: string, value: string | undefined) => {
    if (value !== undefined && value !== "") out[name] = [value];
  };
  put(F.name, editing?.name);
  put(F.startDate, editing?.start.date);
  put(F.startTime, editing?.start.time ?? "00:00");
  put(F.endDate, editing?.end.date);
  put(F.endTime, editing?.end.time ?? "23:59");
  const known = new Set(rules.map((r) => r.id));
  const overrides = (editing?.overrides ?? []).filter((o) => known.has(o.ruleId));
  if (overrides.length > 0) out[F.use] = overrides.map((o) => o.ruleId);
  for (const o of overrides) {
    put(`${F.enabled}${o.ruleId}`, o.enabled === undefined ? "" : o.enabled ? "on" : "off");
    put(`${F.percent}${o.ruleId}`, o.percent !== undefined ? String(o.percent) : "");
    for (const [cur, text] of Object.entries(o.amount ?? {})) put(`${F.amount}${o.ruleId}.${cur}`, text);
  }
  const used = (editing?.tiers ?? []).map((x) => x.setId).filter((id) => sets.some((set) => set.id === id));
  if (used.length > 0) out[F.tierUse] = used;
  for (const set of sets) {
    campaignTierFormRows(set, editing).rows.forEach((row, i) => {
      put(`${F.tierQty}${set.id}.${i}`, row.qty);
      put(`${F.tierPercent}${set.id}.${i}`, row.percent);
      for (const [cur, text] of Object.entries(row.amount ?? {})) put(`${F.tierAmount}${set.id}.${i}.${cur}`, text);
    });
  }
  return out;
}
