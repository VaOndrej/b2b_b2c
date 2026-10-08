// Množstevní slevy (MVP 3) — the module screen. "Kupte víc, zaplaťte míň": a set of
// quantity breaks (od X ks → % or an amount per item in each market currency,
// MKT-1) for the whole store (Free), and on Pro further sets for selected
// products / collections and counting across the cart (amber, §16, A2). Studio
// shell (§7b, A7):
//   1. Sada pro celý obchod — its live state line (core describeTierSet, §17a,
//      re-read from the form on every native input/change, §2/§17b), counting
//      and the breaks, the honest sentences (A1: a tier never adds up with
//      another product discount — the better one wins; order / shipping add up
//      per the Nastavení switches; margin protection may lower a tier; clearance
//      and gifts get none), and beside it (§17f) the faithful preview of the
//      storefront block (TiersPreview: its markup, CSS and texts, on the live
//      theme's tokens, with the stored Pro custom look and the merchant's
//      texts); the look picked in the preview ("Vzhled na webu") is a field of
//      this form and is SAVED with the page (the same config field Vzhled
//      writes); the Pro custom colours and CSS are one link away;
//   2. Tabulka na stránce produktu — is the block on the product page, the
//      one "Přidat tabulku na stránku produktu" deep link (§13), the storefront
//      config's state (K5), "Zobrazit na mém webu";
//   3. Pro sets (ProTierSets) with the K1 precedence said once.
// One save for the whole form (App Bridge save bar + "Uložit" last on the page,
// like the margin screen); the server parses the same fields (readTiersForm,
// SEC-1). A presentational component: app/routes/app.tiers.tsx renders it from
// loadTiersScreen (app/lib/integration/tiers.server.ts), the dev harness from
// fixtures.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Form, useSubmit } from "react-router";

import { useT } from "../../i18n/context";
import { CardPricesSection } from "../looks/CardPricesSection";
import { LookSection } from "../looks/LookSection";
import { LOOK_FIELD } from "../model/looks";
import { pickCollections, pickProducts } from "../model/app-bridge";
import { amountLabels, currencyCodes } from "../model/markets";
import { freeGlobalSetId, newTierSetId, readTiersForm, tierPayloadUse, tierSetToConfig, TIERS_FIELD, TIERS_INTENT, tierSummary, blockText } from "../model/tiers";
import type { FieldError, TierSetView, TiersScreenData, UiResult } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { snapshotOf } from "../shell/form-snapshot";
import { GateNotes } from "../shell/GateNotes";
import { Notice } from "../shell/Notice";
import { ModuleTiles, ViewTile } from "../shell/ModuleTile";
import { useView, ViewPanel } from "../shell/views";
import { DiscountsSubNav } from "../shell/SubNav";
import { RowNote, WonSection } from "../shell/WonSection";
import { ProTierSets, TIERS_CAPACITY_ANCHOR } from "../tiers/ProTierSets";
import { TierSetEditor } from "../tiers/TierSetEditor";
import { TiersBlockSection } from "../tiers/TiersBlockSection";
import { TiersPreview, TiersPreviewStyles } from "../tiers/TiersPreview";

const F = TIERS_FIELD;

export interface TiersScreenProps extends TiersScreenData {
  /** The last save outcome. */
  result?: UiResult | null;
}

/** Currencies with a stored amount whose market is not enabled (kept, §14a). */
function keptCurrencies(sets: readonly TierSetView[], enabled: readonly string[]): string[] {
  const out = new Set<string>();
  for (const set of sets) for (const b of set.breaks) for (const code of Object.keys(b.amount)) if (!enabled.includes(code)) out.add(code);
  return [...out];
}

function HonestNotes({ marginOn, competingRules, outletWithAnything }: { marginOn: boolean; competingRules: number; outletWithAnything: boolean }) {
  const tr = useT();
  const { t } = tr;
  return (
    <s-stack direction="block" gap="small-200">
      <s-text color="subdued">
        {t("tiers.honest.best")}
        {competingRules > 0 ? ` ${tr.tp("tiers.honest.competing", competingRules)}` : ""} <s-link href="/app/discounts">{t("nav.discounts")}</s-link>
      </s-text>
      <s-text color="subdued">
        {t("tiers.honest.combine")} <s-link href="/app/settings#combination">{t("settings.combination.title")}</s-link>
      </s-text>
      {marginOn ? (
        <s-text color="subdued">
          {t("tiers.honest.margin")} <s-link href="/app/margin">{t("module.margin")}</s-link>
        </s-text>
      ) : null}
      {/* Clearance lines are left out unless the Nastavení switch lets them combine (engine.combination); gifts always (K2). */}
      <s-text color="subdued">{t(outletWithAnything ? "tiers.honest.excludedOutlet" : "tiers.honest.excluded")}</s-text>
    </s-stack>
  );
}

export function TiersScreen(props: TiersScreenProps) {
  const { plan, shopCurrency, configVersion, currencies, sets, gateNotes, marginOn, competingRules, block, storefront, preview, result } = props;
  const pro = plan === "pro";
  const tr = useT();
  const { t } = tr;
  const codes = useMemo(() => currencyCodes(currencies), [currencies]);
  const kept = useMemo(() => keptCurrencies(sets, codes), [sets, codes]);

  // The whole-store set the page edits on top (a new shop gets an empty one; saved without tiers it is not stored).
  const [globalSet] = useState<TierSetView>(
    () =>
      sets.find((s) => s.scope.kind === "global") ?? {
        // Deterministic (never a random id here): the server render and the browser's first render must agree.
        id: freeGlobalSetId(sets),
        scope: { kind: "global" },
        countAcross: "product",
        breaks: [],
      },
  );
  const [proSets, setProSets] = useState<TierSetView[]>(() => sets.filter((s) => s.id !== globalSet.id));
  const storedIds = useMemo(() => new Set(sets.map((s) => s.id)), [sets]);

  // §2/§17b: the live draft, re-read from the whole form on native events.
  const formRef = useRef<HTMLFormElement>(null);
  const [snapshot, setSnapshot] = useState<Map<string, string> | null>(null);
  const titles = useMemo(() => {
    const map = new Map<string, string>();
    for (const set of proSets) if (set.scope.kind === "selection") for (const item of [...set.scope.products, ...set.scope.collections]) map.set(item.id, item.title);
    return map;
  }, [proSets]);
  const [draft, setDraft] = useState<TierSetView[]>(sets);
  // Rows the form holds per set (a typed row that is not complete yet is in the form, not in the draft).
  const [rowCounts, setRowCounts] = useState<Map<string, number> | null>(null);
  const recompute = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    setSnapshot(snapshotOf(form));
    const data = new FormData(form);
    setRowCounts(new Map(data.getAll(F.set).map((id) => [String(id), data.getAll(F.row(String(id))).length])));
    // A kept set (not edited on this page) is the one shown, never re-parsed (audit P3-4).
    const keep = (id: string) => proSets.find((s) => s.id === id) ?? sets.find((s) => s.id === id);
    setDraft(readTiersForm(new FormData(form), { currencies: codes, keptCurrencies: kept, titles, keep }).sets);
  }, [codes, kept, titles, proSets, sets]);
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
  // A set or a row added / removed, a pick: re-read once React has rendered the fields.
  const touched = useRef(false);
  const reread = useCallback(() => {
    touched.current = true;
    window.setTimeout(recompute, 0);
  }, [recompute]);
  useEffect(() => {
    if (touched.current) recompute();
  }, [proSets, recompute]);
  const live = useCallback((field: string) => snapshot?.get(field) ?? null, [snapshot]);

  // Pro sets: add, remove, pick products / collections (App Bridge; unavailable outside Shopify admin).
  const [pickUnavailable, setPickUnavailable] = useState(false);
  // Bod 7: a new exception starts from the whole store's levels and counting (the merchant rewrites only the numbers)
  // and goes straight to the product picker.
  const addSet = (): string => {
    touched.current = true;
    const from = draft.find((s) => s.id === globalSet.id) ?? globalSet;
    const added: TierSetView = { id: newTierSetId(), scope: { kind: "selection", products: [], collections: [] }, countAcross: from.countAcross, breaks: from.breaks.map((b) => ({ ...b, amount: { ...b.amount } })) };
    setProSets((list) => [...list, added]);
    void pick(added.id, "products", added);
    return added.id;
  };
  const removeSet = (id: string) => {
    touched.current = true;
    setProSets((list) => list.filter((s) => s.id !== id));
  };
  const pick = async (id: string, kind: "products" | "collections", added?: TierSetView) => {
    const set = added ?? proSets.find((s) => s.id === id);
    if (!set || set.scope.kind !== "selection") return;
    const res =
      kind === "products"
        ? await pickProducts(
            set.scope.products.map((p) => p.id),
            { variants: false },
          )
        : await pickCollections(set.scope.collections.map((c) => c.id));
    if (!res.ok) {
      if (res.reason === "unavailable") setPickUnavailable(true);
      return;
    }
    touched.current = true;
    const items = res.items.map((item) => ({ id: item.id, title: item.title }));
    setProSets((list) =>
      list.map((s) => (s.id !== id || s.scope.kind !== "selection" ? s : { ...s, scope: { ...s.scope, [kind]: items } })),
    );
  };

  // "Discard" in the App Bridge save bar resets the form: remount with the stored sets.
  const [formKey, setFormKey] = useState(0);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const onReset = () => {
      setFormKey((k) => k + 1);
      setProSets(sets.filter((s) => s.id !== globalSet.id));
      setDraft(sets);
      setSnapshot(null);
      setRowCounts(null);
      window.setTimeout(recompute, 0);
    };
    el.addEventListener("reset", onReset);
    return () => el.removeEventListener("reset", onReset);
  }, [sets, globalSet.id, recompute]);

  const errors: FieldError[] = result && !result.ok && result.reason === "invalid" ? result.errors : [];
  const errorFor = (field: string): string | undefined => {
    const e = errors.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };

  const submit = useSubmit();
  // I3: "Nahradit neplatnou konfiguraci" re-submits exactly this form, confirmed.
  const replaceUnreadable = () => {
    const form = formRef.current;
    if (!form) return;
    const data = new FormData(form);
    data.set(F.replaceUnreadable, "1");
    submit(data, { method: "post" });
  };

  const globalDraft = draft.find((s) => s.id === globalSet.id) ?? globalSet;
  // The checkout's room for tiers, live from what is typed (the server refuses a save over it).
  const capacity = useMemo(() => tierPayloadUse(draft.map(tierSetToConfig)), [draft]);
  const hasTiers = globalDraft.breaks.length > 0;
  // Typed rows that do not count yet (P3/P5): said in the state line, marked at the row (TierSetEditor).
  const incomplete = Math.max(0, (rowCounts?.get(globalSet.id) ?? globalDraft.breaks.length) - globalDraft.breaks.length);
  // N8: the label is about what is STORED. While the form holds no finished level (the kind was just switched), a
  // green "Aktivní" next to "Bez množstevních slev" contradicts itself — the tile then shows the sentence alone.
  const globalTileStatus = props.status?.global?.state === "active" && !hasTiers ? undefined : props.status?.global;
  const globalSummary = incomplete > 0 ? `${tierSummary(globalDraft, tr, codes, amountLabels(currencies))} · ${tr.tp("tiers.incomplete", incomplete)}` : tierSummary(globalDraft, tr, codes, amountLabels(currencies));
  // "The tiers do not fit at checkout" is shown at the room-for-tiers line (P3); the page scrolls to it.
  const tooLarge = errors.find((e) => e.field === F.set && e.key === "tiers.error.tooLarge");
  const capacityError = tooLarge ? t(tooLarge.key, tooLarge.params) : undefined;
  const pageError = errors.find((e) => e.field === F.set && e.key !== "tiers.error.tooLarge");
  const [view, setView] = useView<"global" | "table" | "exceptions">({
    initial: () => "global",
    hash: { global: "global", block: "table", pro: "exceptions", [TIERS_CAPACITY_ANCHOR]: "exceptions" },
    resetKey: result,
  });
  useEffect(() => {
    if (!capacityError) return;
    setView("exceptions");
    const timer = window.setTimeout(() => document.getElementById(TIERS_CAPACITY_ANCHOR)?.scrollIntoView({ block: "center" }), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setView is stable
  }, [capacityError]);

  return (
    <s-page heading={t("module.tiers")}>
      <DiscountsSubNav active="tiers" />
      <Form method="post" ref={formRef} data-save-bar>
        <input type="hidden" name={F.intent} value={TIERS_INTENT.save} />
        {configVersion ? <input type="hidden" name={F.configVersion} value={configVersion} /> : null}
        <s-stack key={formKey} direction="block" gap="base">
          <Notice result={result} onReplace={replaceUnreadable} />
          {/* A refusal about the page as a whole (a stale form, too many sets) — at the top, not in a section. */}
          <FieldMessage text={pageError ? t(pageError.key, pageError.params) : undefined} />
          {gateNotes.length > 0 ? <GateNotes notes={gateNotes} /> : null}
          <input type="hidden" name={F.set} value={globalSet.id} />
          <input type="hidden" name={F.scope(globalSet.id)} value="global" />
          {/* Three tiles, one panel at a time (doctrine §19e); the panels stay in the one form with its one Save. */}
          <ModuleTiles label={t("tiers.view.label")}>
            <ViewTile id="global" title={t("tiers.view.global.title")} glyph="layers" active={globalSummary} status={globalTileStatus} selected={view === "global"} onPick={() => setView("global")} />
            <ViewTile id="table" title={t("tiers.view.table.title")} glyph="store" active={blockText(block, tr)} selected={view === "table"} onPick={() => setView("table")} />
            <ViewTile
              id="exceptions"
              title={t("tiers.view.exceptions.title")}
              glyph="target"
              active={proSets.length === 0 ? t("tiers.pro.none") : pro ? tr.tp("count.tierSet", proSets.length) : tr.tp("tiers.pro.storedFree", proSets.length)}
              status={pro && proSets.length > 0 ? props.status?.sets : undefined}
              pro={!pro}
              locked={!pro}
              selected={view === "exceptions"}
              onPick={() => setView("exceptions")}
            />
          </ModuleTiles>
          <ViewPanel id="global" view={view}>
          <WonSection
            title={t("tiers.global.title")}
            glyph="layers"
            // The label and the sentence of what is set are on the tile above (§19e); here only what the section is for.
            hint={t("tiers.global.hint")}
            anchor="global"
            aside={
              <div style={{ display: "grid", gap: 10 }}>
                <TiersPreview
                  set={hasTiers ? globalDraft : null}
                  preset={preview.preset}
                  tokens={preview.tokens}
                  product={preview.product}
                  currency={shopCurrency}
                  controls
                  extras={preview.look ?? null}
                  marginOn={marginOn}
                  embed={props.embed ?? null}
                />
                {/* The table's look, colour and (Pro) own CSS are picked in "Tabulka na webu"; the preview above shows what is stored. */}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <s-link href="#look-tiers" onClick={() => setView("table")}>
                    {t("tiers.preview.customLink")}
                  </s-link>
                </div>
              </div>
            }
          >
            <s-stack direction="block" gap="base">
              <TierSetEditor set={globalSet} currencies={currencies} kept={kept} pro={pro} live={live} errorFor={errorFor} onChange={reread} attempted={errors.length > 0} suggest={props.suggest} />
              <HonestNotes marginOn={marginOn} competingRules={competingRules} outletWithAnything={props.outletWithAnything === true} />
            </s-stack>
          </WonSection>
          </ViewPanel>
          <ViewPanel id="table" view={view}>
            <TiersBlockSection block={block} storefront={storefront} product={preview.product} about={t("tiers.view.table.about")} />
          </ViewPanel>
          <ViewPanel id="exceptions" view={view}>
          <ProTierSets
            pro={pro}
            sets={proSets}
            drafts={draft}
            currencies={currencies}
            kept={kept}
            live={live}
            errorFor={errorFor}
            errorFields={errors.map((e) => e.field)}
            inherit={{ count: globalDraft.countAcross, kind: globalDraft.breaks[0]?.kind ?? "percent" }}
            suggest={props.suggest}
            onAdd={addSet}
            onRemove={removeSet}
            onPick={(id, kind) => void pick(id, kind)}
            pickUnavailable={pickUnavailable}
            onRowsChange={reread}
            productsWithSets={pro ? (props.productsWithSets ?? null) : null}
            storedIds={storedIds}
            capacity={capacity}
            capacityError={capacityError}
          />
          </ViewPanel>
          {/* One save for the whole form, last on the page (plus the App Bridge save bar). */}
          <div>
            <s-button type="submit" variant="primary">
              {t("common.save")}
            </s-button>
          </div>
        </s-stack>
      </Form>
      {/* The table's look: its own form, so outside the page's (the same view as "Tabulka na webu"). */}
      <div style={{ marginTop: 16 }}>
        <ViewPanel id="table" view={view}>
          {props.look ? (
            <LookSection
              look={props.look}
              plan={plan}
              configVersion={configVersion}
              embed={props.embed}
              preview={(customCss) => (
                <>
                  <TiersPreviewStyles customCss={customCss || null} />
                  <TiersPreview set={hasTiers ? globalDraft : null} preset={preview.preset} tokens={preview.tokens} product={preview.product} currency={shopCurrency} bare controls lookField={LOOK_FIELD.preset} accentField={LOOK_FIELD.accentPreset} withStyles={false} extras={{ ...(preview.look ?? { texts: {} }), customCss: customCss || null }} embed={props.embed ?? null} />
                  <RowNote>{t("looks.tiers.where")}</RowNote>
                </>
              )}
            />
          ) : null}
          {props.cards ? <CardPricesSection cardPrices={props.cards.on} cardBlockUrl={props.cards.blockUrl} configVersion={configVersion} /> : null}
        </ViewPanel>
      </div>
    </s-page>
  );
}
