// Výprodej (MVP 5, Pro) — the module screen (contract O10). "Doprodat N kusů, pak zpět na plnou cenu":
//   1. Nový výprodej — a variant (Shopify's picker; with several variants ticked the merchant picks ONE here, never
//      the app, B5), the pieces to sell off (every piece sold counts, the screen says so), a whole percent, an
//      optional end day (shop-local), the price lists with fixed prices; one button starts it. The section's summary
//      and the price before → after are computed from the live form (P5). Free (amber, §16): the form is shown
//      locked under one sentence of what the feature does and the plan link, nothing starts (BILL-1, A6);
//   2. Aktivní výprodeje — price before → during, the ledger (sold / returned / left), an exact "sold past the
//      pieces", the end, the steps, "Ukončit výprodej" (asks first), "Zkusit znovu" at a failed step;
//   3. Skončené výprodeje — why and when; returned pieces after the end ask "Znovu otevřít" / "Nechat skončený";
//   4. Zobrazení a vratky — the 4 display levels, the return-after-end setting, the badge block deep link. Hidden
//      on Free unless earlier sales still run (B15; the server refuses the same save).
// A section without content is not rendered (P2). Without order access (5a, F-O1) a warning says the sold pieces are
// not counted, and the end-date field carries the marker (P3).
// B14: a refused start keeps what was typed: the action returns the posted values, the fields are seeded from them
// and errors are rendered beside the fields (never through `error`, which resets a Polaris field).
// Each action is its own small form (one button = one action, §13); the server parses it (outlet-admin.server.ts).

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Form, useSubmit } from "react-router";

import { formatMoney } from "@won/core/discounts/describe";
import { OUTLET_COMBINE_CLASSES } from "@won/core/discounts/outlet";

import { useT } from "../../i18n/context";
import { LookSection } from "../looks/LookSection";
import { hoverMark } from "../shell/hover";
import { pickProducts } from "../model/app-bridge";
import { OUTLET_FIELD, OUTLET_INTENT, outletPreviewPrice, readOutletLive, type OutletLiveDraft } from "../model/outlet";
import { formatDateTime } from "../model/signals";
import { useRefusedSeed } from "../model/submitted";
import type { OutletActionResult, OutletRunView, OutletScreenData, PlacementSpot, UiResult } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { boolAttr } from "../shell/attrs";
import { ModuleTiles, ViewTile } from "../shell/ModuleTile";
import { Notice } from "../shell/Notice";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { DiscountsSubNav } from "../shell/SubNav";
import { editorOnProductOf, editorOpenUrl, placementOf, spotAdvice } from "../model/embed";
import { outletBadgeText, outletWebLine } from "../model/outlet-web";
import { StepCard } from "../shell/StepCard";
import { choiceCardStyle, SubCard } from "../shell/SubCard";
import { SpotNote } from "../StorefrontPlacements";
import { WON_CARD_SHADOW, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SURFACE, WON_WASH } from "../shell/tokens";
import { PlacementPill, type PlacementState, RowNote, WonRow, WonSection } from "../shell/WonSection";

const F = OUTLET_FIELD;
const DISPLAYS = ["silent", "strike", "strike_badge", "strike_badge_left"] as const;
const REOPENS = ["ask", "auto", "never"] as const;
const COMBINE_CLASSES = OUTLET_COMBINE_CLASSES;
/** Where the "sold pieces are not counted" warning points: the end-date field of the new sale. */
const ENDS_ANCHOR = "outlet-ends";

/** The three panels of the page (the tiles on top switch between them). */
type OutletView = "sales" | "new" | "web" | "info";
/** Deep links of the sections → the panel that holds them. */
const HASH_VIEW: Readonly<Record<string, OutletView>> = { running: "sales", ended: "sales", new: "new", [ENDS_ANCHOR]: "new", combine: "info", badge: "web", "look-outlet": "web", settings: "info" };
const endDialogId = (runId: string) => `won-outlet-end-${runId.replace(/[^A-Za-z0-9_-]/g, "")}`;

export interface OutletScreenProps extends OutletScreenData {
  result?: OutletActionResult | UiResult | null;
}

/** The picked variant: its name and (when the picker gave one) its price in the shop currency. */
interface PickedSaleVariant {
  id: string;
  productId: string;
  title: string;
  price?: string;
}

const isOutletResult = (r: OutletActionResult | UiResult | null | undefined): r is OutletActionResult =>
  !!r && ((r.ok && "kind" in r) || (!r.ok && (r.reason === "failed" || (r.reason === "invalid" && !("message" in r)))));

function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function OutletBanner({ result }: { result: OutletActionResult }) {
  const { t } = useT();
  if (result.ok) {
    const text =
      result.kind === "started" && result.skippedLists
        ? t("outlet.result.startedSkipped", { n: result.skippedLists })
        : t(`outlet.result.${result.kind}` as "outlet.result.started");
    return (
      <s-banner tone="success" heading={text}>
        {result.pending ? <s-paragraph>{t("outlet.result.pending")}</s-paragraph> : null}
      </s-banner>
    );
  }
  if (result.reason === "failed") return <s-banner tone="critical" heading={t("outlet.result.failed", { message: result.message })} />;
  // A refusal that has no field on the screen (the settings on Free, B15) is said here; the rest sits at its field.
  const loose = result.errors.find((e) => e.field === F.display || e.field === F.reopen);
  return loose ? <s-banner tone="critical" heading={t(loose.key, loose.params)} /> : null;
}

/** The anchor of a sale's card ("K vyřešení" links to it). */
const runAnchor = (id: string) => `run-${id.replace(/[^A-Za-z0-9_-]/g, "")}`;

/** One fact of a running sale: a small labelled box (the four of them sit side by side). */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ border: `1px solid ${WON_LINE}`, borderRadius: 10, padding: "10px 12px", background: WON_WASH, fontFamily: WON_FONT, fontSize: 14, color: WON_INK, minWidth: 0 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: WON_MUTED, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

type Combine = (typeof COMBINE_CLASSES)[number];

/**
 * What a sale combines with (step 3 of a new one, and "Změnit" at a running one): two cards to click, and under
 * "I s vybranými slevami" a box to tick for each discount — one sale may take the quantity discount and no codes,
 * another the opposite (feedback 10 Oct 2026, 6th round). Native inputs: the live draft and the server read the
 * same fields; the boxes keep their ticks while the other card is chosen (they are simply not read then).
 */
function CombineChoice({ combine, takes, forced, disabled, error }: { combine: boolean; takes: readonly Combine[]; forced: boolean; disabled: boolean; error?: string }) {
  const { t } = useT();
  const [on, setOn] = useState(combine);
  const off = disabled || forced;
  const head = (value: "0" | "1", picked: boolean) => (
    <>
      <input type="radio" name={F.combine} value={value} defaultChecked={picked} disabled={off} onChange={() => setOn(value === "1")} style={{ marginTop: 3 }} />
      <span style={{ fontSize: 14.5, fontWeight: 700, color: WON_INK }}>{t(value === "1" ? "outlet.combine.choice.on" : "outlet.combine.choice.off")}</span>
      <span style={{ gridColumn: 2, fontSize: 13, lineHeight: 1.45, color: WON_MUTED }}>{t(value === "1" ? "outlet.combine.choice.on.hint" : "outlet.combine.choice.off.hint")}</span>
    </>
  );
  return (
    <div style={{ display: "grid", gap: 10 }} data-won-outlet-combine-choice="">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12, alignItems: "start" }}>
        <label data-won-outlet-combine="0" {...(off ? {} : hoverMark("card", !on))} style={choiceCardStyle(!on, off)}>
          {head("0", !combine)}
        </label>
        <div data-won-outlet-combine="1" {...(off ? {} : hoverMark("card", on))} style={choiceCardStyle(on, off)}>
          <label style={{ display: "contents", cursor: off ? "default" : "pointer" }}>{head("1", combine)}</label>
          {/* The marker tells the server this form has the boxes (none ticked is then "none", not "all"). */}
          <input type="hidden" name={F.combineWith} value="_" />
          <div data-won-outlet-combine-with="" style={{ gridColumn: "1 / -1", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${on ? "#c7dcfb" : WON_LINE}`, display: "grid", gap: 8, opacity: on ? 1 : 0.55 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: WON_MUTED }}>{t("outlet.combine.with.title")}</span>
            {COMBINE_CLASSES.map((c) => (
              <label key={c} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "0 10px", alignItems: "start", cursor: off || !on ? "default" : "pointer" }}>
                <input type="checkbox" name={F.combineWith} value={c} defaultChecked={takes.includes(c)} disabled={off || !on} style={{ marginTop: 3, width: 16, height: 16 }} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: WON_INK }}>{t(`outlet.combine.${c}.label` as "outlet.combine.tiers.label")}</span>
                <span style={{ gridColumn: 2, fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>{t(`outlet.combine.${c}.pick` as "outlet.combine.tiers.pick")}</span>
              </label>
            ))}
            <span style={{ fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>{t("outlet.combine.with.always")}</span>
          </div>
        </div>
      </div>
      <FieldMessage text={error} />
      {forced ? <RowNote>{t("outlet.combine.choice.forced")}</RowNote> : null}
    </div>
  );
}

/**
 * What a sale takes, read without guessing (7th round: three struck-through chips did not say "does not apply"):
 * one sentence of the outcome, then each discount on its own line with the word "Přičte se" or "Nepřičte se".
 */
function CombineMarks({ takes }: { takes: readonly Combine[] }) {
  const tr = useT();
  const { t } = tr;
  const names = takes.map((c) => t(`outlet.combine.${c}.short` as "outlet.combine.tiers.short"));
  const lead = takes.length === 0 ? t("outlet.combine.marks.none") : takes.length === COMBINE_CLASSES.length ? t("outlet.combine.marks.all") : t("outlet.combine.marks.some", { list: tr.list(names) });
  return (
    <div data-won-outlet-combine-marks="" style={{ fontFamily: WON_FONT }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: WON_INK, marginBottom: 8 }}>{lead}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, border: `1px solid ${WON_LINE}`, borderRadius: 10, overflow: "hidden", maxWidth: 520 }}>
        {COMBINE_CLASSES.map((c, i) => {
          const yes = takes.includes(c);
          return (
            <li key={c} data-won-yesno={yes ? "yes" : "no"} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "7px 12px", borderTop: i === 0 ? "none" : `1px solid ${WON_LINE}`, background: WON_SURFACE }}>
              <span style={{ fontSize: 13.5, color: WON_INK }}>{t(`outlet.combine.${c}.short` as "outlet.combine.tiers.short")}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "0 0 auto", padding: "2px 10px 2px 6px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, lineHeight: 1.4, color: yes ? "#0f6b36" : WON_MUTED, background: yes ? "#e6f6ed" : WON_WASH, border: `1px solid ${yes ? "#bfe3cd" : WON_LINE}` }}>
                <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: "#fff", background: yes ? "#1a8f4b" : "#8892a0" }}>
                  {yes ? "✓" : "✕"}
                </span>
                {t(yes ? "outlet.combine.mark.yes" : "outlet.combine.mark.no")}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The product as a customer sees it under this sale: the price, the struck one, the badge and the pieces left —
 * drawn like a piece of a product page (a white card on the page's grey), not described in a sentence.
 */
function SalePreview({ price, display, message, left, emptyText }: { price: { now: string; before: string } | null; display: (typeof DISPLAYS)[number]; message: string; left: number; emptyText: string }) {
  const { t } = useT();
  const badge = display.startsWith("strike_badge");
  return (
    <div data-won-outlet-preview="" style={{ border: `1px solid ${WON_LINE}`, borderRadius: 12, background: "#eef1f4", padding: 12, fontFamily: WON_FONT }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: WON_MUTED, marginBottom: 8 }}>{t("outlet.preview.title")}</div>
      <div style={{ background: WON_SURFACE, borderRadius: 10, padding: "14px 16px", boxShadow: WON_CARD_SHADOW, display: "grid", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 10 }}>
          {price ? (
            <>
              <span style={{ fontSize: 20, fontWeight: 700, color: WON_INK }}>{price.now}</span>
              {display !== "silent" ? <s style={{ fontSize: 15, color: WON_MUTED }}>{price.before}</s> : null}
            </>
          ) : (
            <span style={{ fontSize: 14, color: WON_MUTED }}>{emptyText}</span>
          )}
        </div>
        {badge ? (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span data-won-outlet-preview-badge="" style={{ padding: "3px 12px", border: `1px solid ${WON_INK}`, borderRadius: 999, fontSize: 13, fontWeight: 600, color: WON_INK }}>
              {outletBadgeText(message, left, t("looks.sample.outlet.badge"))}
            </span>
            {display === "strike_badge_left" && !message.includes("{left}") ? <span style={{ fontSize: 13.5, color: WON_INK }}>{t("outlet.preview.left", { n: left })}</span> : null}
          </div>
        ) : (
          <span style={{ fontSize: 12.5, color: WON_MUTED }}>{t(display === "silent" ? "outlet.preview.silent" : "outlet.preview.noBadge")}</span>
        )}
      </div>
    </div>
  );
}

function RunCard({
  run,
  pro,
  money,
  badgeOn = false,
  display,
  withOthers = false,
  badge = "unknown",
  badgeAddUrl = null,
  badgeSpot,
  result,
}: {
  run: OutletRunView;
  pro: boolean;
  money: (minor: number, currency: string) => string;
  /** The shop's display level shows a badge at all. */
  badgeOn?: boolean;
  display?: OutletScreenData["display"];
  /** The shop-wide rule: every sale takes the other discounts too. */
  withOthers?: boolean;
  /** Where the "Sale badge" block stands in the live theme. */
  badge?: PlacementState;
  badgeAddUrl?: string | null;
  /** Where the block sits in the product template (the editor opens with it selected). */
  badgeSpot?: PlacementSpot;
  result?: OutletActionResult | UiResult | null;
}) {
  const { t } = useT();
  const web = run.status === "active" ? outletWebLine(run, badge, t) : null;
  // A running sale's price is written: only the levels on the same side of "silent" can still be picked.
  const levels = DISPLAYS.filter((d) => (d === "silent") === (run.display === "silent"));
  const ended = run.status === "ended";
  const active = run.status === "active";
  // What is edited in place: opened by its button, closed again by a save that went through.
  const [edit, setEdit] = useState<"web" | "combine" | null>(null);
  useEffect(() => {
    if (result?.ok) setEdit(null);
  }, [result]);
  const takes: readonly Combine[] = withOthers ? COMBINE_CLASSES : run.combineWith;
  const combineError = result && !result.ok && result.reason === "invalid" && "errors" in result ? result.errors?.find((e) => e.field === F.combineWith) : undefined;
  const badgeMove = badge === "in_theme" && spotAdvice(badgeSpot)?.move === true;
  const end = active ? (
    <s-button variant="secondary" tone="critical" commandFor={endDialogId(run.id)} command="--show">
      {t("outlet.run.end")}
    </s-button>
  ) : null;
  const statusPill = (
    <span data-won-outlet-status={run.status} style={{ fontSize: 11.5, fontWeight: 700, padding: "2px 9px", borderRadius: 999, border: `1px solid ${active ? "#bfe3cd" : WON_LINE}`, background: active ? "#e6f6ed" : WON_SURFACE, color: active ? "#1a8f4b" : WON_MUTED }}>
      {t(`outlet.status.${run.status}` as "outlet.status.active")}
    </span>
  );
  return (
    <div id={runAnchor(run.id)} style={{ scrollMarginTop: 16 }}>
      <SubCard
        title={<span style={{ fontSize: 16 }}>{run.title || t("outlet.run.unknown")}</span>}
        label={statusPill}
        tone={run.oversold > 0 || (run.problem && run.retry) || (ended && run.returnPending > 0) ? "attention" : undefined}
        action={
          active ? (
            <>
              {run.webUrl ? (
                <s-button href={run.webUrl} target="_blank" variant="secondary">
                  {t("outlet.web.open")}
                </s-button>
              ) : null}
              {end}
            </>
          ) : undefined
        }
      >
        {ended ? (
          <RowNote>
            {run.price ? `${t("outlet.run.price", { before: money(run.price.before, run.price.currency), after: money(run.price.sale, run.price.currency), percent: run.percent })} · ` : ""}
            {t("outlet.run.ledger", { sold: run.sold, quota: run.quota, returned: run.returned, left: run.left })}
          </RowNote>
        ) : (
          <div data-won-outlet-facts="" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Fact label={t("outlet.fact.price")}>
              {run.price ? (
                <>
                  <span style={{ fontWeight: 700 }}>{money(run.price.sale, run.price.currency)}</span> <s style={{ opacity: 0.55, fontSize: 13 }}>{money(run.price.before, run.price.currency)}</s>
                  <div style={{ fontSize: 12.5, color: WON_MUTED }}>−{run.percent} %</div>
                </>
              ) : (
                <span>−{run.percent} %</span>
              )}
            </Fact>
            <Fact label={t("outlet.fact.left")}>
              <span style={{ fontWeight: 700 }}>{t("outlet.fact.leftOf", { left: run.left, quota: run.quota })}</span>
              <div aria-hidden="true" style={{ height: 6, borderRadius: 6, background: WON_LINE, marginTop: 6, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, run.quota > 0 ? ((run.quota - run.left) / run.quota) * 100 : 0))}%`, background: WON_INK }} />
              </div>
              <div style={{ fontSize: 12.5, color: WON_MUTED, marginTop: 4 }}>{t("outlet.fact.sold", { sold: run.sold, returned: run.returned })}</div>
            </Fact>
            <Fact label={t("outlet.fact.end")}>
              <span style={{ fontWeight: 700 }}>{run.endsAt ?? t("outlet.fact.noEnd")}</span>
              {run.endsAt ? null : <div style={{ fontSize: 12.5, color: WON_MUTED }}>{t("outlet.fact.noEndHint")}</div>}
            </Fact>
          </div>
        )}
        {run.oversold > 0 ? (
          // Red only where there is something to do about it: a running sale can be ended right here.
          active ? (
            <WonRow tone="attention" action={end}>
              <RowNote tone="attention">{t("outlet.run.oversold", { n: run.oversold })}</RowNote>
            </WonRow>
          ) : (
            <RowNote>{t("outlet.run.oversold", { n: run.oversold })}</RowNote>
          )
        ) : null}
        {ended && run.endReason && run.endedAt ? <RowNote>{t(`outlet.ended.reason.${run.endReason}` as "outlet.ended.reason.manual", { at: run.endedAt })}</RowNote> : null}
        {run.listNames.length > 0 ? <RowNote>{t("outlet.run.lists", { names: run.listNames.join(", ") })}</RowNote> : null}
        {web ? (
          // Two things of a running sale, each its own card: how it shows on the web, and what it combines with.
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12, alignItems: "start" }}>
            <SubCard
              marker={{ "data-won-outlet-web": run.id }}
              title={t("outlet.web.card")}
              label={run.display.startsWith("strike_badge") && run.showBadge ? <PlacementPill placement={badge} move={badgeMove} /> : undefined}
              tone={web.missing === "block" ? "attention" : undefined}
              action={
                pro && levels.length > 1 && edit !== "web" ? (
                  <s-button variant="secondary" onClick={() => setEdit("web")}>
                    {t("outlet.web.edit")}
                  </s-button>
                ) : undefined
              }
              footer={
                pro && levels.length > 1 && edit === "web" ? (
                  // How this sale shows can be changed while it runs: the badge level and its text.
                  <Form method="post" data-won-outlet-web-edit={run.id}>
                    <input type="hidden" name={F.intent} value={OUTLET_INTENT.web} />
                    <input type="hidden" name={F.run} value={run.id} />
                    <s-stack direction="block" gap="small-300">
                      <s-select name={F.saleDisplay} label={t("outlet.display.label")} value={run.display}>
                        {levels.map((d) => (
                          <s-option key={d} value={d} selected={boolAttr(d === run.display)}>
                            {t(`outlet.display.${d}` as "outlet.display.strike")}
                          </s-option>
                        ))}
                      </s-select>
                      <s-text-field name={F.message} label={t("outlet.message.label")} value={run.message} placeholder={t("looks.sample.outlet.badge")} maxLength={80} details={t("outlet.message.hint")} />
                      <s-stack direction="inline" gap="small-300">
                        <s-button type="submit" variant="primary">
                          {t("outlet.web.save")}
                        </s-button>
                        <s-button variant="tertiary" onClick={() => setEdit(null)}>
                          {t("common.cancel")}
                        </s-button>
                      </s-stack>
                    </s-stack>
                  </Form>
                ) : undefined
              }
            >
              <SalePreview
                price={run.price ? { now: money(run.price.sale, run.price.currency), before: money(run.price.before, run.price.currency) } : null}
                // Truthful: a badge the theme has no block for (or the merchant hid) is not drawn.
                display={run.showBadge && badge !== "missing" ? run.display : run.display === "silent" ? "silent" : "strike"}
                message={run.message}
                left={run.left}
                emptyText={`−${run.percent} %`}
              />
              {/* What is not as the preview shows it, in one red sentence with the button that fixes it. */}
              {web.missing === "block" ? <RowNote tone="attention">{t("outlet.web.badgeNoBlock.fix")}</RowNote> : null}
              {badge === "unknown" && run.showBadge && run.display.startsWith("strike_badge") ? <RowNote>{t("outlet.web.badgeUnverified.note")}</RowNote> : null}
              {badgeMove ? <RowNote tone="attention">{t("outlet.web.badgeMove")}</RowNote> : null}
              <s-stack direction="inline" gap="small-300">
                {web.missing === "block" && badgeAddUrl ? (
                  <s-button href={editorOnProductOf(badgeAddUrl, run.editorUrl) ?? badgeAddUrl} target="_top" variant="primary">
                    {t("outlet.web.addBlock")}
                  </s-button>
                ) : null}
                {run.editorUrl && badge === "in_theme" ? (
                  // The block is there: the editor opens on this product with the block selected, nothing is added.
                  <s-button href={editorOpenUrl(run.editorUrl, badgeSpot) ?? run.editorUrl} target="_top" variant={badgeMove ? "primary" : "secondary"}>
                    {t(badgeMove ? "outlet.web.editorMove" : "outlet.web.editor")}
                  </s-button>
                ) : null}
              </s-stack>
            </SubCard>
            <SubCard
              marker={{ "data-won-outlet-combine-card": run.id }}
              title={t("outlet.fact.combine")}
              action={
                pro && !withOthers && edit !== "combine" ? (
                  <s-button variant="secondary" onClick={() => setEdit("combine")}>
                    {t("outlet.combine.edit")}
                  </s-button>
                ) : undefined
              }
              footer={
                pro && !withOthers && (edit === "combine" || combineError) ? (
                  <Form method="post" data-won-outlet-combine-edit={run.id}>
                    <input type="hidden" name={F.intent} value={OUTLET_INTENT.combine} />
                    <input type="hidden" name={F.run} value={run.id} />
                    <s-stack direction="block" gap="small-300">
                      <CombineChoice combine={run.combine} takes={run.combine ? run.combineWith : COMBINE_CLASSES} forced={false} disabled={false} error={combineError ? t(combineError.key, combineError.params) : undefined} />
                      <s-stack direction="inline" gap="small-300">
                        <s-button type="submit" variant="primary">
                          {t("outlet.combine.save")}
                        </s-button>
                        <s-button variant="tertiary" onClick={() => setEdit(null)}>
                          {t("common.cancel")}
                        </s-button>
                      </s-stack>
                    </s-stack>
                  </Form>
                ) : undefined
              }
            >
              <div style={{ fontFamily: WON_FONT, fontSize: 14, fontWeight: 700, color: WON_INK }}>{t(takes.length === 0 ? "outlet.combine.state.none" : takes.length === COMBINE_CLASSES.length ? "outlet.combine.state.all" : "outlet.combine.state.some")}</div>
              <CombineMarks takes={takes} />
              <RowNote>{t(withOthers ? "outlet.combine.choice.forced" : "outlet.combine.with.always")}</RowNote>
            </SubCard>
          </div>
        ) : null}
        {active && badgeOn && !web && !display ? (
          // The badge on the storefront, per sale variant: said here and switched with one button.
          <WonRow
            action={
              <Form method="post">
                <input type="hidden" name={F.intent} value={OUTLET_INTENT.badge} />
                <input type="hidden" name={F.run} value={run.id} />
                <input type="hidden" name={F.badge} value={run.showBadge ? "hide" : "show"} />
                <s-button type="submit" variant="secondary">
                  {t(run.showBadge ? "outlet.run.badge.hide" : "outlet.run.badge.show")}
                </s-button>
              </Form>
            }
          >
            <RowNote>{t(run.showBadge ? "outlet.run.badge.shown" : "outlet.run.badge.hidden")}</RowNote>
          </WonRow>
        ) : null}
        {run.problem ? (
          run.retry ? (
            <WonRow
              tone="attention"
              action={
                <Form method="post">
                  <input type="hidden" name={F.intent} value={OUTLET_INTENT.retry} />
                  <input type="hidden" name={F.run} value={run.id} />
                  <s-button type="submit" variant="secondary">
                    {t("outlet.run.retry")}
                  </s-button>
                </Form>
              }
            >
              <RowNote tone="attention">{run.problem}</RowNote>
            </WonRow>
          ) : (
            <RowNote>{run.problem}</RowNote>
          )
        ) : null}
        {ended && run.returnPending > 0 ? (
          <WonRow tone="attention" action={null}>
            <s-stack direction="block" gap="small-300">
              <RowNote tone="attention">{t(pro ? "outlet.ended.pending" : "outlet.ended.pendingFree", { n: run.returnPending })}</RowNote>
              {!pro ? (
                <RowNote>
                  {t("outlet.ended.reopenPro")} <s-link href="/app/plan">{t("common.upgradeCta")}</s-link>
                </RowNote>
              ) : null}
              <s-stack direction="inline" gap="small-300">
                {pro ? (
                  <Form method="post">
                    <input type="hidden" name={F.intent} value={OUTLET_INTENT.reopen} />
                    <input type="hidden" name={F.run} value={run.id} />
                    <s-button type="submit" variant="primary">
                      {t("outlet.ended.reopen")}
                    </s-button>
                  </Form>
                ) : null}
                <Form method="post">
                  <input type="hidden" name={F.intent} value={OUTLET_INTENT.keep} />
                  <input type="hidden" name={F.run} value={run.id} />
                  <s-button type="submit" variant="secondary">
                    {t("outlet.ended.keep")}
                  </s-button>
                </Form>
              </s-stack>
            </s-stack>
          </WonRow>
        ) : null}
        {run.history.length > 0 ? (
          <details style={{ borderTop: `1px solid ${WON_LINE}`, paddingTop: 10, fontFamily: WON_FONT }}>
            <summary {...hoverMark("link")} style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: WON_MUTED }}>{t("outlet.run.history")}</summary>
            <s-unordered-list>
              {run.history.map((h, i) => (
                <s-list-item key={`${h.kind}-${i}`}>
                  {h.at} · {h.text}
                </s-list-item>
              ))}
            </s-unordered-list>
          </details>
        ) : null}
      </SubCard>
    </div>
  );
}

export function OutletScreen(props: OutletScreenProps) {
  const tr = useT();
  const { t } = tr;
  const { plan, result, running, ended, priceLists, limits, display, reopen, today, configVersion, badgeBlockAddUrl, ordersCounted, shopCurrency } = props;
  const withOthers = props.withOthers === true;
  const badge = placementOf(props.placed?.outletBadge);
  const badgeMove = badge === "in_theme" && spotAdvice(props.placed?.spots?.outletBadge)?.move === true;
  const pro = plan === "pro";
  const money = (minor: number, currency: string) => formatMoney(minor, currency, tr.locale);
  const submit = useSubmit();

  // B14: what a refused start posted comes back with the result; the fields are seeded from it and remount once.
  const { seed, key: seedKey } = useRefusedSeed(result);
  const seededVariant = (): PickedSaleVariant | null => {
    const id = seed.one(F.variant, "");
    const productId = seed.one(F.product, "");
    if (!id || !productId) return null;
    return { id, productId, title: seed.one(F.variantTitle, ""), ...(seed.one(F.variantPrice, "") ? { price: seed.one(F.variantPrice, "") } : {}) };
  };
  const [variant, setVariant] = useState<PickedSaleVariant | null>(seededVariant);
  /** Several variants ticked in the picker: the merchant picks the one to sell off (one sale = one variant). */
  const [choices, setChoices] = useState<PickedSaleVariant[] | null>(null);
  const [pickNote, setPickNote] = useState<"unavailable" | "empty" | null>(null);
  const err = (field: string) => {
    if (!result || result.ok || result.reason !== "invalid") return undefined;
    const e = result.errors?.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };

  // P5: the summary follows the form (native input / change: React 18 wires only onClick on `s-*`).
  const formRef = useRef<HTMLFormElement>(null);
  const [live, setLive] = useState<OutletLiveDraft>(() => {
    const whole = (name: string) => (/^\d{1,7}$/.test(seed.one(name, "")) ? Number(seed.one(name, "")) : null);
    return { quota: whole(F.quota), percent: whole(F.percent), endsOn: seed.one(F.endsOn, ""), priceListIds: seed.all(F.priceList, []), display: seed.one(F.saleDisplay, ""), message: seed.one(F.message, ""), combine: seed.one(F.combine, "") === "1", combineWith: COMBINE_CLASSES.filter((c) => seed.all(F.combineWith, [...COMBINE_CLASSES]).includes(c)) };
  });
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    const read = () => setLive(readOutletLive(new FormData(el)));
    el.addEventListener("input", read);
    el.addEventListener("change", read);
    return () => {
      el.removeEventListener("input", read);
      el.removeEventListener("change", read);
    };
  }, []);

  const pick = async () => {
    // The picker lists the product's variants and returns the ticked ones (even with one product allowed).
    const picked = await pickProducts(variant ? [variant.productId] : [], { multiple: false });
    setPickNote(!picked.ok && picked.reason === "unavailable" ? "unavailable" : null);
    if (!picked.ok) return;
    const product = picked.items[0];
    if (!product) return;
    const options = product.variants.map((v) => ({
      id: v.id,
      productId: product.id,
      title: v.title && v.title !== "Default Title" ? `${product.title} — ${v.title}` : product.title,
      ...(v.price ? { price: v.price } : {}),
    }));
    if (options.length === 0) {
      setPickNote("empty");
      return;
    }
    if (options.length === 1) {
      setVariant(options[0]!);
      setChoices(null);
      return;
    }
    // B5: never choose silently. The earlier variant stays until the merchant picks one of these.
    setChoices(options);
  };
  const priceOf = (v: PickedSaleVariant) => {
    const preview = outletPreviewPrice(v.price, shopCurrency, 1, "silent");
    return preview ? money(preview.before, shopCurrency) : null;
  };

  // How the NEW sale shows: picked in step 2; until then the level the shop used so far.
  const saleDisplay = (DISPLAYS as readonly string[]).includes(live.display) ? (live.display as (typeof DISPLAYS)[number]) : display;
  const saleBadge = saleDisplay.startsWith("strike_badge");
  const preview = variant ? outletPreviewPrice(variant.price, shopCurrency, live.percent, saleDisplay) : null;
  const priceLine = !variant
    ? t("outlet.summary.priceNeedsVariant")
    : !variant.price || priceOf(variant) === null
      ? t("outlet.summary.priceMissing")
      : live.percent === null
        ? t("outlet.summary.priceNeedsPercent", { price: priceOf(variant)! })
        : preview
          ? t("outlet.summary.price", { before: money(preview.before, shopCurrency), after: money(preview.after, shopCurrency) })
          : t("outlet.summary.priceNotLower", { price: priceOf(variant)! });
  const summaryParts = [
    variant ? variant.title || t("outlet.summary.variantPicked") : null,
    live.quota !== null ? t("outlet.summary.pieces", { n: live.quota }) : null,
    live.percent !== null ? t("outlet.summary.percent", { percent: live.percent }) : null,
    variant || live.quota !== null || live.percent !== null ? (live.endsOn ? t("outlet.summary.ends", { date: formatDateTime(live.endsOn, tr.locale) }) : t("outlet.summary.noEnd")) : null,
  ].filter((x): x is string => x !== null);
  const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : t("outlet.summary.empty");
  /** What the NEW sale will take: every discount under the shop-wide rule, else the ticked ones of the chosen card. */
  const newTakes = withOthers ? [...COMBINE_CLASSES] : live.combine ? live.combineWith : [];

  const form = (
    <Form method="post" ref={formRef} data-won-outlet-new>
      <input type="hidden" name={F.intent} value={OUTLET_INTENT.start} />
      {variant ? <input type="hidden" name={F.variant} value={variant.id} /> : null}
      {variant ? <input type="hidden" name={F.product} value={variant.productId} /> : null}
      {variant ? <input type="hidden" name={F.variantTitle} value={variant.title} /> : null}
      {variant?.price ? <input type="hidden" name={F.variantPrice} value={variant.price} /> : null}
      <div key={seedKey}>
        <StepCard n={1} of={4} title={t("outlet.step.what")} hint={t("outlet.step.what.hint")}>
          {/* The picked variant is a card of its own with its price and the button that changes it. */}
          <div data-won-outlet-picked="" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 14px", borderRadius: 12, border: variant ? `1px solid ${WON_LINE}` : "1px dashed #b9c2cc", background: variant ? WON_WASH : WON_SURFACE, fontFamily: WON_FONT }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: WON_MUTED }}>{t("outlet.new.variant")}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: variant ? WON_INK : WON_MUTED, overflowWrap: "anywhere" }}>{variant ? variant.title || t("outlet.summary.variantPicked") : t("outlet.new.none")}</div>
              {variant && priceOf(variant) ? <div style={{ fontSize: 13, color: WON_MUTED }}>{t("outlet.new.priceNow", { price: priceOf(variant)! })}</div> : null}
            </div>
            <s-button variant={variant ? "secondary" : "primary"} onClick={() => void pick()} disabled={boolAttr(!pro)}>
              {t(variant ? "outlet.new.change" : "outlet.new.pick")}
            </s-button>
          </div>
          {choices ? (
            <s-box padding="small-300" border="base" borderRadius="base" data-won-outlet-choices>
              <s-stack direction="block" gap="small-300">
                <RowNote tone="attention">{t("outlet.new.chooseOne")}</RowNote>
                {choices.map((c) => (
                  <WonRow
                    key={c.id}
                    action={
                      <s-button
                        variant="secondary"
                        onClick={() => {
                          setVariant(c);
                          setChoices(null);
                        }}
                      >
                        {t("outlet.new.choose")}
                      </s-button>
                    }
                  >
                    <s-text>{priceOf(c) ? `${c.title} · ${priceOf(c)}` : c.title}</s-text>
                  </WonRow>
                ))}
              </s-stack>
            </s-box>
          ) : null}
          {pickNote ? <RowNote tone="attention">{t(pickNote === "unavailable" ? "outlet.new.pickUnavailable" : "outlet.new.pickEmpty")}</RowNote> : null}
          <FieldMessage text={err(F.variant)} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, alignItems: "start" }}>
            <div>
              <s-number-field name={F.quota} label={t("outlet.new.quota")} value={seed.one(F.quota, "")} min={1} max={limits.quotaMax} step={1} inputMode="numeric" disabled={boolAttr(!pro)} details={t("outlet.new.quotaShort")} />
              <FieldMessage text={err(F.quota)} />
            </div>
            <div>
              <s-number-field
                name={F.percent}
                label={t("outlet.new.percent")}
                value={seed.one(F.percent, "")}
                min={limits.percentMin}
                max={limits.percentMax}
                step={1}
                suffix="%"
                inputMode="numeric"
                disabled={boolAttr(!pro)}
              />
              <FieldMessage text={err(F.percent)} />
            </div>
            <div id={ENDS_ANCHOR}>
              <s-date-field name={F.endsOn} label={t("outlet.new.endsOn")} value={seed.one(F.endsOn, "")} allow={`${nextDay(today)}--`} disabled={boolAttr(!pro)} details={t("outlet.new.endsOnShort")} />
              <FieldMessage text={err(F.endsOn)} />
              {/* P3: the warning sits at the field that answers it. */}
              {pro && !ordersCounted && !live.endsOn ? <RowNote tone="attention">{t("outlet.orders.quotaHint")}</RowNote> : null}
            </div>
          </div>
          {/* The result of the three fields: the price before and after, as large as a result deserves. */}
          <div data-won-outlet-price="" style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 12px", padding: "12px 14px", borderRadius: 12, background: preview ? "#f2f7ff" : WON_WASH, border: `1px solid ${preview ? "#c7dcfb" : WON_LINE}`, fontFamily: WON_FONT }}>
            {preview ? (
              <>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: WON_MUTED }}>{t("outlet.new.priceResult")}</span>
                <s style={{ fontSize: 15, color: WON_MUTED }}>{money(preview.before, shopCurrency)}</s>
                <span aria-hidden="true" style={{ color: WON_MUTED }}>→</span>
                <span style={{ fontSize: 20, fontWeight: 700, color: WON_INK }}>{money(preview.after, shopCurrency)}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: WON_INK }}>−{live.percent} %</span>
              </>
            ) : (
              <span style={{ fontSize: 13.5, color: WON_MUTED }}>{priceLine}</span>
            )}
          </div>
          <details style={{ fontFamily: WON_FONT }}>
            <summary {...hoverMark("link")} style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: WON_MUTED }}>{t("outlet.new.more")}</summary>
            <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
              <RowNote>{t("outlet.new.quotaHint")}</RowNote>
              <RowNote>{t("outlet.new.endsOnHint")}</RowNote>
            </div>
          </details>
          {priceLists.length > 0 ? (
            <s-stack direction="block" gap="small-300">
              <s-text type="strong">{t("outlet.new.lists")}</s-text>
              {priceLists.map((l) => (
                <s-checkbox
                  key={l.id}
                  name={F.priceList}
                  value={l.id}
                  label={`${l.title} (${l.currency})`}
                  checked={boolAttr(seed.all(F.priceList, []).includes(l.id))}
                  disabled={boolAttr(!pro)}
                />
              ))}
              {err(F.priceList) ? <RowNote tone="attention">{err(F.priceList)}</RowNote> : <RowNote>{t("outlet.new.listsHint")}</RowNote>}
            </s-stack>
          ) : err(F.priceList) ? (
            <RowNote tone="attention">{err(F.priceList)}</RowNote>
          ) : null}
        </StepCard>
        {/* Step 2 (feedback 9 Oct 2026, 4th round): how THIS sale shows is set with the sale, next to what the customer will see. */}
        <StepCard n={2} of={4} title={t("outlet.step.web")} hint={t("outlet.step.web.hint")}>
          {/* Left what is set, right what the customer will see: the two never sit under each other on a wide screen. */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, alignItems: "start" }}>
            <s-stack direction="block" gap="base">
              <div>
                <s-select name={F.saleDisplay} label={t("outlet.display.label")} value={seed.one(F.saleDisplay, display)} disabled={boolAttr(!pro)}>
                  {DISPLAYS.map((d) => (
                    <s-option key={d} value={d} selected={boolAttr(d === seed.one(F.saleDisplay, display))}>
                      {t(`outlet.display.${d}` as "outlet.display.strike")}
                    </s-option>
                  ))}
                </s-select>
                <FieldMessage text={err(F.saleDisplay)} />
              </div>
              {/* The badge's text exists only for a level with a badge (B7: a field that is shown is always read). */}
              {saleBadge ? (
                <div>
                  <s-text-field name={F.message} label={t("outlet.message.label")} value={seed.one(F.message, "")} placeholder={t("looks.sample.outlet.badge")} maxLength={80} details={t("outlet.message.hint")} disabled={boolAttr(!pro)} />
                  <FieldMessage text={err(F.message)} />
                </div>
              ) : null}
              <details style={{ fontFamily: WON_FONT }}>
                <summary {...hoverMark("link")} style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: WON_MUTED }}>{t("outlet.display.more")}</summary>
                <div style={{ marginTop: 6 }}>
                  <RowNote>{t("outlet.display.note")}</RowNote>
                </div>
              </details>
            </s-stack>
            <div style={{ display: "grid", gap: 10 }}>
              <SalePreview
                price={preview ? { now: money(preview.after, shopCurrency), before: money(preview.before, shopCurrency) } : null}
                display={saleDisplay}
                message={live.message}
                left={live.quota ?? 0}
                emptyText={t("outlet.preview.priceUnknown")}
              />
              {saleBadge ? (
                // The badge is a block of the theme: said here, with the button that adds it, before the sale starts.
                <div data-won-outlet-preview-block={badge} style={{ display: "grid", gap: 6 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                    <PlacementPill placement={badge} move={badgeMove} />
                    <RowNote tone={badge === "missing" ? "attention" : undefined}>{t(badge === "in_theme" ? "outlet.preview.blockOn" : badge === "missing" ? "outlet.preview.blockMissing" : "outlet.preview.blockUnknown")}</RowNote>
                  </div>
                  <SpotNote placement={badge} spot={props.placed?.spots?.outletBadge} place="product" spotKey="outletBadge" />
                  {badge !== "in_theme" && badgeBlockAddUrl ? (
                    <div>
                      <s-button href={badgeBlockAddUrl} target="_top" variant={badge === "missing" ? "primary" : "secondary"}>
                        {t("outlet.web.addBlock")}
                      </s-button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </StepCard>
        {/* Step 3 (feedback 10 Oct 2026, bod 5): what this sale combines with is decided with the sale, in plain words. */}
        <StepCard n={3} of={4} title={t("outlet.step.combine")} hint={t("outlet.step.combine.hint")}>
          <CombineChoice
            combine={withOthers || live.combine}
            takes={live.combineWith}
            // The shop-wide rule already lets every sale take the other discounts: nothing to pick per sale.
            forced={withOthers}
            disabled={!pro}
            error={err(F.combineWith)}
          />
        </StepCard>
        <StepCard n={4} of={4} title={t("outlet.step.start")} hint={t("outlet.step.start.hint")} last>
          {/* The whole sale once more, one row a decision, before the one button. */}
          <div data-won-outlet-summary="" style={{ border: `1px solid ${WON_LINE}`, borderRadius: 12, overflow: "hidden", fontFamily: WON_FONT }}>
            {(
              [
                [t("outlet.check.what"), summary],
                [t("outlet.check.web"), t(`outlet.display.${saleDisplay}` as "outlet.display.strike")],
                [t("outlet.check.combine"), newTakes.length === 0 ? t("outlet.combine.state.none") : newTakes.length === COMBINE_CLASSES.length ? t("outlet.combine.state.all") : tr.list(newTakes.map((c) => t(`outlet.combine.${c}.short` as "outlet.combine.tiers.short")))],
              ] as const
            ).map(([label, value], i) => (
              <div key={label} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 180px) minmax(0, 1fr)", gap: 12, padding: "10px 14px", background: i % 2 === 0 ? WON_WASH : WON_SURFACE, borderTop: i === 0 ? "none" : `1px solid ${WON_LINE}` }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: WON_MUTED }}>{label}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: WON_INK, overflowWrap: "anywhere" }}>{value}</span>
              </div>
            ))}
          </div>
          <RowNote>{t("outlet.new.backup")}</RowNote>
          <div>
            <s-button type="submit" variant="primary" disabled={boolAttr(!pro)}>
              {t("outlet.new.start")}
            </s-button>
          </div>
        </StepCard>
      </div>
    </Form>
  );

  // Which panel is open: a result decides first (a sale just started or ended → the sales; a refused start → the
  // form with what was typed; a refused setting → the settings), then a deep link (#running, #new, #combine…),
  // else the sales when something runs and the form when nothing does.
  const viewFor = (): OutletView => {
    if (isOutletResult(result)) {
      if (result.ok) return "sales";
      if (result.reason === "invalid" && result.errors.some((e) => e.field === F.display || e.field === F.reopen)) return "info";
      return "new";
    }
    return running.length > 0 || (!pro && ended.length > 0) ? "sales" : "new";
  };
  const [view, setView] = useState<OutletView>(viewFor);
  useEffect(() => {
    setView(viewFor());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new result moves the page
  }, [result]);
  useEffect(() => {
    const fromHash = HASH_VIEW[window.location.hash.slice(1)];
    if (fromHash && !isOutletResult(result)) setView(fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a deep link is read once
  }, []);

  // B15: on Free the settings matter only while earlier sales still run (the server refuses the save the same way).
  const settingsShown = pro || running.length > 0;
  const activeRuns = running.filter((r) => r.status === "active");

  // The page is three tiles and ONE panel at a time (feedback 6 Oct 2026: no long scroll; a running sale is the
  // first thing seen, a sale just started is shown, not hidden under the form).
  const panel = (key: OutletView, children: ReactNode) => (
    <div data-won-view-panel={key} style={{ display: view === key ? "block" : "none" }}>
      <s-stack direction="block" gap="base">{children}</s-stack>
    </div>
  );
  // N16: "3 věci k vyřešení" names them — one row each at the top of the panel, with the link to the sale.
  const titleOf = (run: OutletRunView) => run.title || t("outlet.run.unknown");
  const todo: { key: string; text: string; runId: string }[] = [
    ...running.filter((r) => r.status === "active" && r.oversold > 0).map((r) => ({ key: `o${r.id}`, text: t("outlet.todo.oversold", { title: titleOf(r), n: r.oversold }), runId: r.id })),
    ...running.filter((r) => r.problem).map((r) => ({ key: `p${r.id}`, text: t("outlet.todo.problem", { title: titleOf(r), problem: r.problem ?? "" }), runId: r.id })),
    ...ended.filter((r) => r.returnPending > 0).map((r) => ({ key: `r${r.id}`, text: t("outlet.todo.pending", { title: titleOf(r), n: r.returnPending }), runId: r.id })),
  ];
  const runningTitles = running.map((r) => r.title).filter(Boolean);
  // The editor opens on a product that IS on sale: on the default product the badge has nothing to say.
  const saleEditorUrl = running.find((r) => r.editorUrl)?.editorUrl ?? null;
  const salesActive =
    running.length > 0
      ? runningTitles.length > 0
        ? t("overview.outlet.runningNamed", { names: tr.list(runningTitles) })
        : tr.tp("overview.outlet.running", running.length)
      : ended.length > 0
        ? t("outlet.view.sales.endedOnly", { n: ended.length })
        : t("overview.outlet.none");

  return (
    <s-page heading={t("module.outlet")}>
      <DiscountsSubNav active="outlet" />
      <s-stack direction="block" gap="base">
        {isOutletResult(result) ? <OutletBanner result={result} /> : <Notice result={result as UiResult | null | undefined} />}
        {!ordersCounted && (pro || running.length > 0) ? (
          <s-banner tone="warning" heading={t("outlet.orders.off")} data-won-outlet-orders="off">
            <s-paragraph>
              {t("outlet.orders.offDetail")}{" "}
              {pro ? (
                <s-link href={`#${ENDS_ANCHOR}`} onClick={() => setView("new")}>
                  {t("outlet.orders.link")}
                </s-link>
              ) : null}
            </s-paragraph>
          </s-banner>
        ) : null}
        {!pro && running.length > 0 ? <RowNote>{t("outlet.pro.running")}</RowNote> : null}

        <ModuleTiles label={t("outlet.view.label")} columns={4}>
          <ViewTile id="sales" title={t("outlet.view.sales.title")} glyph="calendar" active={salesActive} status={running.length > 0 ? props.status : undefined} selected={view === "sales"} onPick={() => setView("sales")} />
          <ViewTile id="new" title={t("outlet.view.new.title")} glyph="tag" action about={t("outlet.view.new.tile")} active={pro ? (view === "new" ? summary : undefined) : t("overview.outlet.locked")} pro={!pro} locked={!pro} selected={view === "new"} onPick={() => setView("new")} />
          <ViewTile
            id="web"
            title={t("outlet.view.web.title")}
            glyph="store"
            active={t(badge === "in_theme" ? (badgeMove ? "outlet.view.web.move" : "outlet.view.web.on") : badge === "missing" ? "outlet.view.web.missing" : "outlet.view.web.unknown")}
            issues={badge === "missing" || badgeMove ? 1 : 0}
            selected={view === "web"}
            onPick={() => setView("web")}
          />
          <ViewTile id="info" title={t("outlet.view.info.title")} glyph="sliders" active={t(withOthers ? "outlet.combine.summary.on" : "outlet.combine.summary.off")} selected={view === "info"} onPick={() => setView("info")} />
        </ModuleTiles>

        {panel(
          "sales",
          <>
            {running.length === 0 && ended.length === 0 ? (
              <WonSection
                title={t("outlet.view.sales.title")}
                glyph="calendar"
                summary={t("outlet.sales.empty")}
                action={
                  <s-button variant="primary" onClick={() => setView("new")}>
                    {t("outlet.view.new.title")}
                  </s-button>
                }
              />
            ) : null}
        {todo.length > 0 ? (
          <WonSection title={t("outlet.todo.title")} glyph="alert" anchor="todo">
            <div data-won-outlet-todo>
              {todo.map((item) => (
                <WonRow
                  key={item.key}
                  tone="attention"
                  action={
                    <s-button href={`#${runAnchor(item.runId)}`} variant="secondary">
                      {t("outlet.todo.show")}
                    </s-button>
                  }
                >
                  <RowNote tone="attention">{item.text}</RowNote>
                </WonRow>
              ))}
            </div>
          </WonSection>
        ) : null}
        {running.length > 0 ? (
          <WonSection title={t("outlet.running.title")} glyph="calendar" anchor="running">
            <s-stack direction="block" gap="base">
              {running.map((run) => (
                <RunCard key={run.id} run={run} pro={pro} money={money} badgeOn={display.startsWith("strike_badge")} display={display} withOthers={withOthers} badge={badge} badgeAddUrl={badgeBlockAddUrl} badgeSpot={props.placed?.spots?.outletBadge} result={result} />
              ))}
            </s-stack>
          </WonSection>
        ) : null}

            {/* Ended sales are the last thing of the panel. */}
        {ended.length > 0 ? (
          <WonSection title={t("outlet.ended.title")} glyph="receipt" summary={t("outlet.ended.count", { n: ended.length })} anchor="ended" collapsible defaultOpen={ended.some((r) => r.returnPending > 0)}>
            <s-stack direction="block" gap="base">
              {ended.map((run) => (
                <RunCard key={run.id} run={run} pro={pro} money={money} badgeOn={display.startsWith("strike_badge")} display={display} withOthers={withOthers} badge={badge} badgeAddUrl={badgeBlockAddUrl} badgeSpot={props.placed?.spots?.outletBadge} result={result} />
              ))}
            </s-stack>
          </WonSection>
        ) : null}

          </>,
        )}

        {panel("new", <>
        {/* Pro: the tile above is the heading (7th round: a second "Nový výprodej" under it said nothing new) and carries the
            live summary; the four steps stand on the page as four cards of their own. */}
        {pro ? (
          <div id="new" style={{ scrollMarginTop: 16 }}>{form}</div>
        ) : (
          <WonSection title={t("outlet.new.title")} glyph="tag" pro locked hint={t("outlet.view.new.about")} anchor="new">
            <s-stack direction="block" gap="base">
              <ProSell benefit={t("outlet.pro.benefit")} />
              <ProFrame locked>{form}</ProFrame>
            </s-stack>
          </WonSection>
        )}

        </>)}

        {panel(
          "web",
          <>
        {/* Bod 5: the sale badge in the theme — the same label and header button as every placement. */}
        {settingsShown && badgeBlockAddUrl ? (
          <WonSection
            title={t("outlet.badge.title")}
            glyph="store"
            summary={t("outlet.badge.hint")}
            anchor="badge"
            placement={badge}
            placementMove={badgeMove}
            action={
              <s-button href={editorOnProductOf(badge === "in_theme" ? (editorOpenUrl(badgeBlockAddUrl, props.placed?.spots?.outletBadge) ?? badgeBlockAddUrl) : badgeBlockAddUrl, saleEditorUrl) ?? badgeBlockAddUrl} target="_top" variant={badge === "missing" ? "primary" : "secondary"}>
                {t(badge === "in_theme" ? "placement.open" : "placement.add")}
              </s-button>
            }
          >
            <SpotNote placement={badge} spot={props.placed?.spots?.outletBadge} place="product" spotKey="outletBadge" />
          </WonSection>
        ) : null}
        {/* The badge's look on the storefront (its own form). */}
        {settingsShown && props.look ? <LookSection look={props.look} plan={plan} configVersion={configVersion} /> : null}

          </>,
        )}

        {panel(
          "info",
          <>
        {/* What a clearance item combines with: said here in full, computed from the one switch in Nastavení (never left to guesswork). */}
        <WonSection title={t("outlet.combine.title")} glyph="sliders" anchor="combine">
          {/* Which running sale takes what (feedback 10 Oct 2026, bod 5; per discount since the 6th round). */}
          {activeRuns.length > 0 ? (
            <div data-won-outlet-combine-list="" style={{ display: "grid", gap: 10, marginBottom: 14 }}>
              {activeRuns.map((r) => (
                <SubCard
                  key={r.id}
                  marker={{ "data-won-outlet-combine-row": r.id }}
                  title={titleOf(r)}
                  action={
                    pro && !withOthers ? (
                      <s-button href={`#${runAnchor(r.id)}`} variant="secondary" onClick={() => setView("sales")}>
                        {t("outlet.combine.edit")}
                      </s-button>
                    ) : undefined
                  }
                >
                  <CombineMarks takes={withOthers ? COMBINE_CLASSES : r.combineWith} />
                </SubCard>
              ))}
            </div>
          ) : null}
          <div>
            <WonRow>
              <RowNote>{t("outlet.combine.price")}</RowNote>
            </WonRow>
            {(["tiers", "product", "order"] as const).map((key) => (
              <WonRow key={key}>
                <s-text type="strong">{t(`outlet.combine.${key}.label` as "outlet.combine.tiers.label")}</s-text>
                <RowNote>{t("outlet.combine.when.on")} {t(`outlet.combine.${key}.on` as "outlet.combine.tiers.on")}</RowNote>
                <RowNote>{t("outlet.combine.when.off")} {t(`outlet.combine.${key}.off` as "outlet.combine.tiers.off")}</RowNote>
              </WonRow>
            ))}
            {(["shipping", "rewards"] as const).map((key) => (
              <WonRow key={key}>
                <s-text type="strong">{t(`outlet.combine.${key}.label` as "outlet.combine.shipping.label")}</s-text>
                <RowNote>{t(`outlet.combine.${key}.always` as "outlet.combine.shipping.always")}</RowNote>
              </WonRow>
            ))}
            <WonRow action={<s-link href="/app/settings#combination">{t("outlet.combine.change")}</s-link>}>
              <RowNote>{t(withOthers ? "outlet.combine.switch.on" : "outlet.combine.switch.off")}</RowNote>
            </WonRow>
          </div>
        </WonSection>
        {settingsShown ? (
          <WonSection title={t("outlet.settings.title")} glyph="sliders" summary={t(`outlet.reopen.${reopen}` as "outlet.reopen.ask")} hint={t("outlet.settings.summary")}>
            <Form method="post">
              <input type="hidden" name={F.intent} value={OUTLET_INTENT.settings} />
              {configVersion ? <input type="hidden" name="configVersion" value={configVersion} /> : null}
              <s-stack direction="block" gap="base">
                {/* How a sale shows is set with each sale (step 2 of a new one, "Upravit zobrazení" of a running one). */}
                <RowNote>{t("outlet.settings.displayMoved")}</RowNote>
                <s-select name={F.reopen} label={t("outlet.reopen.label")} value={reopen}>
                  {REOPENS.map((r) => (
                    <s-option key={r} value={r} selected={boolAttr(r === reopen)}>
                      {t(`outlet.reopen.${r}` as "outlet.reopen.ask")}
                    </s-option>
                  ))}
                </s-select>
                <div>
                  <s-button type="submit" variant="secondary">
                    {t("outlet.settings.save")}
                  </s-button>
                </div>
              </s-stack>
            </Form>
          </WonSection>
        ) : null}
          </>,
        )}
      </s-stack>

      {/* "Ukončit výprodej" asks first (the confirm pattern of the rule editor's delete). */}
      {activeRuns.map((run) => (
        <s-modal key={run.id} id={endDialogId(run.id)} heading={t("outlet.run.end.heading", { name: run.title || t("outlet.run.unknown") })}>
          <s-paragraph>{t("outlet.run.end.body")}</s-paragraph>
          <s-button
            slot="primary-action"
            variant="primary"
            tone="critical"
            commandFor={endDialogId(run.id)}
            command="--hide"
            onClick={() => submit({ [F.intent]: OUTLET_INTENT.end, [F.run]: run.id }, { method: "post" })}
          >
            {t("outlet.run.end")}
          </s-button>
          <s-button slot="secondary-actions" commandFor={endDialogId(run.id)} command="--hide">
            {t("common.cancel")}
          </s-button>
        </s-modal>
      ))}
    </s-page>
  );
}
