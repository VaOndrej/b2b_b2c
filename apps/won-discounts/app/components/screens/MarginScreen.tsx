// Ochrana marže (MVP 2) — the module screen. A Won discount never takes a price
// below the floor the merchant sets here; protection never blocks an order, it
// only lowers the discount to the floor (spec principle 5). Until the first
// complete read of the purchase costs, unread products have only the percent
// ceiling — the settings section says so (audit P2-1). Studio shell (§7b, A7):
//   1. the settings — on/off, minimum margin (how it is computed, said in the
//      field), the ceiling for products without a cost price (A2) — leading
//      with the live state line (§17b: re-read from the form on every native
//      input/change event, §2) and the §10 proof beside it (§17f);
//   2. Nákupní ceny — how many products lack a cost, which, and how fresh the
//      cost mirror is, with the one "Obnovit nákupní ceny" button (§13);
//   3. Pro (amber, visible, never blocking Free — A2, §16): settings per
//      collection and Přehled zásahů (read-only). BILL-1 on the server: Free
//      gets no impact data, only the sample preview.
// One save for the whole form, like the rule editor: the App Bridge save bar
// (`data-save-bar`) and "Uložit" as the last thing on the page — never between
// sections, so it cannot read as saving only the section above it.
// Percents keep ONE decimal (the core sanitizer rounds to the stricter side):
// the fields step by a tenth and a second decimal is refused before the save
// (model/margin.ts marginDecimalErrors), so no value changes silently (§12);
// whatever the sanitizer still adjusts comes back as the save's `fixes` (Notice).
// A presentational component: app/routes/app.margin.tsx renders it from
// loadMarginScreen (app/lib/integration/margin.server.ts), the dev harness from
// fixtures (app/routes/dev.preview.$.tsx).

import { useCallback, useEffect, useRef, useState } from "react";
import { Form, useSubmit } from "react-router";

import { CONFIG_LIMITS } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import { pickCollections } from "../model/app-bridge";
import {
  ceilingOnlyText,
  MARGIN_FIELD,
  MARGIN_INTENT,
  MARGIN_PERCENT_STEP,
  marginDecimalErrors,
  marginInForce,
  marginSummary,
  percentInput,
  readMarginDraft,
} from "../model/margin";
import type { FieldError, MarginCollectionView, MarginScreenData, MarginSettingsView, UiResult } from "../model/types";
import { CollectionsSection } from "../margin/CollectionsSection";
import { CostsSection } from "../margin/CostsSection";
import { ImpactSection } from "../margin/ImpactSection";
import { MarginProof } from "../margin/MarginProof";
import { FieldMessage } from "../rule-editor/parts";
import { boolAttr } from "../shell/attrs";
import { Notice } from "../shell/Notice";
import { WonSection } from "../shell/WonSection";

export interface MarginScreenProps extends MarginScreenData {
  /** The last save / refresh outcome. */
  result?: UiResult | null;
}

export function MarginScreen(props: MarginScreenProps) {
  const { plan, shopCurrency, configVersion, settings, mirror, coverage, impact, gateNotes, result, tooLarge } = props;
  const pro = plan === "pro";
  const tr = useT();
  const { t } = tr;

  // §2/§17b: the live draft, re-read from the whole form on native events.
  const formRef = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<MarginSettingsView>(settings);
  // Percents typed with a second decimal, said at the field while typing (the save is refused until fixed).
  const [decimalErrors, setDecimalErrors] = useState<FieldError[]>([]);
  const recompute = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    setDraft(readMarginDraft(data, settings));
    setDecimalErrors(marginDecimalErrors(data));
  }, [settings]);
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

  // Collections: the resource picker (App Bridge seam) feeds the rows; a pick keeps typed values.
  const [collections, setCollections] = useState<MarginCollectionView[]>(settings.collections);
  const [pickUnavailable, setPickUnavailable] = useState(false);
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current) recompute();
  }, [collections, recompute]);
  const pick = async () => {
    const res = await pickCollections(collections.map((c) => c.collectionId));
    if (!res.ok) {
      if (res.reason === "unavailable") setPickUnavailable(true);
      return;
    }
    touched.current = true;
    const typed = new Map(readMarginDraft(new FormData(formRef.current ?? undefined), settings).collections.map((c) => [c.collectionId, c]));
    const known = new Map(collections.map((c) => [c.collectionId, c]));
    setCollections(
      res.items.slice(0, CONFIG_LIMITS.marginOverrides).map((item) => {
        const prev = typed.get(item.id) ?? known.get(item.id);
        return {
          collectionId: item.id,
          title: item.title || prev?.title || item.id,
          minMarginPercent: prev?.minMarginPercent ?? null,
          maxDiscountPercent: prev?.maxDiscountPercent ?? null,
        };
      }),
    );
  };
  const remove = (collectionId: string) => {
    touched.current = true;
    setCollections((list) => list.filter((c) => c.collectionId !== collectionId));
  };

  // "Discard" in the App Bridge save bar resets the form: remount the fields
  // with the stored values so the rows, the summary and the proof go back together.
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const onReset = () => {
      setFormKey((k) => k + 1);
      setDraft(settings);
      setCollections(settings.collections);
      window.setTimeout(recompute, 0);
    };
    el.addEventListener("reset", onReset);
    return () => el.removeEventListener("reset", onReset);
  }, [settings, recompute]);

  const errors: FieldError[] = result && !result.ok && result.reason === "invalid" ? result.errors : [];
  /** The server's refusal, on the field itself (it arrives with a full render). */
  const errorFor = (field: string): string | undefined => {
    const e = errors.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };
  // The live decimal check is said UNDER the field, never through its `error`
  // attribute: a Polaris field re-rendered mid-typing goes back to its initial
  // value (seen in the harness), which would silently undo what was typed.
  const decimalErrorFor = (field: string): string | undefined => {
    const e = decimalErrors.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };
  /** A second decimal never reaches the server (it would be rounded, §12): the save waits until it is fixed. */
  const blockedByDecimals = (): boolean => {
    const form = formRef.current;
    if (!form) return false;
    const found = marginDecimalErrors(new FormData(form));
    setDecimalErrors(found);
    return found.length > 0;
  };
  // A collection error not tied to one row (readMarginForm indexes row errors: `collectionMax[1]`).
  const collectionError = errors.find((e) => e.field.startsWith("collection") && !/\[\d+\]$/.test(e.field));
  // What the plan runs (Free folds collection settings into the global values):
  // the proof and the ceiling sentence show THAT, like the state line (§10b, §17c).
  const global = marginInForce(draft, plan).global;
  const inForce: MarginSettingsView = { ...draft, minMarginPercent: global.minMarginPercent ?? null, maxDiscountPercent: global.maxDiscountPercent };
  // Audit P2-1: before the first complete read of the costs, unread products have only the ceiling (what is STORED runs).
  const storedCeiling = marginInForce(settings, plan).global.maxDiscountPercent;
  const ceilingOnly = ceilingOnlyText({ enabled: settings.enabled, mirror, costsKnown: coverage !== null, maxDiscountPercent: storedCeiling }, tr);

  const submit = useSubmit();
  // I3: "Nahradit neplatnou konfiguraci" re-submits exactly this form, confirmed.
  const replaceUnreadable = () => {
    const form = formRef.current;
    if (!form || blockedByDecimals()) return;
    const data = new FormData(form);
    data.set(MARGIN_FIELD.replaceUnreadable, "1");
    submit(data, { method: "post" });
  };

  return (
    <s-page heading={t("module.margin")}>
      <Form
        method="post"
        ref={formRef}
        data-save-bar
        onSubmit={(event) => {
          if (blockedByDecimals()) event.preventDefault();
        }}
      >
        <input type="hidden" name={MARGIN_FIELD.intent} value={MARGIN_INTENT.save} />
        {configVersion ? <input type="hidden" name={MARGIN_FIELD.configVersion} value={configVersion} /> : null}
        <s-stack key={formKey} direction="block" gap="base">
          <Notice result={result} onReplace={replaceUnreadable} />
          <WonSection
            title={t("module.margin")}
            glyph="shield"
            summary={marginSummary(draft, plan, tr)}
            // §11d/§12: green "Běží" only where the sync facts say it runs (the
            // Přehled card knows them); this screen has none, so "on" shows no
            // pill — the state line says it — and "off" shows "Vypnuto".
            on={draft.enabled ? undefined : false}
            hint={t("soon.margin")}
            anchor="settings"
            aside={<MarginProof settings={inForce} currency={shopCurrency} />}
          >
            <s-stack direction="block" gap="base">
              <s-switch name={MARGIN_FIELD.enabled} value="on" label={t("margin.enabled")} checked={boolAttr(settings.enabled)} />
              <s-stack direction="block" gap="small-200">
                <s-text color="subdued">{t("margin.never")}</s-text>
                {/* Honest scope (§12): discounts outside Won are not seen by the protection; the fix is on Přehled (§13c). */}
                <s-text color="subdued">
                  {t("margin.scope")} <s-link href="/app#native">{t("margin.scope.link")}</s-link>
                </s-text>
                {/* §12: until the first complete read, the ceiling is all there is for unread products (also those with a cost). */}
                {ceilingOnly ? <s-text type="strong">{ceilingOnly}</s-text> : null}
              </s-stack>
              <s-number-field
                name={MARGIN_FIELD.minMarginPercent}
                label={t("margin.min.label")}
                value={percentInput(settings.minMarginPercent)}
                min={0}
                max={95}
                step={MARGIN_PERCENT_STEP}
                suffix="%"
                inputMode="decimal"
                details={t("margin.min.details")}
                error={errorFor(MARGIN_FIELD.minMarginPercent)}
              />
              <FieldMessage text={decimalErrorFor(MARGIN_FIELD.minMarginPercent)} />
              <s-number-field
                name={MARGIN_FIELD.maxDiscountPercent}
                label={t("margin.max.label")}
                value={percentInput(settings.maxDiscountPercent)}
                min={0}
                max={100}
                step={MARGIN_PERCENT_STEP}
                suffix="%"
                inputMode="decimal"
                details={t("margin.max.details")}
                error={errorFor(MARGIN_FIELD.maxDiscountPercent)}
              />
              <FieldMessage text={decimalErrorFor(MARGIN_FIELD.maxDiscountPercent)} />
              <FieldMessage text={errorFor(MARGIN_FIELD.enabled)} />
            </s-stack>
          </WonSection>
          <CostsSection coverage={coverage} mirror={mirror} maxDiscountPercent={inForce.maxDiscountPercent} />
          <CollectionsSection
            pro={pro}
            collections={collections}
            gateNotes={gateNotes}
            onPick={() => void pick()}
            onRemove={remove}
            pickUnavailable={pickUnavailable}
            errorFor={errorFor}
            decimalErrorFor={decimalErrorFor}
            error={collectionError ? t(collectionError.key, collectionError.params) : undefined}
            tooLarge={tooLarge}
          />
          <ImpactSection pro={pro} enabled={settings.enabled} impact={impact} currency={shopCurrency} />
          {/* One save for the whole form, last on the page like the rule editor (plus the App Bridge save bar). */}
          <div>
            <s-button type="submit" variant="primary">
              {t("common.save")}
            </s-button>
          </div>
        </s-stack>
      </Form>
    </s-page>
  );
}
