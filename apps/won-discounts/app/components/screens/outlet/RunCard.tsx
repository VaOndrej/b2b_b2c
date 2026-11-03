// Výprodej, the parts of the screen (outlet/OutletScreen.tsx): one sale's row (RunCard) with its preview, what it
// combines with, the banner of an action's result and the shared constants of the page.

import { useEffect, useState } from "react";
import { Form } from "react-router";
import { OUTLET_COMBINE_CLASSES } from "@won/core/discounts/outlet";
import { useT } from "../../../i18n/context";
import { hoverMark } from "../../shell/hover";
import { OUTLET_FIELD, OUTLET_INTENT } from "../../model/outlet";
import type { OutletActionResult, OutletRunView, OutletScreenData, PlacementSpot, UiResult } from "../../model/types";
import { FieldMessage } from "../../rule-editor/parts";
import { boolAttr } from "../../shell/attrs";
import { editorOnProductOf, editorOpenUrl, spotAdvice } from "../../model/embed";
import { outletBadgeText, outletWebLine } from "../../model/outlet-web";
import { choiceCardStyle, SubCard } from "../../shell/SubCard";
import { WON_ATTENTION_EDGE, WON_CARD_SHADOW, WON_CHIP, WON_FAINT, WON_FONT, WON_INK, WON_LINE, WON_LIVE, WON_LIVE_EDGE, WON_LIVE_TEXT_DEEP, WON_LIVE_TINT, WON_MUTED, WON_ON_FILL, WON_SELECT_EDGE, WON_SURFACE, WON_WASH } from "../../shell/tokens";
import { type PlacementState, RowNote, WonRow } from "../../shell/WonSection";
import { StatusBadge } from "../../shell/StatusBadge";
import { CardCheckbox, CardRadio } from "../../shell/Controls";

export const F = OUTLET_FIELD;
export const DISPLAYS = ["silent", "strike", "strike_badge", "strike_badge_left"] as const;
export const REOPENS = ["ask", "auto", "never"] as const;
export const COMBINE_CLASSES = OUTLET_COMBINE_CLASSES;
/** Where the "sold pieces are not counted" warning points: the end-date field of the new sale. */
export const ENDS_ANCHOR = "outlet-ends";

/** The three panels of the page (the tiles on top switch between them). */
export type OutletView = "sales" | "new" | "web" | "info";
/** Deep links of the sections → the panel that holds them. */
export const HASH_VIEW: Readonly<Record<string, OutletView>> = { running: "sales", ended: "sales", new: "new", [ENDS_ANCHOR]: "new", combine: "info", badge: "web", "look-outlet": "web", settings: "info" };
export const endDialogId = (runId: string) => `won-outlet-end-${runId.replace(/[^A-Za-z0-9_-]/g, "")}`;

export interface OutletScreenProps extends OutletScreenData {
  result?: OutletActionResult | UiResult | null;
}

/** The picked variant: its name and (when the picker gave one) its price in the shop currency. */
export interface PickedSaleVariant {
  id: string;
  productId: string;
  title: string;
  price?: string;
}

export const isOutletResult = (r: OutletActionResult | UiResult | null | undefined): r is OutletActionResult =>
  !!r && ((r.ok && "kind" in r) || (!r.ok && (r.reason === "failed" || (r.reason === "invalid" && !("message" in r)))));

export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function OutletBanner({ result }: { result: OutletActionResult }) {
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
export const runAnchor = (id: string) => `run-${id.replace(/[^A-Za-z0-9_-]/g, "")}`;

export type Combine = (typeof COMBINE_CLASSES)[number];

/**
 * What a sale combines with (step 3 of a new one, and "Změnit" at a running one): two cards to click, and under
 * "I s vybranými slevami" a box to tick for each discount — one sale may take the quantity discount and no codes,
 * another the opposite (feedback 10 Oct 2026, 6th round). Native inputs: the live draft and the server read the
 * same fields; the boxes keep their ticks while the other card is chosen (they are simply not read then).
 */
export function CombineChoice({ combine, takes, shop, disabled, error }: { combine: boolean; takes: readonly Combine[]; shop: string; disabled: boolean; error?: string }) {
  const { t } = useT();
  const [on, setOn] = useState(combine);
  const off = disabled;
  const head = (value: "0" | "1", picked: boolean) => (
    <>
      <CardRadio name={F.combine} value={value} defaultChecked={picked} disabled={off} onChange={() => setOn(value === "1")} style={{ marginTop: 3 }} />
      <span style={{ fontSize: 14.5, fontWeight: 700, color: WON_INK }}>{t(value === "1" ? "outlet.combine.choice.on" : "outlet.combine.choice.shop")}</span>
      <span style={{ gridColumn: 2, fontSize: 13, lineHeight: 1.45, color: WON_MUTED }}>{value === "1" ? t("outlet.combine.choice.on.hint") : t("outlet.combine.choice.shop.hint", { summary: shop })}</span>
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
          <div data-won-outlet-combine-with="" style={{ gridColumn: "1 / -1", marginTop: 10, paddingTop: 10, borderTop: `1px solid ${on ? WON_SELECT_EDGE : WON_LINE}`, display: "grid", gap: 8, opacity: on ? 1 : 0.55 }}>
            <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: WON_MUTED }}>{t("outlet.combine.with.title")}</span>
            {COMBINE_CLASSES.map((c) => (
              <label key={c} style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "0 10px", alignItems: "start", cursor: off || !on ? "default" : "pointer" }}>
                <CardCheckbox name={F.combineWith} value={c} defaultChecked={takes.includes(c)} disabled={off || !on} style={{ marginTop: 3, width: 16, height: 16 }} />
                <span style={{ fontSize: 13.5, fontWeight: 600, color: WON_INK }}>{t(`outlet.combine.${c}.label` as "outlet.combine.tiers.label")}</span>
                <span style={{ gridColumn: 2, fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>{t(`outlet.combine.${c}.pick` as "outlet.combine.tiers.pick")}</span>
              </label>
            ))}
            <span style={{ fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>{t("outlet.combine.with.always")}</span>
          </div>
        </div>
      </div>
      <FieldMessage text={error} />
    </div>
  );
}

/**
 * What a sale takes, read without guessing (7th round: three struck-through chips did not say "does not apply"):
 * one sentence of the outcome, then each discount on its own line with the word "Přičte se" or "Nepřičte se".
 */
export const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What a sale takes: its own choice (Pro) with a mark per class, or the list of Výprodej (`shop`, a sentence). */
export function RunTakes({ run, shop }: { run: OutletRunView; shop: string }) {
  const { t } = useT();
  if (!run.combine) {
    return (
      <>
        <div style={{ fontFamily: WON_FONT, fontSize: 14, fontWeight: 700, color: WON_INK }}>{t("outlet.combine.state.shop")}</div>
        <RowNote>{shop}</RowNote>
      </>
    );
  }
  const takes = run.combineWith;
  return (
    <>
      <div style={{ fontFamily: WON_FONT, fontSize: 14, fontWeight: 700, color: WON_INK }}>{t(takes.length === 0 ? "outlet.combine.state.none" : takes.length === COMBINE_CLASSES.length ? "outlet.combine.state.all" : "outlet.combine.state.some")}</div>
      <CombineMarks takes={takes} />
    </>
  );
}

export function CombineMarks({ takes }: { takes: readonly Combine[] }) {
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
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "0 0 auto", padding: "2px 10px 2px 6px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, lineHeight: 1.4, color: yes ? WON_LIVE_TEXT_DEEP : WON_MUTED, background: yes ? WON_LIVE_TINT : WON_WASH, border: `1px solid ${yes ? WON_LIVE_EDGE : WON_LINE}` }}>
                <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: WON_ON_FILL, background: yes ? WON_LIVE : WON_FAINT }}>
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
export function SalePreview({ price, display, message, left, emptyText }: { price: { now: string; before: string } | null; display: (typeof DISPLAYS)[number]; message: string; left: number; emptyText: string }) {
  const { t } = useT();
  const badge = display.startsWith("strike_badge");
  return (
    <div data-won-outlet-preview="" style={{ border: `1px solid ${WON_LINE}`, borderRadius: 12, background: WON_CHIP, padding: 12, fontFamily: WON_FONT }}>
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

export function RunCard({
  run,
  pro,
  money,
  badgeOn = false,
  display,
  shop,
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
  /** The sales' own list ("Sčítá se s" of Výprodej) as a sentence: what a sale without its own choice takes. */
  shop: string;
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
  // The row's details: open by themselves when the sale needs a decision, a save was refused, or a link leads here.
  const refused = !!result && !result.ok;
  const [open, setOpen] = useState(run.oversold > 0 || (!!run.problem && run.retry) || (run.status === "ended" && run.returnPending > 0) || refused);
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === `#${runAnchor(run.id)}`) setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a deep link is read once
  }, []);
  const combineError = result && !result.ok && result.reason === "invalid" && "errors" in result ? result.errors?.find((e) => e.field === F.combineWith) : undefined;
  const badgeMove = badge === "in_theme" && spotAdvice(badgeSpot)?.move === true;
  const end = active ? (
    <s-button variant="secondary" tone="critical" commandFor={endDialogId(run.id)} command="--show">
      {t("outlet.run.end")}
    </s-button>
  ) : null;
  const statusPill = (
    <StatusBadge plain badge={{ tone: active ? "live" : "neutral", label: t(`outlet.status.${run.status}` as "outlet.status.active") }} marker={{ "data-won-outlet-status": run.status }} />
  );
  const body = (
    <>
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
              label={run.display.startsWith("strike_badge") && run.showBadge ? <StatusBadge placement={badge} move={badgeMove} /> : undefined}
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
                pro && edit !== "combine" ? (
                  <s-button variant="secondary" onClick={() => setEdit("combine")}>
                    {t("outlet.combine.edit")}
                  </s-button>
                ) : undefined
              }
              footer={
                pro && (edit === "combine" || combineError) ? (
                  <Form method="post" data-won-outlet-combine-edit={run.id}>
                    <input type="hidden" name={F.intent} value={OUTLET_INTENT.combine} />
                    <input type="hidden" name={F.run} value={run.id} />
                    <s-stack direction="block" gap="small-300">
                      <CombineChoice combine={run.combine} takes={run.combine ? run.combineWith : COMBINE_CLASSES} shop={shop} disabled={false} error={combineError ? t(combineError.key, combineError.params) : undefined} />
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
              <RunTakes run={run} shop={shop} />
              <RowNote>{t("outlet.combine.with.always")}</RowNote>
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
    </>
  );
  // Every sale is ONE ROW with the same columns, whatever its state (audit 2026-11-03 F9): the product with its state,
  // the price, what is left, the end, the web — so the sales read as one table. A problem is the state label plus its
  // sentence and action in the details; what is set up under it and the history open with "Podrobnosti", by themselves
  // only when the sale needs a decision.
  const cell = { display: "grid", gap: 2, alignContent: "start", minWidth: 0, flex: "1 1 120px" } as const;
  const cellLabel = { fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: WON_MUTED } as const;
  const attention = run.oversold > 0 || (!!run.problem && run.retry) || (ended && run.returnPending > 0);
  return (
    <div id={runAnchor(run.id)} data-won-outlet-run={run.id} data-won-outlet-run-status={run.status} style={{ scrollMarginTop: 16, border: `1px solid ${attention ? WON_ATTENTION_EDGE : WON_LINE}`, borderRadius: 12, background: WON_SURFACE, fontFamily: WON_FONT, overflow: "hidden" }}>
      <div data-won-outlet-facts="" style={{ display: "flex", flexWrap: "wrap", gap: "10px 16px", alignItems: "flex-start", padding: "12px 14px" }}>
        <div style={{ ...cell, flex: "1.6 1 170px" }}>
          <span style={cellLabel}>{t("outlet.fact.product")}</span>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: WON_INK, overflowWrap: "anywhere" }}>{run.title || t("outlet.run.unknown")}</span>
          <span>{statusPill}</span>
        </div>
        <div style={cell}>
          <span style={cellLabel}>{t("outlet.fact.price")}</span>
          {run.price ? (
            <span style={{ fontSize: 14, color: WON_INK }}>
              <span style={{ fontWeight: 700 }}>{money(run.price.sale, run.price.currency)}</span> <s style={{ opacity: 0.55, fontSize: 13 }}>{money(run.price.before, run.price.currency)}</s>
            </span>
          ) : null}
          <span style={{ fontSize: 12.5, color: WON_MUTED }}>−{run.percent} %</span>
        </div>
        <div style={cell}>
          <span style={cellLabel}>{t("outlet.fact.left")}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: WON_INK }}>{t("outlet.fact.leftOf", { left: run.left, quota: run.quota })}</span>
          <div aria-hidden="true" style={{ height: 6, borderRadius: 6, background: WON_LINE, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, run.quota > 0 ? ((run.quota - run.left) / run.quota) * 100 : 0))}%`, background: WON_INK }} />
          </div>
          <span style={{ fontSize: 12.5, color: WON_MUTED }}>{t("outlet.fact.sold", { sold: run.sold, returned: run.returned })}</span>
        </div>
        <div style={cell}>
          <span style={cellLabel}>{t("outlet.fact.end")}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: WON_INK }}>{active ? (run.endsAt ?? t("outlet.fact.noEnd")) : (run.endedAt ?? "—")}</span>
          {!active || run.endsAt ? null : <span style={{ fontSize: 12.5, color: WON_MUTED }}>{t("outlet.fact.noEndHint")}</span>}
        </div>
        <div style={cell}>
          <span style={cellLabel}>{t("outlet.web.card")}</span>
          {active && run.display.startsWith("strike_badge") && run.showBadge ? (
            <span>
              <StatusBadge placement={badge} move={badgeMove} />
            </span>
          ) : (
            <span style={{ fontSize: 13, color: WON_INK }}>{web?.text ?? "—"}</span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "stretch", flex: "0 0 auto", marginLeft: "auto" }}>
          <s-button variant="secondary" onClick={() => setOpen(!open)} data-won-outlet-details={open ? "open" : "closed"}>
            {t(open ? "outlet.run.detailsHide" : "outlet.run.details")}
          </s-button>
          {end}
        </div>
      </div>
      <div data-won-outlet-run-body="" style={{ display: open ? "block" : "none", padding: "12px 14px", borderTop: `1px solid ${WON_LINE}`, background: WON_WASH }}>
        <s-stack direction="block" gap="base">
          {run.webUrl ? (
            <div>
              <s-button href={run.webUrl} target="_blank" variant="secondary">
                {t("outlet.web.open")}
              </s-button>
            </div>
          ) : null}
          {body}
        </s-stack>
      </div>
    </div>
  );
}
