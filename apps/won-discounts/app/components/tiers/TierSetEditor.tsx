// One tier set's fields (MVP 3): how items are counted and its breaks — "od X
// ks" with a percent or an amount per item in each market currency (MKT-1: an
// empty currency = the break is not offered there, said at the row, naming the
// market). Rows are added one at a time (§9c), at most CONFIG_LIMITS.breaksPerTierSet.
// Field names are model/tiers.ts TIERS_FIELD — the server parses exactly these
// (readTiersForm, SEC-1). A value stored for a market that is off travels back
// as a hidden field (§14a: off ≠ erased). `HiddenTierSet` carries a whole set
// that the plan does not let the merchant edit (a Pro set on Free) so a save
// never drops it.

import { useEffect, useRef, useState } from "react";

import { CONFIG_LIMITS } from "@won/core/discounts/config";
import { formatMoney } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import { minorToInput } from "../model/rule-form";
import { countLabel, TIERS_FIELD, TIER_COUNT_MODES, TIER_MIN_QTY_MAX, type TierCountMode } from "../model/tiers";
import type { CurrencyView, TierBreakView, TierSetView } from "../model/types";
import { FieldMessage, Shown } from "../rule-editor/parts";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { RowNote } from "../shell/WonSection";
import { WON_LINE } from "../shell/tokens";

const F = TIERS_FIELD;

interface Row {
  key: string;
  initial: TierBreakView;
}

function percentValue(b: TierBreakView): string {
  return b.kind === "percent" && b.percent !== null ? String(b.percent) : "";
}

/**
 * The set's own fields: counting and breaks. `live(field)` = the field's value as
 * last read from the form (§2: native events), null before the first read — the
 * row's kind, the counting note and the MKT-1 note follow what is typed.
 */
export function TierSetEditor({
  set,
  currencies,
  kept,
  pro,
  live,
  errorFor,
  onChange,
}: {
  set: TierSetView;
  /** Currencies of the enabled markets (amount fields). */
  currencies: readonly CurrencyView[];
  /** Currencies whose market is off but that hold a stored amount (kept as hidden fields). */
  kept: readonly string[];
  /** Pro plan: "Celý košík" can be picked. */
  pro: boolean;
  live: (field: string) => string | null;
  errorFor: (field: string) => string | undefined;
  /** A row was added or removed: the page re-reads its form (the state line and the preview follow, §17b). */
  onChange?: () => void;
}) {
  const tr = useT();
  const { t } = tr;
  const sid = set.id;
  const counter = useRef(set.breaks.length);
  const [rows, setRows] = useState<Row[]>(() => set.breaks.map((b, i) => ({ key: `r${i}`, initial: b })));
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) onChange?.();
    mounted.current = true;
    // Only a changed list of rows re-reads the form, not a new callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);
  const full = rows.length >= CONFIG_LIMITS.breaksPerTierSet;
  const add = () => {
    const key = `r${counter.current}`;
    counter.current += 1;
    const last = rows[rows.length - 1]?.initial.minQty ?? 0;
    setRows((list) => [...list, { key, initial: { minQty: last > 0 ? last + 2 : 3, kind: "percent", percent: null, amount: {} } }]);
  };
  const remove = (key: string) => setRows((list) => list.filter((r) => r.key !== key));
  const codes = currencies.map((c) => c.code);
  const count = set.countAcross as TierCountMode;
  const liveCount = live(F.count(sid));
  const countNow: TierCountMode = (TIER_COUNT_MODES as readonly string[]).includes(liveCount ?? "") ? (liveCount as TierCountMode) : count;
  // Free: "Celý košík" is Pro — shown, not pickable, unless it is what is stored (then it keeps submitting; the gate note says it counts per product).
  const cartLocked = !pro && count !== "cart";
  // One kind per set (controller ruling): the stored set's (its first break's), else percent; the rows follow the live choice.
  const setKind: "percent" | "amount" = set.breaks[0]?.kind ?? "percent";
  const liveKind = live(F.kind(sid));
  const kind: "percent" | "amount" = liveKind === "amount" || liveKind === "percent" ? liveKind : setKind;

  return (
    <s-stack direction="block" gap="base">
      <s-stack direction="block" gap="small-200">
        <SegmentedChoice
          name={F.count(sid)}
          label={t("tiers.count.label")}
          defaultValue={count}
          options={TIER_COUNT_MODES.map((mode) => ({
            value: mode,
            label: countLabel(mode, tr),
            ...(mode === "cart" ? { pro: true, disabled: cartLocked } : {}),
          }))}
        />
        <RowNote>{t(countNow === "line" ? "tiers.count.line.details" : countNow === "product" ? "tiers.count.product.details" : "tiers.count.cart.details")}</RowNote>
        {!pro ? <RowNote>{t("tiers.count.cartFree")}</RowNote> : null}
        <FieldMessage text={errorFor(F.count(sid))} />
      </s-stack>

      <SegmentedChoice
        name={F.kind(sid)}
        label={t("tiers.break.kind")}
        defaultValue={setKind}
        options={[
          { value: "percent", label: t("tiers.break.kind.percent") },
          { value: "amount", label: t("tiers.break.kind.amount") },
        ]}
      />
      <Shown when={kind === "amount"}>
        <RowNote>{t("tiers.break.amountDetails")}</RowNote>
      </Shown>

      <div>
        {rows.length === 0 ? <s-text color="subdued">{t("tiers.empty")}</s-text> : null}
        {rows.map((row) => {
          const amountNow = (code: string): string => {
            const typed = live(F.amount(sid, row.key, code));
            if (typed !== null) return typed.trim();
            return row.initial.amount[code] !== undefined ? "set" : "";
          };
          const minNow = Number(live(F.min(sid, row.key)) ?? row.initial.minQty);
          const missing = kind === "amount" ? currencies.filter((c) => amountNow(c.code) === "") : [];
          return (
            <div key={row.key} style={{ padding: "12px 0", borderTop: `1px solid ${WON_LINE}` }}>
              <input type="hidden" name={F.row(sid)} value={row.key} />
              <s-stack direction="block" gap="small-200">
                {/* One row per break: "od X ks" and its value side by side, wrapping on a phone (§8). */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 150px), 1fr))", gap: 12, alignItems: "start" }}>
                  <s-number-field
                    name={F.min(sid, row.key)}
                    label={t("tiers.break.min")}
                    value={row.initial.minQty > 0 ? String(row.initial.minQty) : ""}
                    min={1}
                    max={TIER_MIN_QTY_MAX}
                    step={1}
                    inputMode="numeric"
                    error={errorFor(F.min(sid, row.key))}
                  />
                  <Shown when={kind === "percent"}>
                    <s-number-field
                      name={F.percent(sid, row.key)}
                      label={t("tiers.break.percent")}
                      value={percentValue(row.initial)}
                      min={0}
                      max={100}
                      step={0.1}
                      suffix="%"
                      inputMode="decimal"
                      error={errorFor(F.percent(sid, row.key))}
                    />
                  </Shown>
                  {codes.map((code) => (
                    <Shown key={code} when={kind === "amount"}>
                      <s-number-field
                        name={F.amount(sid, row.key, code)}
                        label={t("tiers.break.amount", { currency: code })}
                        value={row.initial.amount[code] !== undefined ? minorToInput(row.initial.amount[code]!, code) : ""}
                        min={0}
                        suffix={code}
                        inputMode="decimal"
                        error={errorFor(F.amount(sid, row.key, code))}
                      />
                    </Shown>
                  ))}
                </div>
                <Shown when={kind === "amount"}>
                  <FieldMessage text={errorFor(F.amounts(sid, row.key))} />
                  {missing.map((c) => (
                    <RowNote key={c.code} tone="attention">
                      {t("tiers.missingCurrency", {
                        currency: c.code,
                        markets: c.markets.map((m) => m.name).join(", ") || c.code,
                        mins: t("tiers.from", { n: Number.isFinite(minNow) && minNow > 0 ? minNow : row.initial.minQty }).toLocaleLowerCase(tr.locale),
                      })}
                    </RowNote>
                  ))}
                </Shown>
                {kept
                  .filter((code) => row.initial.amount[code] !== undefined)
                  .map((code) => (
                    <div key={code}>
                      <input type="hidden" name={F.amount(sid, row.key, code)} value={minorToInput(row.initial.amount[code]!, code)} />
                      <RowNote>{t("tiers.break.kept", { currency: code, value: formatMoney(row.initial.amount[code]!, code, tr.locale) })}</RowNote>
                    </div>
                  ))}
                <div>
                  <s-button variant="tertiary" onClick={() => remove(row.key)}>
                    {t("tiers.break.remove")}
                  </s-button>
                </div>
              </s-stack>
            </div>
          );
        })}
        <FieldMessage text={errorFor(F.row(sid))} />
        <div style={{ paddingTop: 8, borderTop: rows.length > 0 ? `1px solid ${WON_LINE}` : undefined }}>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button onClick={add} disabled={full ? true : undefined}>
              {t("tiers.break.add")}
            </s-button>
            {full ? <s-text color="subdued">{t("tiers.break.limit", { max: CONFIG_LIMITS.breaksPerTierSet })}</s-text> : null}
          </s-stack>
        </div>
      </div>
    </s-stack>
  );
}

/** A whole set as hidden fields (a Pro set on Free: kept on save, §14a — never edited, never dropped). */
export function HiddenTierSet({ set }: { set: TierSetView }) {
  const sid = set.id;
  return (
    <>
      <input type="hidden" name={F.scope(sid)} value={set.scope.kind} />
      <input type="hidden" name={F.count(sid)} value={set.countAcross} />
      <input type="hidden" name={F.kind(sid)} value={set.breaks[0]?.kind ?? "percent"} />
      {set.scope.kind === "selection" ? (
        <>
          {set.scope.products.map((p) => (
            <input key={p.id} type="hidden" name={F.product(sid)} value={p.id} />
          ))}
          {set.scope.collections.map((c) => (
            <input key={c.id} type="hidden" name={F.collection(sid)} value={c.id} />
          ))}
        </>
      ) : null}
      {set.breaks.map((b, i) => {
        const row = `r${i}`;
        return (
          <span key={row} hidden>
            <input type="hidden" name={F.row(sid)} value={row} />
            <input type="hidden" name={F.min(sid, row)} value={String(b.minQty)} />
            {b.kind === "percent" ? <input type="hidden" name={F.percent(sid, row)} value={percentValue(b)} /> : null}
            {b.kind === "amount"
              ? Object.entries(b.amount).map(([code, minor]) => <input key={code} type="hidden" name={F.amount(sid, row, code)} value={minorToInput(minor, code)} />)
              : null}
          </span>
        );
      })}
    </>
  );
}
