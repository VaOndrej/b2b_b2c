// Pro "Sady pro vybrané produkty a kolekce" (MVP 3; A2/§16: visible, amber,
// never blocking Free; BILL-1: the server gate decides what runs). Each set picks
// products and/or collections with the App Bridge resource picker (titles come
// from Shopify, the ids travel as hidden fields) and has its own counting and
// breaks. Which set a product gets is said once (contract K1): its own set only
// — never the whole-store set as well — the first one naming the product, else
// the first one with its collection. On Free the stored sets stay listed and
// removable (§14a: off ≠ erased), carried as hidden fields, not editable, with
// the names of what they pick; the header says how many are stored and that
// they do not apply. Free sees what the feature is for and the link to the plan
// (ProSell) — never an invented example or a button that does nothing (P2, P8).
// The section is always open (P7: on Pro this is everyday work). A set that
// picks nothing or has no tiers is marked before a save (P3). The checkout's
// room for tiers is said only close to its limit, and the save's "does not fit"
// refusal is shown at that line.
//
// Kolo 3, bod 7 (docs/won-discounts/nakres-bod7-vyjimky.md): the exceptions are a LIST — one row per exception, named
// by what it is for, with what it gives — and only the one being edited is open. A closed exception stays in the
// form (hidden, never unmounted): the page still saves everything with its one Save. "Přidat výjimku" opens the
// product picker straight away and starts from the whole store's levels.

import { useEffect, useState } from "react";

import { CONFIG_LIMITS } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import { exceptionTitle, tierCapacityShown, TIERS_FIELD, tierSummary, type TierCountMode, type TierPayloadUse } from "../model/tiers";
import { amountLabels, type AmountSuggestView } from "../model/markets";
import type { CurrencyView, TierSetView } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { selectionRing, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SURFACE, WON_WASH } from "../shell/tokens";
import { RowNote, WonSection } from "../shell/WonSection";
import { HiddenTierSet, TierSetEditor } from "./TierSetEditor";

const F = TIERS_FIELD;

/** The DOM id of the room-for-tiers line (the page scrolls to it when a save is refused for it). */
export const TIERS_CAPACITY_ANCHOR = "capacity";

/** How many names a list shows before "Zobrazit všech N" (every name is one click away, P4). */
const TITLES_SHOWN = 12;

function TitleList({ items, fallback }: { items: readonly { id: string; title: string }[]; fallback: string }) {
  const tr = useT();
  const [all, setAll] = useState(false);
  if (items.length === 0) return null;
  const shown = all ? items : items.slice(0, TITLES_SHOWN);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
      {shown.map((item) => (
        <s-chip key={item.id}>{item.title.trim() || fallback}</s-chip>
      ))}
      {items.length > TITLES_SHOWN ? (
        <s-button variant="tertiary" onClick={() => setAll((v) => !v)}>
          {all ? tr.t("tiers.pro.titlesLess") : tr.t("tiers.pro.titlesAll", { n: items.length })}
        </s-button>
      ) : null}
    </div>
  );
}

/** The exception's choice "own tiers / no quantity discount" (a UI-only field: the parser reads the tier rows, which "none" does not mount). */
const MODE_FIELD = (sid: string) => `set.${sid}.mode`;

type Mode = "own" | "none";

/** "Co pro ně platí": two cards, each saying what it means (the sketch's stav 2). */
function ModeCards({ sid, value, onPick }: { sid: string; value: Mode; onPick: (mode: Mode) => void }) {
  const { t } = useT();
  const options: readonly { value: Mode; label: string; about: string }[] = [
    { value: "own", label: t("tiers.pro.mode.own"), about: t("tiers.pro.mode.ownAbout") },
    { value: "none", label: t("tiers.pro.mode.none"), about: t("tiers.pro.mode.noneAbout") },
  ];
  return (
    <div style={{ fontFamily: WON_FONT }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: WON_INK, marginBottom: 6 }}>{t("tiers.pro.mode")}</div>
      <div role="radiogroup" aria-label={t("tiers.pro.mode")} data-won-exception-mode style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 200px), 1fr))", gap: 10 }}>
        {options.map((option) => (
          <label key={option.value} style={{ ...selectionRing(value === option.value), position: "relative", display: "block", borderRadius: 12, padding: "10px 12px", cursor: "pointer", minWidth: 0 }}>
            <input
              type="radio"
              name={MODE_FIELD(sid)}
              value={option.value}
              checked={value === option.value}
              onChange={() => onPick(option.value)}
              style={{ position: "absolute", opacity: 0, width: 1, height: 1, margin: 0, pointerEvents: "none" }}
            />
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, color: WON_INK }}>{option.label}</span>
            <span style={{ display: "block", marginTop: 2, fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>{option.about}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function ProTierSets({
  pro,
  sets,
  drafts,
  currencies,
  kept,
  live,
  errorFor,
  errorFields = [],
  onAdd,
  onRemove,
  onPick,
  pickUnavailable,
  onRowsChange,
  productsWithSets = null,
  storedIds,
  capacity,
  capacityError,
  inherit,
  suggest,
}: {
  pro: boolean;
  /** The Pro sets as the page holds them (stored ones + added ones, with picked scopes). */
  sets: readonly TierSetView[];
  /** The live draft of every set (state lines). */
  drafts: readonly TierSetView[];
  currencies: readonly CurrencyView[];
  kept: readonly string[];
  live: (field: string) => string | null;
  errorFor: (field: string) => string | undefined;
  /** The fields a refused save complains about: the exception one of them belongs to opens by itself. */
  errorFields?: readonly string[];
  /** Adds an exception (it starts from the whole store's levels and opens the product picker) and answers its id. */
  onAdd: () => string;
  onRemove: (id: string) => void;
  onPick: (id: string, kind: "products" | "collections") => void;
  pickUnavailable: boolean;
  onRowsChange: () => void;
  /** Pro: products per stored set as the last sync wrote them (null = Free or unknown — nothing is said). */
  productsWithSets?: Readonly<Record<string, number>> | null;
  /** Ids of the sets as stored (a set added on this page has no count yet). */
  storedIds?: ReadonlySet<string>;
  /** How much of the checkout's room for tiers the page's sets take (live; CONFIG_LIMITS.tierPayloadBytes). */
  capacity?: TierPayloadUse;
  /** The save's "the tiers do not fit at checkout" refusal, shown at the room-for-tiers line. */
  capacityError?: string;
  /** How the whole store counts and what kind of discount it gives: an exception takes both over unless it says otherwise. */
  inherit?: { count: TierCountMode; kind: "percent" | "amount" };
  /** The manual rates the amount fields suggest with (návrh 2). */
  suggest?: AmountSuggestView;
}) {
  const tr = useT();
  const { t } = tr;
  const codes = currencies.map((c) => c.code);
  const full = sets.length + 1 >= CONFIG_LIMITS.tierSets;
  const capacityLine = capacity && (tierCapacityShown(capacity) || capacityError !== undefined);
  // Only the exception being edited is open; one a refused save complains about opens by itself.
  const withError = (list: readonly string[]) => sets.find((s) => list.some((f) => f.startsWith(`set.${s.id}.`)))?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(() => withError(errorFields));
  const errorKey = errorFields.join("|");
  useEffect(() => {
    const id = withError(errorFields);
    if (id) setOpenId(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new refusal, not a new array
  }, [errorKey]);
  // "Jiné úrovně" or "Bez množstevní slevy" per exception: what the merchant picked here, else what is stored.
  const [modes, setModes] = useState<Readonly<Record<string, Mode>>>({});
  const modeOf = (set: TierSetView): Mode => modes[set.id] ?? (storedIds?.has(set.id) && set.breaks.length === 0 ? "none" : "own");
  const add = () => setOpenId(onAdd());
  return (
    <WonSection title={t("tiers.pro.title")} glyph="target" pro locked={!pro} summary={t("tiers.view.exceptions.about")} anchor="pro">
      <s-stack direction="block" gap="base">
        {!pro ? <ProSell benefit={t("tiers.pro.benefit")} /> : null}
        {capacity && capacityLine ? (
          // The checkout's room for tiers (audit: cap 550 B) as a share, never bytes — only close to the limit or over it
          // (P2); over it the page cannot be saved, and the save's refusal is shown here (P3).
          <div id={TIERS_CAPACITY_ANCHOR} style={{ scrollMarginTop: 16 }}>
            <s-text type="strong">{t("tiers.capacity", { percent: capacity.percent })}</s-text>
            <RowNote tone={capacity.fits && !capacityError ? undefined : "attention"}>{capacityError ?? t(capacity.fits ? "tiers.capacity.hint" : "tiers.capacity.over")}</RowNote>
          </div>
        ) : null}
        <ProFrame locked={!pro}>
          <s-stack direction="block" gap="base">
            <s-text color="subdued">{t("tiers.pro.body")}</s-text>
            {pro || sets.length > 0 ? <s-text color="subdued">{t("tiers.pro.only")}</s-text> : null}
            {sets.length > 0 ? (
              <div data-won-exceptions style={{ border: `1px solid ${WON_LINE}`, borderRadius: 12, background: WON_SURFACE, overflow: "hidden", fontFamily: WON_FONT }}>
                {sets.map((set, i) => {
                  const draft = drafts.find((d) => d.id === set.id) ?? set;
                  const sid = set.id;
                  const selection = set.scope.kind === "selection";
                  const editable = pro && selection;
                  const open = editable && openId === sid;
                  const mode = modeOf(set);
                  const name = exceptionTitle(set.scope, tr);
                  const gives = mode === "none" ? t("tiers.pro.mode.none") : tierSummary(draft, tr, codes, amountLabels(currencies));
                  const nothingPicked = set.scope.kind === "selection" && set.scope.products.length === 0 && set.scope.collections.length === 0;
                  return (
                    <div key={sid} data-won-exception={open ? "open" : "closed"} style={{ borderTop: i === 0 ? "none" : `1px solid ${WON_LINE}` }}>
                      <input type="hidden" name={F.set} value={sid} />
                      {/* The row: what the exception is for, what it gives, and its two buttons. */}
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px 12px", padding: "10px 12px", background: open ? WON_WASH : "transparent" }}>
                        <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                          <div data-won-exception-name style={{ fontSize: 14, fontWeight: 700, color: WON_INK, overflowWrap: "anywhere" }}>{name}</div>
                          <div data-won-exception-gives style={{ marginTop: 2, fontSize: 13, lineHeight: 1.4, color: WON_MUTED, overflowWrap: "anywhere" }}>{gives}</div>
                          {/* P3: an exception that picks nothing cannot be saved — said in the list too, the row may be closed. */}
                          {editable && nothingPicked && !open ? <RowNote tone="attention">{t("tiers.error.scopeEmpty")}</RowNote> : null}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, flex: "0 0 auto" }}>
                          {editable ? (
                            <s-button variant="secondary" onClick={() => setOpenId(open ? null : sid)} aria-expanded={open ? "true" : "false"}>
                              {t(open ? "tiers.pro.done" : "common.edit")}
                            </s-button>
                          ) : null}
                          <s-button variant="tertiary" onClick={() => onRemove(sid)} accessibilityLabel={t("tiers.pro.removeNamed", { name })}>
                            {t("tiers.pro.removeShort")}
                          </s-button>
                        </div>
                      </div>
                      {set.scope.kind === "global" ? (
                        <div style={{ padding: "0 12px 10px" }}>
                          <HiddenTierSet set={set} />
                          <RowNote tone="attention">{t("tiers.pro.extraGlobal")}</RowNote>
                        </div>
                      ) : !pro ? (
                        <div style={{ padding: "0 12px 10px" }}>
                          <HiddenTierSet set={set} />
                          <RowNote>{t("tiers.pro.free")}</RowNote>
                        </div>
                      ) : (
                        // Closed = out of sight, still in the form: the one Save of the page saves every exception.
                        <div data-won-exception-body style={{ display: open ? "block" : "none", padding: 12, borderTop: `1px solid ${WON_LINE}` }}>
                          <input type="hidden" name={F.scope(sid)} value="selection" />
                          {set.scope.products.map((p) => (
                            <input key={p.id} type="hidden" name={F.product(sid)} value={p.id} />
                          ))}
                          {set.scope.collections.map((c) => (
                            <input key={c.id} type="hidden" name={F.collection(sid)} value={c.id} />
                          ))}
                          <s-stack direction="block" gap="base">
                            {/* One sentence, in words, following every change. */}
                            <div data-won-exception-sentence style={{ fontSize: 13.5, lineHeight: 1.45, color: WON_INK }}>
                              {t("tiers.pro.sentence", { names: name, gives: gives.charAt(0).toLocaleLowerCase(tr.locale) + gives.slice(1) })}
                              {productsWithSets && storedIds?.has(sid) ? <RowNote>{tr.tp("tiers.pro.products", productsWithSets[sid] ?? 0)}</RowNote> : null}
                            </div>
                            <s-stack direction="block" gap="small-200">
                              <s-text type="strong">{t("tiers.pro.forWhat")}</s-text>
                              <TitleList items={set.scope.products} fallback={t("common.untitledProduct")} />
                              <TitleList items={set.scope.collections} fallback={t("common.untitledCollection")} />
                              {/* Shopify's picker takes products or collections, one kind at a time: two buttons. */}
                              <s-stack direction="inline" gap="base" alignItems="center">
                                <s-button onClick={() => onPick(sid, "products")}>{t("editor.pick.products")}</s-button>
                                <s-button onClick={() => onPick(sid, "collections")}>{t("editor.pick.collections")}</s-button>
                              </s-stack>
                              {nothingPicked ? <RowNote tone="attention">{t("tiers.error.scopeEmpty")}</RowNote> : null}
                              {pickUnavailable ? <s-text color="subdued">{t("editor.pick.unavailable")}</s-text> : null}
                              <FieldMessage text={errorFor(F.scope(sid)) ?? errorFor(F.product(sid)) ?? errorFor(F.collection(sid))} />
                            </s-stack>
                            {/* An exception is either own tiers, or no quantity discount at all (a set without tiers: the engine's inert set). */}
                            <ModeCards
                              sid={sid}
                              value={mode}
                              onPick={(next) => {
                                setModes((prev) => ({ ...prev, [sid]: next }));
                                onRowsChange();
                              }}
                            />
                            {mode === "none" ? (
                              // No tier fields are mounted, so nothing is saved as a tier; the counting field keeps the parser's contract.
                              <input type="hidden" name={F.count(sid)} value={set.countAcross} />
                            ) : (
                              <TierSetEditor set={set} currencies={currencies} kept={kept} pro live={live} errorFor={errorFor} onChange={onRowsChange} attempted={errorFields.length > 0} suggest={suggest} inherit={inherit} />
                            )}
                            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                              <s-button variant="primary" onClick={() => setOpenId(null)}>
                                {t("tiers.pro.done")}
                              </s-button>
                              <s-button variant="tertiary" tone="critical" onClick={() => onRemove(sid)}>
                                {t("tiers.pro.remove")}
                              </s-button>
                            </div>
                          </s-stack>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : null}
            {/* Which exception wins matters only once there are two. */}
            {sets.length > 1 ? <s-text color="subdued">{t("tiers.pro.precedence")}</s-text> : null}
            {pro ? (
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button onClick={add} disabled={full ? true : undefined}>
                  {t("tiers.pro.add")}
                </s-button>
                {full ? <s-text color="subdued">{t("tiers.pro.limit", { max: CONFIG_LIMITS.tierSets })}</s-text> : null}
              </s-stack>
            ) : null}
          </s-stack>
        </ProFrame>
      </s-stack>
    </WonSection>
  );
}
