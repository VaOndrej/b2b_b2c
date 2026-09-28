// The rule editor (module "Slevy a kódy"). Studio shell (§7b, A7): each section
// leads with its live state line (§17b — re-read from the form on every native
// input/change event, §2), the primary controls are visible, rare ones sit in
// "Další možnosti" (§9), Pro targeting/combinations are visible in amber and
// never block Free (A2, §16). Values are per market currency, never converted
// (MKT-1): an empty currency field means "not offered in that market".
//
// The form is parsed by model/rule-form.ts — the same function the server action
// runs — so the summary and the preview can never disagree with what Save stores.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Form, useSubmit } from "react-router";

import type { DiscountRule, WonDiscountsConfig } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import type { Translator } from "../../i18n";
import { pickCollections, pickProducts } from "../model/app-bridge";
import {
  describeLimits,
  describeMethod,
  describeMinimum,
  describeMoreOptions,
  describeProSettings,
  describeRuleLine,
  describeSchedule,
  describeValue,
  missingCurrencies,
  ruleName,
} from "../model/describe";
import { currencyCodes, currencyViews, marketHandles } from "../model/markets";
import { formatMoney } from "../model/money";
import {
  FIELD,
  NAME_MAX,
  readRuleForm,
  recipeRule,
  ruleFormDefaults,
  type RecipeKey,
  type RuleFormContext,
} from "../model/rule-form";
import type { CurrencyView, FieldError, UiResult } from "../model/types";
import { Notice } from "../shell/Notice";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { WonBlock, WonSection } from "../shell/WonSection";
import { WON_ATTENTION, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_WASH } from "../shell/tokens";

export interface RuleEditorScreenProps {
  mode: "new" | "edit";
  /** The stored rule (edit) or null (new: the draft comes from `recipe`, in the admin language). */
  rule: DiscountRule | null;
  recipe: RecipeKey;
  currencies: CurrencyView[];
  /** Shop IANA time zone for schedule days; null = unknown (the editor says days are UTC). */
  timezone: string | null;
  /** Server-derived Pro entitlement (BILL-1). */
  pro: boolean;
  readOnly: boolean;
  marketHandles: string[];
  otherRules: { id: string; name: string; codes?: string[] }[];
  result?: UiResult | null;
}

export function buildRuleEditorProps(
  config: WonDiscountsConfig,
  opts: {
    ruleId: string;
    recipe?: RecipeKey | null;
    readOnly: boolean;
    pro: boolean;
    timezone: string | null;
    shopCurrency?: string | null;
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
    currencies: currencyViews(config.markets, { shopCurrency: opts.shopCurrency, rules }),
    timezone: opts.timezone,
    pro: opts.pro,
    readOnly: opts.readOnly,
    marketHandles: marketHandles(config.markets),
    otherRules: rules
      .filter((r) => r.id !== opts.ruleId)
      .map((r) => ({ id: r.id, name: r.name, ...(r.codes ? { codes: r.codes } : {}) })),
  };
}

/** React 18 writes `false` onto a custom element as the string "false"; omit it instead. */
const on = (b: boolean): true | undefined => (b ? true : undefined);

const DELETE_DIALOG = "won-delete-dialog";

export function RuleEditorScreen(props: RuleEditorScreenProps) {
  const { mode, rule, recipe, currencies, timezone, pro, readOnly, result } = props;
  const tr = useT();
  const { t } = tr;
  const codes = useMemo(() => currencyCodes(currencies), [currencies]);
  const initial = useMemo(
    () => rule ?? recipeRule(recipe, { id: "new", locale: tr.locale, currencies: codes }),
    [rule, recipe, tr.locale, codes],
  );
  const defaults = useMemo(() => ruleFormDefaults(initial, codes), [initial, codes]);
  const ctx: RuleFormContext = useMemo(
    () => ({
      id: initial.id,
      currencies: codes,
      timezone,
      pro,
      existing: rule,
      marketHandles: props.marketHandles,
      otherRules: props.otherRules,
    }),
    [initial.id, codes, timezone, pro, rule, props.marketHandles, props.otherRules],
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

  const errors: FieldError[] = result && !result.ok && result.reason === "invalid" ? result.errors : [];
  const errorFor = (field: string): string | undefined => {
    const e = errors.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };
  const moreFields = [FIELD.minQty, FIELD.startDate, FIELD.endDate, FIELD.usageLimit, ...codes.map(FIELD.minimum)];
  const moreOpen =
    errors.some((e) => moreFields.includes(e.field)) ||
    !!(initial.minimum || initial.schedule || (initial.method === "code" && initial.limits));

  const valueKind = draft.value.kind;
  const targetKind = draft.target.kind;
  const isCode = draft.method === "code";
  const ruleNames = useMemo(() => new Map(props.otherRules.map((r) => [r.id, r.name])), [props.otherRules]);

  const submit = useSubmit();
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
        <s-stack key={formKey} direction="block" gap="base">
          {readOnly ? (
            <s-banner tone="warning" heading={t("common.readOnly.heading")}>
              {t("common.readOnly.body")}
            </s-banner>
          ) : null}
          <Notice result={result} />

          <WonSection
            title={t("editor.section.discount")}
            glyph="tag"
            summary={describeRuleLine(draft, tr, codes)}
            on={draft.enabled}
            anchor="value"
            aside={<CustomerPreview draft={draft} codes={codes} tr={tr} />}
          >
            <s-stack direction="block" gap="base">
              <s-switch name={FIELD.enabled} value="on" label={t("editor.enabled")} checked={on(defaults.enabled)} />
              <s-text-field
                name={FIELD.name}
                label={t("editor.name.label")}
                value={defaults.name}
                maxLength={NAME_MAX}
                details={t("editor.name.details")}
                error={errorFor(FIELD.name)}
              />
              <SegmentedChoice
                name={FIELD.valueKind}
                label={t("editor.value.label")}
                defaultValue={defaults.valueKind}
                options={[
                  { value: "percentage", label: t("editor.value.percentage") },
                  { value: "fixed", label: t("editor.value.fixed") },
                  { value: "freeShipping", label: t("editor.value.freeShipping") },
                ]}
              />
              <Shown when={valueKind === "percentage"}>
                <s-number-field
                  name={FIELD.percent}
                  label={t("editor.percent.label")}
                  value={defaults.percent}
                  min={0}
                  max={100}
                  suffix="%"
                  inputMode="decimal"
                  error={errorFor(FIELD.percent)}
                />
              </Shown>
              <Shown when={valueKind === "fixed"}>
                <s-stack direction="block" gap="small-200">
                  <s-text color="subdued">{codes.length > 0 ? t("editor.amount.intro") : t("editor.amount.noCurrencies")}</s-text>
                  <CurrencyGrid>
                    {codes.map((c) => (
                      <s-number-field
                        key={c}
                        name={FIELD.amount(c)}
                        label={t("editor.amount.label", { currency: c })}
                        value={defaults.amounts[c] ?? ""}
                        min={0}
                        suffix={c}
                        inputMode="decimal"
                        details={t("editor.amount.details")}
                        error={errorFor(FIELD.amount(c))}
                      />
                    ))}
                  </CurrencyGrid>
                  <FieldMessage text={errorFor("amount")} />
                </s-stack>
              </Shown>
              <Shown when={valueKind === "freeShipping"}>
                <s-text color="subdued">{t("editor.target.freeShippingNote")}</s-text>
              </Shown>
              <div id="target" style={{ display: valueKind === "freeShipping" ? "none" : "block", scrollMarginTop: 16 }}>
                <s-stack direction="block" gap="small-200">
                  <SegmentedChoice
                    name={FIELD.target}
                    label={t("editor.target.label")}
                    defaultValue={defaults.valueKind === "freeShipping" ? "order" : defaults.target}
                    options={[
                      { value: "order", label: t("editor.target.order") },
                      { value: "products", label: t("editor.target.products") },
                      { value: "collections", label: t("editor.target.collections") },
                      { value: "shipping", label: t("editor.target.shipping") },
                    ]}
                  />
                  <Shown when={targetKind === "products"}>
                    <PickerRow
                      label={t("editor.pick.products")}
                      count={productIds.length + defaults.variantIds.length}
                      countText={tr.tp("count.product", productIds.length + defaults.variantIds.length)}
                      onPick={() => void choose("products")}
                      unavailable={pickUnavailable}
                    />
                  </Shown>
                  <Shown when={targetKind === "collections"}>
                    <PickerRow
                      label={t("editor.pick.collections")}
                      count={collectionIds.length}
                      countText={tr.tp("count.collection", collectionIds.length)}
                      onPick={() => void choose("collections")}
                      unavailable={pickUnavailable}
                    />
                  </Shown>
                  {productIds.map((id) => (
                    <input key={id} type="hidden" name={FIELD.productIds} value={id} />
                  ))}
                  {defaults.variantIds.map((id) => (
                    <input key={id} type="hidden" name={FIELD.variantIds} value={id} />
                  ))}
                  {collectionIds.map((id) => (
                    <input key={id} type="hidden" name={FIELD.collectionIds} value={id} />
                  ))}
                  <FieldMessage text={errorFor(FIELD.target)} />
                </s-stack>
              </div>
            </s-stack>
          </WonSection>

          <WonSection
            title={t("editor.section.apply")}
            glyph="code"
            summary={[describeMethod(draft, tr), describeLimits(draft, tr)].filter(Boolean).join(" · ")}
            anchor="codes"
          >
            <s-stack direction="block" gap="base">
              <SegmentedChoice
                name={FIELD.method}
                label={t("editor.method.label")}
                defaultValue={defaults.method}
                options={[
                  { value: "automatic", label: t("editor.method.automatic") },
                  { value: "code", label: t("editor.method.code") },
                ]}
              />
              <Shown when={isCode}>
                <s-text-area
                  name={FIELD.codes}
                  label={t("editor.codes.label")}
                  value={defaults.codes}
                  rows={3}
                  details={t("editor.codes.details")}
                  error={errorFor(FIELD.codes)}
                />
              </Shown>
            </s-stack>
          </WonSection>

          <WonSection
            title={t("editor.more.title")}
            glyph="sliders"
            summary={describeMoreOptions(draft, tr, codes)}
            collapsible
            defaultOpen={moreOpen}
            anchor="more"
          >
            <s-stack direction="block" gap="base">
              <WonBlock title={t("editor.minimum.title")} summary={describeMinimum(draft, tr, codes) || t("describe.minimum.none")}>
                <s-stack direction="block" gap="small-200">
                  {codes.length > 1 ? <s-text color="subdued">{t("editor.minimum.details")}</s-text> : null}
                  <CurrencyGrid>
                    {codes.map((c) => (
                      <s-number-field
                        key={c}
                        name={FIELD.minimum(c)}
                        label={t("editor.minimum.label", { currency: c })}
                        value={defaults.minimums[c] ?? ""}
                        min={0}
                        suffix={c}
                        inputMode="decimal"
                        error={errorFor(FIELD.minimum(c))}
                      />
                    ))}
                    <s-number-field
                      name={FIELD.minQty}
                      label={t("editor.minQty.label")}
                      value={defaults.minQty}
                      min={0}
                      inputMode="numeric"
                      error={errorFor(FIELD.minQty)}
                    />
                  </CurrencyGrid>
                </s-stack>
              </WonBlock>
              <WonBlock title={t("editor.schedule.title")} summary={describeSchedule(draft, tr) || t("describe.schedule.always")}>
                <s-stack direction="block" gap="small-200">
                  <CurrencyGrid>
                    <s-date-field
                      name={FIELD.startDate}
                      label={t("editor.schedule.start")}
                      value={defaults.startDate}
                      error={errorFor(FIELD.startDate)}
                    />
                    <s-date-field
                      name={FIELD.endDate}
                      label={t("editor.schedule.end")}
                      value={defaults.endDate}
                      error={errorFor(FIELD.endDate)}
                    />
                  </CurrencyGrid>
                  <s-text color="subdued">
                    {timezone ? t("editor.schedule.details", { tz: timezone }) : t("editor.schedule.detailsUtc")}
                  </s-text>
                </s-stack>
              </WonBlock>
              <WonBlock
                title={t("editor.limits.title")}
                summary={isCode ? describeLimits(draft, tr) || t("describe.limits.none") : t("editor.limits.codeOnly")}
              >
                <Shown when={isCode}>
                  <s-stack direction="block" gap="small-200">
                    <s-number-field
                      name={FIELD.usageLimit}
                      label={t("editor.limits.usage")}
                      value={defaults.usageLimit}
                      min={1}
                      inputMode="numeric"
                      details={t("editor.limits.usageDetails")}
                      error={errorFor(FIELD.usageLimit)}
                    />
                    <s-checkbox
                      name={FIELD.oncePerCustomer}
                      value="on"
                      label={t("editor.limits.once")}
                      checked={on(defaults.oncePerCustomer)}
                    />
                  </s-stack>
                </Shown>
              </WonBlock>
            </s-stack>
          </WonSection>

          <WonSection
            title={t("editor.pro.title")}
            glyph="target"
            pro
            locked={!pro}
            summary={describeProSettings(draft, tr, ruleNames)}
            collapsible
            defaultOpen={false}
          >
            <s-stack direction="block" gap="base">
              {!pro ? <ProSell benefit={t("editor.pro.benefit")} /> : null}
              <ProFrame locked={!pro}>
                <s-stack direction="block" gap="base">
                  <s-stack direction="block" gap="small-200">
                    <s-text type="strong">{t("editor.pro.markets")}</s-text>
                    {props.marketHandles.length === 0 ? (
                      <s-text color="subdued">{t("editor.pro.marketsNone")}</s-text>
                    ) : (
                      props.marketHandles.map((handle) => (
                        <s-checkbox
                          key={handle}
                          name={FIELD.markets}
                          value={handle}
                          label={handle}
                          checked={on(defaults.markets.includes(handle))}
                          disabled={on(!pro)}
                        />
                      ))
                    )}
                  </s-stack>
                  <s-stack direction="block" gap="small-200">
                    <s-text type="strong">{t("editor.pro.segments")}</s-text>
                    <s-text color="subdued">{t("editor.pro.segmentsNotWired")}</s-text>
                  </s-stack>
                  <s-stack direction="block" gap="small-200">
                    <s-text type="strong">{t("editor.pro.combines")}</s-text>
                    {props.otherRules.length === 0 ? (
                      <s-text color="subdued">{t("editor.pro.combinesNone")}</s-text>
                    ) : (
                      props.otherRules.map((other) => (
                        <s-checkbox
                          key={other.id}
                          name={FIELD.combinesWith}
                          value={other.id}
                          label={other.name || t("common.untitled")}
                          checked={on(defaults.combinesWith.includes(other.id))}
                          disabled={on(!pro)}
                        />
                      ))
                    )}
                  </s-stack>
                </s-stack>
              </ProFrame>
            </s-stack>
          </WonSection>

          <div>
            <s-button type="submit" variant="primary" disabled={on(readOnly)}>
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
            onClick={() => submit({ intent: "delete" }, { method: "post" })}
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

/** Hidden, never unmounted: the fields keep submitting (§17d). */
function Shown({ when, children }: { when: boolean; children: ReactNode }) {
  return <div style={{ display: when ? "block" : "none" }}>{children}</div>;
}

/** Per-currency fields side by side on desktop, stacked on a phone. */
function CurrencyGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 180px), 1fr))", gap: 12 }}>
      {children}
    </div>
  );
}

function FieldMessage({ text }: { text?: string }) {
  if (!text) return null;
  return <div style={{ color: WON_ATTENTION, fontSize: 12.5, fontFamily: WON_FONT }}>{text}</div>;
}

function PickerRow({
  label,
  count,
  countText,
  onPick,
  unavailable,
}: {
  label: string;
  count: number;
  countText: string;
  onPick: () => void;
  unavailable: boolean;
}) {
  const { t } = useT();
  return (
    <s-stack direction="block" gap="small-200">
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-button onClick={onPick}>{label}</s-button>
        <s-text color="subdued">{count > 0 ? countText : t("editor.pick.none")}</s-text>
      </s-stack>
      {unavailable ? <s-text color="subdued">{t("editor.pick.unavailable")}</s-text> : null}
    </s-stack>
  );
}

/**
 * The section's consequence slot (§17 slot 3): what the customer gets in each
 * market currency, from the same draft as the summary. States only what the
 * config guarantees (§17c) — the engine's full "what applies and why" lives in
 * Vyzkoušet košík, one click away.
 */
function CustomerPreview({ draft, codes, tr }: { draft: DiscountRule; codes: string[]; tr: Translator }) {
  const { t } = tr;
  const missing = missingCurrencies(draft, codes);
  const valueIn = (c: string): string => {
    if (draft.value.kind !== "fixed") return describeValue(draft, tr, [c]);
    const minor = draft.value.amount[c];
    return typeof minor === "number" ? describeValue({ ...draft, value: { kind: "fixed", amount: { [c]: minor } } }, tr, [c]) : "";
  };
  const minimumIn = (c: string): string => {
    const subtotal = draft.minimum?.subtotal?.[c];
    return typeof subtotal === "number" && subtotal > 0 ? t("describe.minimum.subtotal", { value: formatMoney(subtotal, c, tr.locale) }) : "";
  };
  return (
    <div
      style={{
        fontFamily: WON_FONT,
        background: WON_WASH,
        border: `1px solid ${WON_LINE}`,
        borderRadius: 12,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, color: WON_MUTED, textTransform: "uppercase", letterSpacing: ".04em" }}>
        {t("editor.preview.title")}
      </div>
      <div style={{ fontSize: 13.5, color: WON_INK }}>
        {t("editor.preview.checkout", { name: ruleName(draft, tr) })}
      </div>
      {codes.map((c) => (
        <div key={c} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 12.5, borderTop: `1px solid ${WON_LINE}`, paddingTop: 6 }}>
          <span style={{ fontWeight: 700, color: WON_INK }}>{c}</span>
          {missing.includes(c) ? (
            <span style={{ color: WON_ATTENTION, textAlign: "right" }}>{t("common.notOffered")}</span>
          ) : (
            <span style={{ color: WON_MUTED, textAlign: "right" }}>
              {[valueIn(c), minimumIn(c)].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
      ))}
      <div style={{ fontSize: 12, color: WON_MUTED }}>{t("editor.preview.unsaved")}</div>
      <div>
        <s-link href="/app/try-cart">{t("editor.preview.try")}</s-link>
      </div>
    </div>
  );
}
