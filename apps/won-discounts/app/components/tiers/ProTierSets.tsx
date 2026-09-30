// Pro "Sady pro vybrané produkty a kolekce" (MVP 3; A2/§16: visible, amber,
// never blocking Free; BILL-1: the server gate decides what runs). Each set picks
// products and/or collections with the App Bridge resource picker (titles come
// from Shopify, the ids travel as hidden fields) and has its own counting and
// breaks. Which set a product gets is said once (contract K1): its own set only
// — never the whole-store set as well — the first one naming the product, else
// the first one with its collection. On Free the stored sets stay listed and
// removable (§14a: off ≠ erased), carried as hidden fields, not editable; with
// none stored Free sees one example labelled "Ukázka" (§16c).

import { CONFIG_LIMITS } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import { scopeSummary, TIERS_FIELD, tierSummary } from "../model/tiers";
import type { CurrencyView, TierSetView } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonBlock, WonRow, WonSection } from "../shell/WonSection";
import { WON_AMBER_TEXT } from "../shell/tokens";
import { HiddenTierSet, TierSetEditor } from "./TierSetEditor";

const F = TIERS_FIELD;

function TitleList({ items, fallback }: { items: readonly { id: string; title: string }[]; fallback: string }) {
  if (items.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.slice(0, 12).map((item) => (
        <s-chip key={item.id}>{item.title.trim() || fallback}</s-chip>
      ))}
      {items.length > 12 ? <s-text color="subdued">+{items.length - 12}</s-text> : null}
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
  onAdd,
  onRemove,
  onPick,
  pickUnavailable,
  onRowsChange,
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
}) {
  const tr = useT();
  const { t } = tr;
  const codes = currencies.map((c) => c.code);
  const full = sets.length + 1 >= CONFIG_LIMITS.tierSets;
  // §17c: on Free no Pro set is in force, whatever is stored.
  const summary = pro && sets.length > 0 ? tr.tp("count.tierSet", sets.length) : t("tiers.pro.none");
  return (
    <WonSection title={t("tiers.pro.title")} glyph="target" pro locked={!pro} summary={summary} collapsible defaultOpen={sets.length > 0} anchor="pro">
      <s-stack direction="block" gap="base">
        {!pro ? <ProSell benefit={t("tiers.pro.benefit")} /> : null}
        <ProFrame locked={!pro}>
          <s-stack direction="block" gap="base">
            <s-text color="subdued">{t("tiers.pro.body")}</s-text>
            <s-text color="subdued">{t("tiers.pro.precedence")}</s-text>
            {sets.map((set, i) => {
              const draft = drafts.find((d) => d.id === set.id) ?? set;
              const sid = set.id;
              return (
                <WonBlock key={sid} title={t("tiers.pro.set", { n: i + 1 })} summary={`${scopeSummary(set.scope, tr)} · ${tierSummary(draft, tr, codes)}`} pro>
                  <input type="hidden" name={F.set} value={sid} />
                  <s-stack direction="block" gap="base">
                    {set.scope.kind === "global" ? <RowNote tone="attention">{t("tiers.pro.extraGlobal")}</RowNote> : null}
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
                              <s-stack direction="inline" gap="base" alignItems="center">
                                <s-button onClick={() => onPick(sid, "products")}>{t("editor.pick.products")}</s-button>
                                <s-button onClick={() => onPick(sid, "collections")}>{t("editor.pick.collections")}</s-button>
                              </s-stack>
                              <TitleList items={set.scope.products} fallback={t("common.untitledProduct")} />
                              <TitleList items={set.scope.collections} fallback={t("common.untitledCollection")} />
                              {set.scope.products.length === 0 && set.scope.collections.length === 0 ? <s-text color="subdued">{t("editor.pick.none")}</s-text> : null}
                              {pickUnavailable ? <s-text color="subdued">{t("editor.pick.unavailable")}</s-text> : null}
                              <FieldMessage text={errorFor(F.scope(sid)) ?? errorFor(F.product(sid)) ?? errorFor(F.collection(sid))} />
                            </s-stack>
                            <TierSetEditor set={set} currencies={currencies} kept={kept} pro live={live} errorFor={errorFor} onChange={onRowsChange} />
                            {draft.breaks.length === 0 ? <RowNote>{t("tiers.pro.emptySet")}</RowNote> : null}
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        <HiddenTierSet set={set} />
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
            {sets.length === 0 && !pro ? (
              <WonRow>
                <span style={{ fontSize: 12, fontWeight: 700, color: WON_AMBER_TEXT }}>{t("margin.collections.sample")} · </span>
                <s-text type="strong">{t("tiers.pro.sampleName")}</s-text>
                <RowNote>{tierSummary({ id: "sample", scope: { kind: "global" }, countAcross: "product", breaks: [{ minQty: 2, kind: "percent", percent: 5, amount: {} }, { minQty: 6, kind: "percent", percent: 8, amount: {} }] }, tr)}</RowNote>
              </WonRow>
            ) : null}
            <FieldMessage text={errorFor(F.set)} />
            <s-stack direction="inline" gap="base" alignItems="center">
              <s-button onClick={onAdd} disabled={!pro || full ? true : undefined}>
                {t("tiers.pro.add")}
              </s-button>
              {full ? <s-text color="subdued">{t("tiers.pro.limit", { max: CONFIG_LIMITS.tierSets })}</s-text> : null}
            </s-stack>
          </s-stack>
        </ProFrame>
      </s-stack>
    </WonSection>
  );
}
