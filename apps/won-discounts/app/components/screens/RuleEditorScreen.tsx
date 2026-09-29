// The rule editor (module "Slevy a kódy"). Studio shell (§7b, A7): each section
// leads with its live state line (§17b — re-read from the form on every native
// input/change event, §2), the primary controls are visible, rare ones sit in
// "Další možnosti" (§9), Pro targeting/combinations are visible in amber and
// never block Free (A2, §16). Values are per market currency, never converted
// (MKT-1): an empty currency field means "not offered in that market".
//
// The form is parsed by model/rule-form.ts — the same function the server action
// runs — so the summary and the preview can never disagree with what Save stores.
// The sections live in components/rule-editor/*.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, useSubmit } from "react-router";

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import { pickCollections, pickProducts } from "../model/app-bridge";
import { ruleName } from "../model/describe";
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
import type { CodeRuleLimit, CurrencyView, FieldError, GateNoteView, MarginRuleImpactView, MarketView, RuleSyncMap, SyncView, UiResult } from "../model/types";
import { ApplySection } from "../rule-editor/ApplySection";
import { DiscountSection } from "../rule-editor/DiscountSection";
import { MoreOptionsSection } from "../rule-editor/MoreOptionsSection";
import { ProSection } from "../rule-editor/ProSection";
import type { EditorView } from "../rule-editor/parts";
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
  otherRules: { id: string; name: string; codes?: string[] }[];
  codeRules: CodeRuleLimit;
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
    otherRules: rules
      .filter((r) => r.id !== opts.ruleId)
      .map((r) => ({ id: r.id, name: r.name, ...(r.codes ? { codes: r.codes } : {}) })),
    codeRules: opts.codeRules,
    ...(rule && opts.gate ? { gate: opts.gate.filter((g) => g.ruleId === rule.id).map((g) => ({ ...g })) } : {}),
    ...(rule && opts.gateOff?.includes(rule.id) ? { gateOff: true } : {}),
    ...(opts.marketsScope !== undefined ? { marketsScope: opts.marketsScope } : {}),
    ...(opts.gatePending ? { gatePending: true } : {}),
  };
}

const DELETE_DIALOG = "won-delete-dialog";

export function RuleEditorScreen(props: RuleEditorScreenProps) {
  const { mode, rule, recipe, currencies, timezone, today, sync, ruleSync, pro, readOnly, markets, otherRules, codeRules, result } = props;
  const gate = props.gate ?? [];
  const tr = useT();
  const { t } = tr;
  const codes = useMemo(() => currencyCodes(currencies), [currencies]);
  const initial = useMemo(
    () => rule ?? recipeRule(recipe, { id: "new", locale: tr.locale, currencies: codes }),
    [rule, recipe, tr.locale, codes],
  );
  const defaults = useMemo(() => ruleFormDefaults(initial, codes, timezone), [initial, codes, timezone]);
  const ctx: RuleFormContext = useMemo(
    () => ({
      id: initial.id,
      currencies: codes,
      timezone,
      pro,
      existing: rule,
      marketHandles: markets.map((m) => m.handle),
      otherRules,
    }),
    [initial.id, codes, timezone, pro, rule, markets, otherRules],
  );

  // §2/§17b: the live draft, re-read from the whole form on native events.
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<DiscountRule>(initial);
  const recompute = useCallback(() => {
    const form = formRef.current;
    if (form) setDraft(readRuleForm(new FormData(form), ctx).rule);
  }, [ctx]);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    el.addEventListener("input", recompute);
    el.addEventListener("change", recompute);
    return () => {
      el.removeEventListener("input", recompute);
      el.removeEventListener("change", recompute);
    };
  }, [recompute]);

  // Resource pickers (App Bridge seam) feed hidden inputs; re-read after a pick.
  const [productIds, setProductIds] = useState<string[]>(defaults.productIds);
  const [collectionIds, setCollectionIds] = useState<string[]>(defaults.collectionIds);
  const [pickUnavailable, setPickUnavailable] = useState(false);
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current) recompute();
  }, [productIds, collectionIds, recompute]);
  const choose = async (kind: "products" | "collections") => {
    const res = kind === "products" ? await pickProducts(productIds) : await pickCollections(collectionIds);
    if (!res.ok) {
      if (res.reason === "unavailable") setPickUnavailable(true);
      return;
    }
    picked.current = true;
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
      setProductIds(defaults.productIds);
      setCollectionIds(defaults.collectionIds);
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
  const moreFields: string[] = [FIELD.minQty, FIELD.startDate, FIELD.endDate, FIELD.usageLimit, ...codes.map(FIELD.minimum)];
  const moreOpen =
    errors.some((e) => moreFields.includes(e.field)) ||
    !!(initial.minimum || initial.schedule || (initial.method === "code" && initial.limits));

  const ed: EditorView = { draft, defaults, codes, timezone, errorFor, tr };
  const status = ruleStatus(draft, {
    today,
    timezone,
    sync,
    ruleSync,
    draft: mode === "new",
    gateOff: props.gateOff && rule ? [rule.id] : [],
    currencies: codes,
    enabledMarkets: markets.map((m) => m.handle),
  });
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
  const heading = mode === "new" ? t("editor.titleNew") : ruleName(initial, tr);

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
            productIds={productIds}
            variantIds={defaults.variantIds}
            collectionIds={collectionIds}
            onPick={(kind) => void choose(kind)}
            pickUnavailable={pickUnavailable}
            marginImpact={mode === "edit" ? props.marginImpact : null}
          />
          <ApplySection ed={ed} codeRules={codeRules} />
          <MoreOptionsSection ed={ed} defaultOpen={moreOpen} />
          <ProSection
            ed={ed}
            pro={pro}
            markets={markets}
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
