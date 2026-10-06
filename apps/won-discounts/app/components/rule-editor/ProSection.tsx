// Section 5, Pro "Cílení a kombinace" (A2/§16: visible, amber, never blocks
// Free; BILL-1: the server decides what is saved). Only what checkout can
// evaluate is offered (P8): segment targeting is not a control at all; a rule
// that still has it stored says so and can drop it (B9). Each block says in one
// sentence what it is for.
//   Markets      — the enabled markets; a stored market that is switched off
//                  stays a checked row with a note until the merchant unticks
//                  it (B3). No market at all: where to set them up.
//   Combinations — hidden until a second discount exists; the sentence about
//                  the stack cap only once the ticked rules reach it; what
//                  happens by default is said as it is (core plan.ts: discounts
//                  of the same kind never add up, the better one applies;
//                  across products / order / shipping the Nastavení switches decide).
// P3: a Pro setting the plan does not run is marked at that setting, with an
// explicit, submitted way to remove it (works on Free). Market targeting needs
// read_markets, an OPTIONAL scope (item 9): picking a market asks for it
// through App Bridge; without it the note says what that means.

import { useEffect, useRef, useState } from "react";

import { MAX_STACK_CANDIDATES, unsupportedInFunction } from "@won/core/discounts/plan";

import { requestScopes } from "../model/app-bridge";
import { describeProSettings } from "../model/describe";
import type { MarketNames } from "../model/markets";
import { FIELD } from "../model/rule-form";
import type { RuleStatus } from "../model/rule-status";
import type { GateNoteView, MarketView } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { GateNotes } from "../shell/GateNotes";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { RowNote, WonSection } from "../shell/WonSection";
import { Anchor, FieldMark, type EditorView } from "./parts";

/** Shopify admin → Settings → Markets (App Bridge `shopify://admin`, §13a: the fix is there). */
const SHOPIFY_MARKETS = "shopify://admin/settings/markets";

export function ProSection({
  ed,
  pro,
  status,
  markets,
  offMarkets = [],
  otherRules,
  gate = [],
  gatePending = false,
  marketsScope = true,
}: {
  ed: EditorView;
  pro: boolean;
  /** The draft's live status: marks the Pro setting that keeps it from running. */
  status: RuleStatus;
  /** Enabled markets. */
  markets: MarketView[];
  /** Markets this rule has stored that are switched off (B3). */
  offMarkets?: MarketView[];
  otherRules: { id: string; name: string }[];
  /** This rule's Pro settings the plan does not run. */
  gate?: readonly GateNoteView[];
  /** Checkout still runs these Pro settings until the resync under way (I-2). */
  gatePending?: boolean;
  /** read_markets granted. */
  marketsScope?: boolean;
}) {
  const { draft, defaults, tr, readOnly } = ed;
  const { t } = tr;
  const ruleNames = new Map(otherRules.map((r) => [r.id, r.name]));
  const marketNames: MarketNames = Object.fromEntries([...markets, ...offMarkets].map((m) => [m.handle, m.name]));
  const storedSegments = defaults.segments > 0;
  const liveSegments = unsupportedInFunction(draft).length > 0;
  const liveMarkets = draft.targeting?.markets ?? [];
  const liveCombines = draft.combinesWith?.ruleIds ?? [];
  const fieldsOff = boolAttr(!pro || readOnly);
  const off = boolAttr(readOnly);
  const [scope, setScope] = useState<"granted" | "missing" | "declined">(marketsScope ? "granted" : "missing");
  const marketsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = marketsRef.current;
    if (!el || scope === "granted") return;
    const onChange = (event: Event) => {
      const target = event.target as { name?: string; checked?: boolean } | null;
      if (target?.name !== FIELD.markets || !target.checked) return;
      void requestScopes(["read_markets"]).then((result) => {
        if (result === "granted") setScope("granted");
        else if (result === "declined") setScope("declined");
      });
    };
    el.addEventListener("change", onChange);
    return () => el.removeEventListener("change", onChange);
  }, [scope]);
  const anyMarket = markets.length + offMarkets.length > 0;
  // The stack is searched among the MAX_STACK_CANDIDATES best discounts, this one included.
  const atCap = liveCombines.length + 1 >= MAX_STACK_CANDIDATES;
  return (
    <WonSection
      title={t("editor.pro.title")}
      glyph="target"
      pro
      locked={!pro}
      summary={describeProSettings(draft, tr, ruleNames, marketNames)}
      collapsible
      // Open whenever something is set in it (or the plan does not run what is stored).
      defaultOpen={storedSegments || defaults.markets.length > 0 || defaults.combinesWith.length > 0 || gate.length > 0}
      anchor="pro"
    >
      <s-stack direction="block" gap="base">
        {gate.length > 0 ? <GateNotes notes={gate} compact pending={gatePending} /> : null}
        {!pro ? <ProSell benefit={t("editor.pro.benefit")} /> : null}
        <ProFrame locked={!pro}>
          <s-stack direction="block" gap="base">
            <Anchor id="markets">
              <div ref={marketsRef}>
                <s-stack direction="block" gap="small-200">
                  <s-text type="strong">{t("editor.pro.markets")}</s-text>
                  <s-text color="subdued">{t("editor.pro.marketsIntro")}</s-text>
                  {scope !== "granted" && anyMarket ? (
                    <RowNote tone={scope === "declined" ? "attention" : undefined}>
                      {t(scope === "declined" ? "editor.pro.marketsScopeDeclined" : "editor.pro.marketsScope")}
                    </RowNote>
                  ) : null}
                  {!anyMarket ? (
                    <s-stack direction="inline" gap="small-200" alignItems="center">
                      <s-text color="subdued">{t("editor.pro.marketsNone")}</s-text>
                      <s-link href={SHOPIFY_MARKETS} target="_top">
                        {t("editor.pro.marketsOpen")}
                      </s-link>
                    </s-stack>
                  ) : null}
                  {markets.map((m) => (
                    <s-checkbox key={m.handle} name={FIELD.markets} value={m.handle} label={m.name} checked={boolAttr(defaults.markets.includes(m.handle))} disabled={fieldsOff} />
                  ))}
                  {offMarkets.map((m) => (
                    // B3: stored, switched off — kept (it is submitted while ticked) and said, never dropped silently.
                    <div key={m.handle}>
                      <s-checkbox name={FIELD.markets} value={m.handle} label={m.name} checked disabled={fieldsOff} />
                      {liveMarkets.includes(m.handle) ? <FieldMark text={t("editor.mark.marketOff", { market: m.name })} /> : null}
                    </div>
                  ))}
                  {status.kind === "market_off" ? <FieldMark text={t("editor.mark.marketsAllOff")} /> : null}
                  {!pro && defaults.markets.length > 0 ? (
                    // The plan does not run market targeting (BILL-1): the rule is off until it is removed or the plan changes.
                    <div>
                      {liveMarkets.length > 0 ? <FieldMark text={t("editor.mark.proMarkets")} /> : null}
                      <s-checkbox name={FIELD.dropMarkets} value="on" label={t("editor.pro.dropMarkets")} disabled={off} />
                    </div>
                  ) : null}
                </s-stack>
              </div>
            </Anchor>
            {storedSegments ? (
              <Anchor id="segments">
                {liveSegments ? <FieldMark text={t("editor.pro.segmentsStored")} /> : null}
                <s-checkbox name={FIELD.dropSegments} value="on" label={t("editor.pro.dropSegments")} disabled={off} />
              </Anchor>
            ) : null}
            <Anchor id="combines">
              <s-stack direction="block" gap="small-200">
                <s-text type="strong">{t("editor.pro.combines")}</s-text>
                {otherRules.length === 0 ? (
                  <s-stack direction="inline" gap="small-200" alignItems="center">
                    <s-text color="subdued">{t("editor.pro.combinesNone")}</s-text>
                    <s-link href="/app/discounts/new">{t("editor.pro.combinesCreate")}</s-link>
                  </s-stack>
                ) : (
                  <>
                    <s-text color="subdued">{t("editor.pro.combinesIntro")}</s-text>
                    {otherRules.map((other) => (
                      <s-checkbox
                        key={other.id}
                        name={FIELD.combinesWith}
                        value={other.id}
                        label={other.name || t("common.untitled")}
                        checked={boolAttr(defaults.combinesWith.includes(other.id))}
                        disabled={fieldsOff}
                      />
                    ))}
                    {atCap ? <RowNote>{t("editor.pro.combinesCap", { n: MAX_STACK_CANDIDATES })}</RowNote> : null}
                    <RowNote>
                      {t("editor.pro.combinesDefault")} <s-link href="/app/settings#combination">{t("editor.pro.combinesSettings")}</s-link>
                    </RowNote>
                  </>
                )}
                {!pro && defaults.combinesWith.length > 0 ? (
                  // Stored, not used on this plan (the rule itself still runs): said, with an explicit way to remove it.
                  <div>
                    {liveCombines.length > 0 ? <FieldMark tone="info" text={t("editor.mark.proCombines")} /> : null}
                    <s-checkbox name={FIELD.dropCombines} value="on" label={t("editor.pro.dropCombines")} disabled={off} />
                  </div>
                ) : null}
              </s-stack>
            </Anchor>
          </s-stack>
        </ProFrame>
      </s-stack>
    </WonSection>
  );
}
