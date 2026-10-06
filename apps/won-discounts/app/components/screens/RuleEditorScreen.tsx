// The rule editor (module "Slevy a kódy"). Studio shell (§7b, A7): each section
// leads with its live state line (§17b — re-read from the form on every native
// input/change event, §2). Five sections, all open: 1 Sleva · 2 Podmínky ·
// 3 Jak se uplatní (codes + their limits) · 4 Kdy platí · 5 Cílení a kombinace
// (Pro, amber, never blocks Free: A2, §16; collapsed only while nothing is set
// in it). Values are per market currency, never converted (MKT-1): an empty
// currency field means "not offered in that market".
//
// P3: whatever keeps the rule from running is marked at the field that fixes
// it, from the live draft; the status sentence links to that field, and so do
// `/app/discounts/<id>#<anchor>` links (model/describe EditorAnchor; `#more`
// of the retired "Další možnosti" lands on the conditions).
// P5: the name follows the settings until the merchant types their own; the
// page heading follows the draft name.
//
// The form is parsed by model/rule-form.ts — the same function the server action
// runs — so the summary and the preview can never disagree with what Save stores.
// The sections live in components/rule-editor/*.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, useSubmit } from "react-router";

import { ruleHasCodes, type CodeBatchSpec } from "@won/core/discounts/code-batch";
import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";
import { gateConfigForPlan } from "@won/core/discounts/plan-gate";

import { useT } from "../../i18n/context";
import { pickCollections, pickProducts } from "../model/app-bridge";
import { ruleName } from "../model/describe";
import { marketView } from "../model/markets";
import { currencyCodes, currencyViews, marketViews, type MarketNames } from "../model/markets";
import {
  FIELD,
  readRuleForm,
  recipeRule,
  ruleFormDefaults,
  ruleVersionToken,
  shopToday,
  type RecipeKey,
  type RuleFormContext,
} from "../model/rule-form";
import { ruleStatus } from "../model/rule-status";
import { ConditionsSection } from "../rule-editor/ConditionsSection";
import { ScheduleSection } from "../rule-editor/ScheduleSection";
import type { CodeRuleLimit, CurrencyView, FieldError, GateNoteView, GeneratedBatchView, MarginRuleImpactView, MarketView, RuleSyncMap, SyncView, UiResult } from "../model/types";
import { ApplySection } from "../rule-editor/ApplySection";
import { DiscountSection } from "../rule-editor/DiscountSection";
import { ProSection } from "../rule-editor/ProSection";
import { jumpToAnchor, type EditorView } from "../rule-editor/parts";
import { boolAttr } from "../shell/attrs";
import { Notice } from "../shell/Notice";

export interface RuleEditorScreenProps {
  mode: "new" | "edit";
  /** The stored rule (edit) or null (new: the draft comes from `recipe`, in the admin language). */
  rule: DiscountRule | null;
  recipe: RecipeKey;
  currencies: CurrencyView[];
  /** Shop IANA time zone for schedule days; null = unknown (the editor says days are UTC). */
  timezone: string | null;
  /** Shop-local today (the rule's real state is judged on it). */
  today: string;
  sync: SyncView;
  /** Per-rule sync facts (Běží = this version is in Shopify). */
  ruleSync?: RuleSyncMap;
  /** Server-derived Pro entitlement (BILL-1). */
  pro: boolean;
  readOnly: boolean;
  /** Enabled Won markets by name (Pro market targeting). */
  markets: MarketView[];
  /** Markets this rule targets that are switched off (B3): shown as ticked rows with a note, kept until unticked. */
  offMarkets?: MarketView[];
  otherRules: { id: string; name: string; codes?: string[] }[];
  /** Names and images of the products, variants and collections this rule targets (P4), by id. */
  labels?: Record<string, { title: string; image?: string }>;
  codeRules: CodeRuleLimit;
  /** The rule's generated code batches with their codes (bod 6). */
  batches?: GeneratedBatchView[];
  result?: UiResult | null;
  /** Pro settings of THIS rule stored but not in force on the shop's plan (BILL-1, explainGate). */
  gate?: GateNoteView[];
  /** The plan switches this rule off (market / segment targeting on Free). */
  gateOff?: boolean;
  /** read_markets (optional scope) is granted; without it the editor asks for it when a market is picked (item 9). */
  marketsScope?: boolean;
  /** Checkout still runs a config built with this rule's Pro settings; a resync is under way (I-2). */
  gatePending?: boolean;
  /**
   * Ochrana marže (MVP 2): margin protection lowers this (saved) rule's
   * discount — ruleMarginImpact (Pro: on how many variants; Free: no number);
   * null/absent = protection off or none.
   */
  marginImpact?: MarginRuleImpactView | null;
  /**
   * Množstevní slevy (MVP 3): a tier set with tiers runs on this plan — a
   * product rule then competes with the tier on the same line (A1: the better
   * one wins, never both); the editor says so. Additive (T5).
   */
  tiersActive?: boolean;
}

/** A tier set with tiers runs on the plan (the gated config, BILL-1). */
function tiersRun(config: WonDiscountsConfig, pro: boolean): boolean {
  return gateConfigForPlan(config, pro ? "pro" : "free").config.modules.tiers.sets.some((s) => s.breaks.length > 0);
}

export function buildRuleEditorProps(
  config: WonDiscountsConfig,
  opts: {
    ruleId: string;
    recipe?: RecipeKey | null;
    readOnly: boolean;
    pro: boolean;
    timezone: string | null;
    sync: SyncView;
    ruleSync?: RuleSyncMap;
    codeRules: CodeRuleLimit;
    shopCurrency?: string | null;
    marketNames?: MarketNames;
    now?: Date;
    gate?: GateNoteView[];
    gateOff?: string[];
    gatePending?: boolean;
    marketsScope?: boolean;
  },
): RuleEditorScreenProps | null {
  const rules = config.modules.codes.rules;
  const isNew = opts.ruleId === "new";
  const rule = isNew ? null : (rules.find((r) => r.id === opts.ruleId) ?? null);
  if (!isNew && !rule) return null;
  return {
    mode: isNew ? "new" : "edit",
    rule,
    recipe: opts.recipe ?? "blank",
    currencies: currencyViews(config.markets, { shopCurrency: opts.shopCurrency, rules, marketNames: opts.marketNames }),
    timezone: opts.timezone,
    today: shopToday(opts.timezone, opts.now),
    sync: opts.sync,
    ...(opts.ruleSync ? { ruleSync: { ...opts.ruleSync } } : {}),
    pro: opts.pro,
    readOnly: opts.readOnly,
    markets: marketViews(config.markets, opts.marketNames),
    ...(rule ? offMarketsOf(rule, config, opts.marketNames) : {}),
    otherRules: rules
      .filter((r) => r.id !== opts.ruleId)
      .map((r) => ({ id: r.id, name: r.name, ...(r.codes ? { codes: r.codes } : {}) })),
    codeRules: opts.codeRules,
    ...(rule && opts.gate ? { gate: opts.gate.filter((g) => g.ruleId === rule.id).map((g) => ({ ...g })) } : {}),
    ...(rule && opts.gateOff?.includes(rule.id) ? { gateOff: true } : {}),
    ...(opts.marketsScope !== undefined ? { marketsScope: opts.marketsScope } : {}),
    ...(opts.gatePending ? { gatePending: true } : {}),
    ...(tiersRun(config, opts.pro) ? { tiersActive: true } : {}),
  };
}

/** The rule's stored markets that are not enabled (B3), by name. */
function offMarketsOf(rule: DiscountRule, config: WonDiscountsConfig, names?: MarketNames): { offMarkets?: MarketView[] } {
  const enabled = new Set(config.markets.filter((m) => m.enabled).map((m) => m.handle));
  const off = (rule.targeting?.markets ?? []).filter((h) => !enabled.has(h));
  return off.length > 0 ? { offMarkets: off.map((h) => marketView(h, names)) } : {};
}

/** A code rule that takes one of the shop's active code-rule places (config-guards activeCodeRules, without campaigns). */
function countsAsCodeRule(rule: DiscountRule | null, ended: boolean): boolean {
  return !!rule && rule.enabled && rule.method === "code" && ruleHasCodes(rule) && !ended;
}

const DELETE_DIALOG = "won-delete-dialog";

export function RuleEditorScreen(props: RuleEditorScreenProps) {
  const { mode, rule, recipe, currencies, timezone, today, sync, ruleSync, pro, readOnly, markets, otherRules, codeRules, result } = props;
  const gate = props.gate ?? [];
  const offMarkets = useMemo(() => props.offMarkets ?? [], [props.offMarkets]);
  const tr = useT();
  const { t } = tr;
  const codes = useMemo(() => currencyCodes(currencies), [currencies]);
  const initial = useMemo(
    () => rule ?? recipeRule(recipe, { id: "new", locale: tr.locale, currencies: codes }),
    [rule, recipe, tr.locale, codes],
  );
  const defaults = useMemo(() => ruleFormDefaults(initial, codes, timezone, tr.locale), [initial, codes, timezone, tr.locale]);
  const ctx: RuleFormContext = useMemo(
    () => ({
      id: initial.id,
      currencies: codes,
      timezone,
      pro,
      existing: rule,
      marketHandles: markets.map((m) => m.handle),
      otherRules,
      locale: tr.locale,
    }),
    [initial.id, codes, timezone, pro, rule, markets, otherRules, tr.locale],
  );

  // §2/§17b: the live draft, re-read from the whole form on native events.
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<DiscountRule>(initial);
  // Bod 6: the generator has a count — codes will be made on save, so the draft is not "without a code".
  const [pendingBatch, setPendingBatch] = useState<CodeBatchSpec | undefined>(undefined);
  const recompute = useCallback(() => {
    const form = formRef.current;
    // B11: read-only fields are disabled and a disabled field is not in FormData — the stored rule is the draft.
    if (!form || readOnly) return;
    const parsed = readRuleForm(new FormData(form), ctx);
    setDraft(parsed.rule);
    setPendingBatch(parsed.pendingBatch);
  }, [ctx, readOnly]);
  // P5: the name is generated from the settings until the merchant types in the
  // name field (a native `input` from that field ends the automatic mode; the
  // code never fires one). The mode travels in the hidden FIELD.nameAuto, so
  // the parser — here and on the server — derives the same name.
  const [nameAuto, setNameAuto] = useState(defaults.nameAuto);
  const touched = useRef(false);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const onInput = (event: Event) => {
      if ((event.target as { name?: string } | null)?.name === FIELD.name) {
        touched.current = true;
        setNameAuto(false);
      }
      recompute();
    };
    el.addEventListener("input", onInput);
    el.addEventListener("change", recompute);
    return () => {
      el.removeEventListener("input", onInput);
      el.removeEventListener("change", recompute);
    };
  }, [recompute]);
  // The hidden field changed with the mode: read the form again (never on mount,
  // before the Polaris fields exist).
  useEffect(() => {
    if (touched.current) recompute();
  }, [nameAuto, recompute]);
  const restoreAutoName = () => {
    touched.current = true;
    setNameAuto(true);
  };

  // §13c deep links: `#codes`, `#target`, `#markets`… — scroll to the field and focus it,
  // on landing and when the hash changes (WonSection only opens its own collapsed section).
  useEffect(() => {
    const land = () => {
      const hash = window.location.hash.slice(1);
      if (hash) jumpToAnchor(hash);
    };
    const timer = window.setTimeout(land, 0);
    window.addEventListener("hashchange", land);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("hashchange", land);
    };
  }, []);

  // Resource pickers (App Bridge seam) feed hidden inputs; re-read after a pick.
  const [productIds, setProductIds] = useState<string[]>(defaults.productIds);
  const [collectionIds, setCollectionIds] = useState<string[]>(defaults.collectionIds);
  // Variant ids stored earlier (B4): listed by name and removable one by one, never added here.
  const [variantIds, setVariantIds] = useState<string[]>(defaults.variantIds);
  // P4: the names the list shows — the stored ones from the loader, plus what the picker just returned.
  const [labels, setLabels] = useState<Record<string, { title: string; image?: string }>>(props.labels ?? {});
  const [pickUnavailable, setPickUnavailable] = useState(false);
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current) recompute();
  }, [productIds, collectionIds, variantIds, recompute]);
  const removeTarget = (kind: "products" | "variants" | "collections", id: string) => {
    if (readOnly) return;
    picked.current = true;
    const without = (list: string[]) => list.filter((x) => x !== id);
    if (kind === "products") setProductIds(without);
    else if (kind === "variants") setVariantIds(without);
    else setCollectionIds(without);
    // The save bar listens for a native change: a removed row is one.
    window.setTimeout(() => formRef.current?.dispatchEvent(new Event("change", { bubbles: true })), 0);
  };
  const choose = async (kind: "products" | "collections") => {
    if (readOnly) return;
    // B4: whole products only (`variants: false`, as Množstevní slevy do). The picker used to let the
    // merchant tick single variants while only the product id was kept, so the other variants got
    // the discount too. Variant ids stored earlier stay visible and removable (DiscountSection).
    const res = kind === "products" ? await pickProducts(productIds, { variants: false }) : await pickCollections(collectionIds);
    if (!res.ok) {
      if (res.reason === "unavailable") setPickUnavailable(true);
      return;
    }
    picked.current = true;
    setLabels((known) => {
      const next = { ...known };
      for (const item of res.items) next[item.id] = { ...known[item.id], title: item.title };
      return next;
    });
    if (kind === "products") setProductIds(res.items.map((p) => p.id));
    else setCollectionIds(res.items.map((c) => c.id));
  };

  // "Discard" in the App Bridge save bar resets the form: remount the fields
  // with their defaults so the segmented choices, pickers and the live summary
  // all go back together (a native reset alone would leave React state behind).
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const onReset = () => {
      setFormKey((k) => k + 1);
      setDraft(initial);
      setPendingBatch(undefined);
      setNameAuto(defaults.nameAuto);
      setProductIds(defaults.productIds);
      setCollectionIds(defaults.collectionIds);
      setVariantIds(defaults.variantIds);
      // Polaris fields emit a `change` with their pre-reset value while the
      // reset runs; re-read the form once the reset has finished.
      window.setTimeout(recompute, 0);
    };
    el.addEventListener("reset", onReset);
    return () => el.removeEventListener("reset", onReset);
  }, [initial, defaults, recompute]);

  const errors: FieldError[] = result && !result.ok && result.reason === "invalid" ? result.errors : [];
  const errorFor = (field: string): string | undefined => {
    const e = errors.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };
  const ed: EditorView = { draft, defaults, codes, currencyViews: currencies, timezone, readOnly, errorFor, tr };
  // The plan gate is the server's verdict on the STORED rule; the live draft is off only while it still holds that targeting.
  const gateOffLive = !!props.gateOff && !!rule && ((draft.targeting?.markets?.length ?? 0) > 0 || (draft.targeting?.segments?.length ?? 0) > 0);
  const status = ruleStatus(draft, {
    today,
    timezone,
    sync,
    ruleSync,
    draft: mode === "new",
    pendingCodes: !!pendingBatch,
    gateOff: gateOffLive && rule ? [rule.id] : [],
    currencies: codes,
    enabledMarkets: markets.map((m) => m.handle),
  });
  // P5: the cap on active code rules, counting the draft as it is now (not the stored rule).
  const storedEnded = rule ? ruleStatus(rule, { today, timezone, sync: { state: "ok", at: "" } as SyncView }).kind === "ended" : false;
  const codeRulesLive: CodeRuleLimit = {
    ...codeRules,
    active: Math.max(0, codeRules.active - (countsAsCodeRule(rule, storedEnded) ? 1 : 0) + (countsAsCodeRule(draft, status.kind === "ended") ? 1 : 0)),
  };
  const names = useMemo(
    () => ({
      marketNames: Object.fromEntries([...markets, ...offMarkets].map((m) => [m.handle, m.name])),
      ruleNames: new Map(otherRules.map((r) => [r.id, r.name])),
    }),
    [markets, offMarkets, otherRules],
  );
  const ruleVersion = rule ? ruleVersionToken(rule) : null;
  const submit = useSubmit();
  // I3: "Nahradit neplatnou konfiguraci" re-submits exactly this form, confirmed.
  const replaceUnreadable = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    data.set("replaceUnreadable", "1");
    submit(data, { method: "post" });
  };
  // P5: the heading follows the draft name (a new rule without one yet: "Nová sleva").
  const heading = mode === "new" && !draft.name.trim() ? t("editor.titleNew") : ruleName(draft, tr);

  return (
    <s-page heading={heading}>
      <s-link slot="breadcrumb-actions" href="/app/discounts">
        {t("discounts.title")}
      </s-link>
      {mode === "edit" && !readOnly ? (
        <s-button slot="secondary-actions" tone="critical" commandFor={DELETE_DIALOG} command="--show">
          {t("editor.delete")}
        </s-button>
      ) : null}

      <Form method="post" ref={formRef} data-save-bar>
        <input type="hidden" name="intent" value="save" />
        {ruleVersion ? <input type="hidden" name={FIELD.ruleVersion} value={ruleVersion} /> : null}
        <s-stack key={formKey} direction="block" gap="base">
          {readOnly ? (
            <s-banner tone="warning" heading={t("common.readOnly.heading")}>
              {t("common.readOnly.body")}
            </s-banner>
          ) : null}
          <Notice result={result} onReplace={replaceUnreadable} />
          <DiscountSection
            ed={ed}
            status={status}
            names={names}
            nameAuto={nameAuto}
            onRestoreAutoName={restoreAutoName}
            resync={!readOnly && sync.state !== "not_wired"}
            productIds={productIds}
            variantIds={variantIds}
            collectionIds={collectionIds}
            labels={labels}
            onRemove={removeTarget}
            pro={pro}
            onPick={(kind) => void choose(kind)}
            pickUnavailable={pickUnavailable}
            marginImpact={mode === "edit" ? props.marginImpact : null}
            tiersActive={props.tiersActive === true}
          />
          <ConditionsSection ed={ed} />
          <ApplySection ed={ed} codeRules={codeRulesLive} pro={pro} batches={props.batches ?? []} pendingBatch={pendingBatch} />
          <ScheduleSection ed={ed} status={status} />
          <ProSection
            ed={ed}
            pro={pro}
            status={status}
            markets={markets}
            offMarkets={offMarkets}
            otherRules={otherRules}
            gate={gate}
            gatePending={props.gatePending ?? false}
            marketsScope={props.marketsScope ?? true}
          />
          <div>
            <s-button type="submit" variant="primary" disabled={boolAttr(readOnly)}>
              {t("common.save")}
            </s-button>
          </div>
        </s-stack>
      </Form>

      {mode === "edit" ? (
        <s-modal id={DELETE_DIALOG} heading={t("editor.delete.heading", { name: ruleName(initial, tr) })}>
          <s-paragraph>{t("editor.delete.body")}</s-paragraph>
          <s-button
            slot="primary-action"
            variant="primary"
            tone="critical"
            commandFor={DELETE_DIALOG}
            command="--hide"
            onClick={() => submit(ruleVersion ? { intent: "delete", [FIELD.ruleVersion]: ruleVersion } : { intent: "delete" }, { method: "post" })}
          >
            {t("editor.delete")}
          </s-button>
          <s-button slot="secondary-actions" commandFor={DELETE_DIALOG} command="--hide">
            {t("common.cancel")}
          </s-button>
        </s-modal>
      ) : null}
    </s-page>
  );
}
