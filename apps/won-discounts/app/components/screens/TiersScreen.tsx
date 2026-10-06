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
import { pickCollections, pickProducts } from "../model/app-bridge";
import { currencyCodes } from "../model/markets";
import { freeGlobalSetId, newTierSetId, readTiersForm, tierPayloadUse, tierSetToConfig, TIERS_FIELD, TIERS_INTENT, tierSummary } from "../model/tiers";
import type { FieldError, TierSetView, TiersScreenData, UiResult } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { GateNotes } from "../shell/GateNotes";
import { Notice } from "../shell/Notice";
import { PlanBadge } from "../shell/PlanBadge";
import { DiscountsSubNav } from "../shell/SubNav";
import { WonSection } from "../shell/WonSection";
import { ProTierSets, TIERS_CAPACITY_ANCHOR } from "../tiers/ProTierSets";
import { TierSetEditor } from "../tiers/TierSetEditor";
import { TiersBlockSection } from "../tiers/TiersBlockSection";
import { TiersPreview } from "../tiers/TiersPreview";

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

/** The last read value of every field (the first one of a name). */
function snapshotOf(form: HTMLFormElement): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, value] of new FormData(form).entries()) if (!out.has(name) && typeof value === "string") out.set(name, value);
  return out;
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
  const addSet = () => {
    touched.current = true;
    setProSets((list) => [...list, { id: newTierSetId(), scope: { kind: "selection", products: [], collections: [] }, countAcross: "product", breaks: [] }]);
  };
  const removeSet = (id: string) => {
    touched.current = true;
    setProSets((list) => list.filter((s) => s.id !== id));
  };
  const pick = async (id: string, kind: "products" | "collections") => {
    const set = proSets.find((s) => s.id === id);
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
  const globalSummary = incomplete > 0 ? `${tierSummary(globalDraft, tr, codes)} · ${tr.tp("tiers.incomplete", incomplete)}` : tierSummary(globalDraft, tr, codes);
  // "The tiers do not fit at checkout" is shown at the room-for-tiers line (P3); the page scrolls to it.
  const tooLarge = errors.find((e) => e.field === F.set && e.key === "tiers.error.tooLarge");
  const capacityError = tooLarge ? t(tooLarge.key, tooLarge.params) : undefined;
  const pageError = errors.find((e) => e.field === F.set && e.key !== "tiers.error.tooLarge");
  useEffect(() => {
    if (capacityError) document.getElementById(TIERS_CAPACITY_ANCHOR)?.scrollIntoView({ block: "center" });
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
          <WonSection
            title={t("tiers.global.title")}
            glyph="layers"
            summary={globalSummary}
            hint={t("tiers.global.hint")}
            // The stored state, the same as the home tile says (an unsaved row does not change it).
            state={props.status?.global}
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
                  lookField={F.preset}
                  extras={preview.look ?? null}
                  marginOn={marginOn}
                />
                {/* Pro: colours, corners and the shop's own CSS live on Vzhled; the preview above already shows them. */}
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                  <s-link href="/app/appearance#custom">{t("tiers.preview.customLink")}</s-link>
                  {pro ? null : <PlanBadge tier="pro" locked href="/app/plan" />}
                </div>
              </div>
            }
          >
            <s-stack direction="block" gap="base">
              <TierSetEditor set={globalSet} currencies={currencies} kept={kept} pro={pro} live={live} errorFor={errorFor} onChange={reread} />
              <HonestNotes marginOn={marginOn} competingRules={competingRules} outletWithAnything={props.outletWithAnything === true} />
            </s-stack>
          </WonSection>
          <TiersBlockSection block={block} storefront={storefront} product={preview.product} />
          <ProTierSets
            pro={pro}
            sets={proSets}
            drafts={draft}
            currencies={currencies}
            kept={kept}
            live={live}
            errorFor={errorFor}
            onAdd={addSet}
            onRemove={removeSet}
            onPick={(id, kind) => void pick(id, kind)}
            pickUnavailable={pickUnavailable}
            onRowsChange={reread}
            productsWithSets={pro ? (props.productsWithSets ?? null) : null}
            storedIds={storedIds}
            capacity={capacity}
            capacityError={capacityError}
            status={props.status?.sets}
          />
          {/* One save for the whole form, last on the page (plus the App Bridge save bar). */}
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
