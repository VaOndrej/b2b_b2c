// One tier set's fields (MVP 3): how items are counted and its breaks — "od X
// ks" with a percent or an amount per item in each market currency (MKT-1: an
// empty currency = the break is not offered there, said at the row, naming the
// market). Rows are added one at a time (§9c), at most CONFIG_LIMITS.breaksPerTierSet;
// an empty set offers ready-made tiers that fill the rows in one click (P6). A row
// that is not complete yet is marked at the row (it does not count until it is, P3).
// Field names are model/tiers.ts TIERS_FIELD — the server parses exactly these
// (readTiersForm, SEC-1). A value stored for a market that is off travels back
// as a hidden field (§14a: off ≠ erased). `HiddenTierSet` carries a whole set
// that the plan does not let the merchant edit (a Pro set on Free) so a save
// never drops it.

import { amountKeyCurrency } from "@won/core/discounts/money";
import { useEffect, useId, useRef, useState } from "react";

import { CONFIG_LIMITS } from "@won/core/discounts/config";
import { formatMoney } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import { minorToInput } from "../model/rule-form";
import { countLabel, tierPresetLabel, tierRowGap, TIERS_FIELD, TIER_COUNT_MODES, TIER_MIN_QTY_MAX, TIER_PRESETS, type TierCountMode } from "../model/tiers";
import type { CurrencyView, TierBreakView, TierSetView } from "../model/types";
import { FieldMessage, Shown } from "../rule-editor/parts";
import { SegmentedChoice } from "../shell/SegmentedChoice";
import { AmountSuggestions } from "../shell/AmountSuggestions";
import type { AmountSuggestView } from "../model/markets";
import { RowNote } from "../shell/WonSection";
import { WON_INK, WON_LINE, WON_MUTED, WON_SURFACE, WON_WASH } from "../shell/tokens";

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
  attempted = false,
  suggest,
  inherit,
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
  /** The manual rates the amount fields suggest with (návrh 2). */
  suggest?: AmountSuggestView;
  /** A save was refused: every row says what it lacks (before that only rows the merchant has left, audit N8). */
  attempted?: boolean;
  /**
   * An exception (kolo 3, bod 7): how the whole store counts and what kind of discount it gives. The exception's two
   * choices then sit folded under "Počítat jinak než zbytek obchodu", open by themselves when it differs.
   */
  inherit?: { count: TierCountMode; kind: "percent" | "amount" };
}) {
  const tr = useT();
  const { t } = tr;
  const sid = set.id;
  // N8: "není úplná" and "se nenabízí" are said once the merchant has had a go at the row — a field of it was
  // left, a save was refused, or the row is stored (then it is a fact about the shop). Never nine red lines
  // the moment "Částka za kus" is picked.
  const rootRef = useRef<HTMLDivElement>(null);
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onLeave = (event: Event) => {
      const name = (event.target as { name?: unknown } | null)?.name;
      if (typeof name === "string" && name) setLeft((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
    };
    el.addEventListener("focusout", onLeave);
    return () => el.removeEventListener("focusout", onLeave);
  }, []);
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
    // The proposed "od X ks" continues from what the last row says NOW (typed, not only stored).
    const lastRow = rows[rows.length - 1];
    const typed = lastRow ? live(F.min(sid, lastRow.key)) : null;
    const typedMin = typed !== null && /^\d{1,6}$/.test(typed.trim()) ? Number(typed.trim()) : null;
    const last = typedMin ?? lastRow?.initial.minQty ?? 0;
    setRows((list) => [...list, { key, initial: { minQty: last > 0 ? Math.min(TIER_MIN_QTY_MAX, last + 2) : 3, kind: "percent", percent: null, amount: {} } }]);
  };
  const fill = (preset: (typeof TIER_PRESETS)[number]) => {
    const start = counter.current;
    counter.current += preset.breaks.length;
    setRows(preset.breaks.map((b, i) => ({ key: `r${start + i}`, initial: { minQty: b.minQty, kind: "percent", percent: b.percent, amount: {} } })));
  };
  const remove = (key: string) => setRows((list) => list.filter((r) => r.key !== key));
  const codes = currencies.map((c) => c.code);
  const marketsOf = (code: string) => currencies.find((c) => c.code === code)?.markets.map((m) => m.name).join(", ") ?? "";
  const count = set.countAcross as TierCountMode;
  const liveCount = live(F.count(sid));
  const countNow: TierCountMode = (TIER_COUNT_MODES as readonly string[]).includes(liveCount ?? "") ? (liveCount as TierCountMode) : count;
  // Free: "Celý košík" is Pro — shown, not pickable, unless it is what is stored (then it keeps submitting; the gate note says it counts per product).
  const cartLocked = !pro && count !== "cart";
  // One kind per set (controller ruling): the stored set's (its first break's), else percent; the rows follow the live choice.
  const setKind: "percent" | "amount" = set.breaks[0]?.kind ?? "percent";
  const liveKind = live(F.kind(sid));
  const kind: "percent" | "amount" = liveKind === "amount" || liveKind === "percent" ? liveKind : setKind;
  const differs = inherit ? countNow !== inherit.count || kind !== inherit.kind : false;
  const [ownOpen, setOwnOpen] = useState(() => (inherit ? count !== inherit.count || setKind !== inherit.kind : true));
  const ownId = useId();
  // Folded, the two choices stay in the form (they are submitted like every other field), only out of sight.
  const ownShown = !inherit || ownOpen || differs;

  return (
    <div ref={rootRef}>
    <s-stack direction="block" gap="base">
      {inherit ? (
        <div data-won-tier-own={ownShown ? "open" : "closed"}>
          {differs ? (
            // It does count differently: the two choices cannot be folded away.
            <s-text type="strong">{t("tiers.pro.own")}</s-text>
          ) : (
            <s-button variant="tertiary" onClick={() => setOwnOpen((v) => !v)} aria-expanded={ownShown ? "true" : "false"} aria-controls={ownId}>
              {t("tiers.pro.own")}
            </s-button>
          )}
          {ownShown ? null : <RowNote>{t("tiers.pro.ownSame", { count: countLabel(inherit.count, tr).toLocaleLowerCase(tr.locale), kind: t(inherit.kind === "amount" ? "tiers.break.kind.amount" : "tiers.break.kind.percent").toLocaleLowerCase(tr.locale) })}</RowNote>}
        </div>
      ) : null}
      <div id={ownId} style={{ display: ownShown ? "block" : "none" }}>
      <s-stack direction="block" gap="base">
      <s-stack direction="block" gap="small-200">
        <SegmentedChoice
          name={F.count(sid)}
          label={t("tiers.count.label")}
          defaultValue={count}
          options={TIER_COUNT_MODES.map((mode) => ({
            value: mode,
            label: countLabel(mode, tr),
            // The Pro marker only where the shop does not have it (a Pro shop sees a plain choice).
            ...(mode === "cart" && !pro ? { pro: true, disabled: cartLocked, proHref: "/app/plan" } : {}),
          }))}
        />
        <RowNote>{t(countNow === "line" ? "tiers.count.line.details" : countNow === "product" ? "tiers.count.product.details" : "tiers.count.cart.details")}</RowNote>
        {/* Only where "Celý košík" is chosen on Free (stored before a downgrade): what the plan does instead. */}
        {!pro && countNow === "cart" ? <RowNote>{t("tiers.count.cartFree")}</RowNote> : null}
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
      </s-stack>
      </div>

      <div>
        {rows.length === 0 ? (
          <s-stack direction="block" gap="small-200">
            <s-text color="subdued">{t("tiers.empty")}</s-text>
            {/* Ready-made percent tiers (P6): one click fills the rows, every value stays editable. */}
            {kind === "percent" ? (
              <s-stack direction="inline" gap="small-200" alignItems="center">
                {TIER_PRESETS.map((preset) => (
                  <s-button key={preset.id} variant="secondary" onClick={() => fill(preset)}>
                    {tierPresetLabel(preset, tr)}
                  </s-button>
                ))}
              </s-stack>
            ) : null}
          </s-stack>
        ) : null}
        {rows.map((row, index) => {
          const amountNow = (code: string): string => {
            const typed = live(F.amount(sid, row.key, code));
            if (typed !== null) return typed.trim();
            return row.initial.amount[code] !== undefined ? "set" : "";
          };
          const minNow = Number(live(F.min(sid, row.key)) ?? row.initial.minQty);
          const missing = kind === "amount" ? currencies.filter((c) => amountNow(c.code) === "") : [];
          const rowFields = [F.min(sid, row.key), F.percent(sid, row.key), ...codes.map((code) => F.amount(sid, row.key, code))];
          // Stored in the kind shown now = a fact about the shop; else only after a go at the row.
          const storedSoFar = kind === "amount" ? Object.keys(row.initial.amount).length > 0 : row.initial.percent !== null;
          const tried = attempted || storedSoFar || rowFields.some((field) => left.has(field));
          // What the row still lacks, from what is typed (before the first read: from what is stored).
          const gap = tierRowGap(kind, {
            min: live(F.min(sid, row.key)) ?? (row.initial.minQty > 0 ? String(row.initial.minQty) : ""),
            percent: live(F.percent(sid, row.key)) ?? percentValue(row.initial),
            amounts: [...codes, ...kept].map(amountNow),
          });
          return (
            // Each level is its own card with a numbered header (Ondřej 7 Oct 2026: the rows ran together): the number,
            // "od X ks" from what is typed, and the remove button where the eye expects it.
            <div key={row.key} data-won-tier-row style={{ marginTop: index === 0 ? 0 : 10, border: `1px solid ${WON_LINE}`, borderRadius: 12, background: WON_SURFACE, overflow: "hidden" }}>
              <input type="hidden" name={F.row(sid)} value={row.key} />
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "6px 12px", padding: "8px 12px", background: WON_WASH, borderBottom: `1px solid ${WON_LINE}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 24, borderRadius: 999, background: WON_INK, color: "#fff", fontSize: 12.5, fontWeight: 700, flex: "0 0 auto" }}>
                    {index + 1}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: WON_INK }}>{t("tiers.break.title", { n: index + 1 })}</span>
                  {Number.isFinite(minNow) && minNow > 0 ? <span style={{ fontSize: 13, color: WON_MUTED }}>{t("tiers.break.titleFrom", { min: minNow })}</span> : null}
                </div>
                <s-button variant="tertiary" onClick={() => remove(row.key)}>
                  {t("tiers.break.remove")}
                </s-button>
              </div>
              <div style={{ padding: 12 }}>
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
                        // Proposal 3: named by the market, the currency in brackets.
                        label={marketsOf(code) ? t("tiers.break.amountMarket", { currency: code, markets: marketsOf(code) }) : t("tiers.break.amount", { currency: code })}
                        value={row.initial.amount[code] !== undefined ? minorToInput(row.initial.amount[code]!, code) : ""}
                        min={0}
                        suffix={amountKeyCurrency(code)}
                        inputMode="decimal"
                        error={errorFor(F.amount(sid, row.key, code))}
                      />
                    </Shown>
                  ))}
                </div>
                {gap && tried ? <RowNote tone="attention">{t(gap === "min" ? "tiers.break.incompleteMin" : kind === "percent" ? "tiers.break.incompletePercent" : "tiers.break.incompleteAmount")}</RowNote> : null}
                <Shown when={kind === "amount"}>
                  <AmountSuggestions
                    suggest={suggest}
                    currencies={currencies}
                    field={(code) => F.amount(sid, row.key, code)}
                    initial={Object.fromEntries(codes.map((code) => [code, row.initial.amount[code] !== undefined ? minorToInput(row.initial.amount[code]!, code) : ""]))}
                  />
                  <FieldMessage text={errorFor(F.amounts(sid, row.key))} />
                  {/* One sentence per level: an incomplete level says only that; a complete one names the markets it misses. */}
                  {!gap && tried && missing.length > 0 ? (
                    <RowNote tone="attention">
                      {t("tiers.missingMarkets", {
                        markets: tr.list(missing.map((c) => (c.markets.length > 0 ? `${c.markets.map((m) => m.name).join(", ")} (${c.code})` : c.code))),
                        mins: t("tiers.from", { n: Number.isFinite(minNow) && minNow > 0 ? minNow : row.initial.minQty }).toLocaleLowerCase(tr.locale),
                      })}
                    </RowNote>
                  ) : null}
                </Shown>
                {kept
                  .filter((code) => row.initial.amount[code] !== undefined)
                  .map((code) => (
                    <div key={code}>
                      <input type="hidden" name={F.amount(sid, row.key, code)} value={minorToInput(row.initial.amount[code]!, code)} />
                      <RowNote>{t("tiers.break.kept", { currency: code, value: formatMoney(row.initial.amount[code]!, code, tr.locale) })}</RowNote>
                    </div>
                  ))}
              </s-stack>
              </div>
            </div>
          );
        })}
        <FieldMessage text={errorFor(F.row(sid))} />
        <div style={{ paddingTop: 12 }}>
          <s-stack direction="inline" gap="base" alignItems="center">
            <s-button onClick={add} disabled={full ? true : undefined}>
              {t("tiers.break.add")}
            </s-button>
            {full ? <s-text color="subdued">{t("tiers.break.limit", { max: CONFIG_LIMITS.breaksPerTierSet })}</s-text> : null}
          </s-stack>
        </div>
      </div>
    </s-stack>
    </div>
  );
}

/**
 * A set this page shows but does not edit (a Pro set on Free, a dormant extra
 * whole-store set): only its id and the "kept" mark travel — the server keeps
 * the STORED set by id, never re-parsing its values (§14a; audit P3-4: a
 * stored 0 %, a third decimal or a non-Shopify id would not pass the form).
 */
export function HiddenTierSet({ set }: { set: TierSetView }) {
  return <input type="hidden" name={F.kept(set.id)} value="1" />;
}
