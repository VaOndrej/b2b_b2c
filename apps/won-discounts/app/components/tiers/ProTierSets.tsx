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

import { useState } from "react";

import { CONFIG_LIMITS } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import { scopeSummary, tierCapacityShown, TIERS_FIELD, tierSummary, type TierPayloadUse } from "../model/tiers";
import type { ModuleStatus } from "../model/module-status";
import type { CurrencyView, TierSetView } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { RowNote, WonBlock, WonSection } from "../shell/WonSection";
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

export function ProTierSets({
  pro,
  sets,
  drafts,
  currencies,
  kept,
  live,
  errorFor,
  onAdd,
  onRemove,
  onPick,
  pickUnavailable,
  onRowsChange,
  productsWithSets = null,
  storedIds,
  capacity,
  capacityError,
  status,
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
  onAdd: () => void;
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
  /** The stored exceptions' state (model/module-status.ts); "locked" on Free is said by the Pro marker. */
  status?: ModuleStatus;
}) {
  const tr = useT();
  const { t } = tr;
  const codes = currencies.map((c) => c.code);
  const full = sets.length + 1 >= CONFIG_LIMITS.tierSets;
  // §17c: on Free no Pro set is in force, whatever is stored — the header says how many are stored and that they do not apply.
  const summary = sets.length === 0 ? t("tiers.pro.none") : pro ? tr.tp("count.tierSet", sets.length) : tr.tp("tiers.pro.storedFree", sets.length);
  const capacityLine = capacity && (tierCapacityShown(capacity) || capacityError !== undefined);
  return (
    <WonSection title={t("tiers.pro.title")} glyph="target" pro locked={!pro} state={sets.length > 0 ? status : undefined} summary={summary} anchor="pro">
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
            {pro || sets.length > 0 ? <s-text color="subdued">{t("tiers.pro.precedence")}</s-text> : null}
            {sets.map((set, i) => {
              const draft = drafts.find((d) => d.id === set.id) ?? set;
              const sid = set.id;
              return (
                <WonBlock key={sid} title={t("tiers.pro.set", { n: i + 1 })} summary={`${scopeSummary(set.scope, tr)} · ${tierSummary(draft, tr, codes)}`}>
                  <input type="hidden" name={F.set} value={sid} />
                  <s-stack direction="block" gap="base">
                    {set.scope.kind === "global" ? <RowNote tone="attention">{t("tiers.pro.extraGlobal")}</RowNote> : null}
                    {productsWithSets && storedIds?.has(sid) && set.scope.kind === "selection" ? (
                      <RowNote>{tr.tp("tiers.pro.products", productsWithSets[sid] ?? 0)}</RowNote>
                    ) : null}
                    {pro ? (
                      <>
                        {set.scope.kind === "global" ? (
                          <HiddenTierSet set={set} />
                        ) : (
                          <>
                            <input type="hidden" name={F.scope(sid)} value="selection" />
                            {set.scope.products.map((p) => (
                              <input key={p.id} type="hidden" name={F.product(sid)} value={p.id} />
                            ))}
                            {set.scope.collections.map((c) => (
                              <input key={c.id} type="hidden" name={F.collection(sid)} value={c.id} />
                            ))}
                            <s-stack direction="block" gap="small-200">
                              <s-text type="strong">{t("tiers.pro.forWhat")}</s-text>
                              <s-stack direction="inline" gap="base" alignItems="center">
                                <s-button onClick={() => onPick(sid, "products")}>{t("editor.pick.products")}</s-button>
                                <s-button onClick={() => onPick(sid, "collections")}>{t("editor.pick.collections")}</s-button>
                              </s-stack>
                              <TitleList items={set.scope.products} fallback={t("common.untitledProduct")} />
                              <TitleList items={set.scope.collections} fallback={t("common.untitledCollection")} />
                              {/* P3: a set that picks nothing cannot be saved — said at the pick, before the save. */}
                              {set.scope.products.length === 0 && set.scope.collections.length === 0 ? <RowNote tone="attention">{t("tiers.error.scopeEmpty")}</RowNote> : null}
                              {pickUnavailable ? <s-text color="subdued">{t("editor.pick.unavailable")}</s-text> : null}
                              <FieldMessage text={errorFor(F.scope(sid)) ?? errorFor(F.product(sid)) ?? errorFor(F.collection(sid))} />
                            </s-stack>
                            {/* An exception is either own tiers, or no quantity discount at all (a set without tiers: the engine's inert set). */}
                            <SegmentedChoice
                              name={MODE_FIELD(sid)}
                              label={t("tiers.pro.mode")}
                              defaultValue={storedIds?.has(sid) && set.breaks.length === 0 ? "none" : "own"}
                              options={[
                                { value: "own", label: t("tiers.pro.mode.own") },
                                { value: "none", label: t("tiers.pro.mode.none") },
                              ]}
                            />
                            {(live(MODE_FIELD(sid)) ?? (storedIds?.has(sid) && set.breaks.length === 0 ? "none" : "own")) === "none" ? (
                              <>
                                {/* No tier fields are mounted, so nothing is saved as a tier; the counting field keeps the parser's contract. */}
                                <input type="hidden" name={F.count(sid)} value={set.countAcross} />
                                <RowNote>{t("tiers.pro.emptySet")}</RowNote>
                              </>
                            ) : (
                              <TierSetEditor set={set} currencies={currencies} kept={kept} pro live={live} errorFor={errorFor} onChange={onRowsChange} />
                            )}
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <HiddenTierSet set={set} />
                        {set.scope.kind === "selection" ? (
                          <s-stack direction="block" gap="small-200">
                            <TitleList items={set.scope.products} fallback={t("common.untitledProduct")} />
                            <TitleList items={set.scope.collections} fallback={t("common.untitledCollection")} />
                          </s-stack>
                        ) : null}
                        <RowNote>{t("tiers.pro.free")}</RowNote>
                      </>
                    )}
                    <div>
                      <s-button variant="tertiary" onClick={() => onRemove(sid)}>
                        {t("tiers.pro.remove")}
                      </s-button>
                    </div>
                  </s-stack>
                </WonBlock>
              );
            })}
            {pro ? (
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-button onClick={onAdd} disabled={full ? true : undefined}>
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
