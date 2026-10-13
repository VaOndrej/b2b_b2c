// Section 5, Pro "Cílení a kombinace" (A2/§16: visible, amber, never blocks
// Free; BILL-1: the server decides what is saved). Only what checkout can
// evaluate is offered (P8): segment targeting is not a control at all; a rule
// that still has it stored says so and can drop it (B9). Each block says in one
// sentence what it is for.
//   Markets      — the enabled markets; a stored market that is switched off
//                  stays a checked row with a note until the merchant unticks
//                  it (B3). No market at all: where to set them up.
//   Sčítá se s   — every plan (13 Oct 2026, @won/core combine.ts): one checkbox per
//                  TYPE of discount this one can meet; a new discount starts with
//                  the shop's default list for its type. Below it, Pro: the
//                  exceptions — the other discounts whose type is NOT ticked, one
//                  checkbox each (an exception only allows). On a lower plan the
//                  block is shown locked and what is stored stays.
// P3: a Pro setting the plan does not run is marked at that setting, with an
// explicit, submitted way to remove it (works on Free). Market targeting needs
// read_markets, an OPTIONAL scope (item 9): picking a market asks for it
// through App Bridge; without it the note says what that means.

import { useEffect, useRef, useState } from "react";

import { combineTypeOfRule } from "@won/core/discounts/combine";
import { MAX_STACK_CANDIDATES, unsupportedInFunction } from "@won/core/discounts/plan";

import { requestScopes } from "../model/app-bridge";
import { COMBINE_OFFERED, combineTypeLabel, type CombineType } from "../model/combine";
import { describeProSettings } from "../model/describe";
import type { MarketNames } from "../model/markets";
import { FIELD } from "../model/rule-form";
import type { RuleStatus } from "../model/rule-status";
import type { GateNoteView, MarketView } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { CombineTypes } from "../shell/CombineTypes";
import { GateNotes } from "../shell/GateNotes";
import { PlanBadge } from "../shell/PlanBadge";
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
  isNew = false,
  combineDefaults,
}: {
  ed: EditorView;
  pro: boolean;
  /** The draft's live status: marks the Pro setting that keeps it from running. */
  status: RuleStatus;
  /** Enabled markets. */
  markets: MarketView[];
  /** Markets this rule has stored that are switched off (B3). */
  offMarkets?: MarketView[];
  /** Every other discount; `type` = its type for "Sčítá se s" (an order discount of Milníky: "rewards"). */
  otherRules: { id: string; name: string; type?: CombineType }[];
  /** A discount that is not stored yet: its list starts from the shop's default for its type. */
  isNew?: boolean;
  /** What a new discount of each type starts with (Nastavení → Kombinování slev; core defaultCombineFor). */
  combineDefaults?: Record<"automatic" | "code" | "shipping", CombineType[]>;
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
  // "Sčítá se s": the draft's type decides which types it can meet; a NEW discount shows the shop's default for
  // that type (re-mounted when the type changes, so the default follows it until the form is saved).
  const owner = combineTypeOfRule(draft) as "automatic" | "code" | "shipping";
  const offered = COMBINE_OFFERED[owner];
  const startTypes = isNew ? (combineDefaults?.[owner] ?? []) : defaults.combineTypes;
  const liveTypes = draft.combine?.types ?? startTypes;
  // Exceptions: the other discounts this one can meet whose type is not ticked right now.
  const candidates = otherRules.filter((other) => other.type !== undefined && offered.includes(other.type) && !liveTypes.includes(other.type));
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
  const combines = (
    <Anchor id="combines">
      <s-stack direction="block" gap="small-200">
        <s-text type="strong">{t("combine.title")}</s-text>
        <s-text color="subdued">{t("combine.intro")}</s-text>
        <div key={isNew ? owner : "stored"}>
          <CombineTypes owner={owner} checked={startTypes} disabled={readOnly} />
        </div>
        <RowNote>{t("combine.cap", { n: MAX_STACK_CANDIDATES })}</RowNote>
      </s-stack>
    </Anchor>
  );
  const exceptions = (
    <Anchor id="exceptions">
      <s-stack direction="block" gap="small-200">
        {/* (No Pro badge of its own: the frame is the section's one Pro marker, on the markets — bod 6.) */}
        <s-text type="strong">{t("combine.exceptions.title")}</s-text>
        <s-text color="subdued">{t("combine.exceptions.intro")}</s-text>
        {candidates.length === 0 ? <s-text color="subdued">{t("combine.exceptions.none")}</s-text> : null}
        {candidates.map((other) => (
          <s-checkbox
            key={other.id}
            name={FIELD.combineRules}
            value={other.id}
            label={`${other.name || t("common.untitled")} (${combineTypeLabel(other.type as CombineType, tr)})`}
            checked={boolAttr(defaults.combineRules.includes(other.id))}
            disabled={fieldsOff}
          />
        ))}
        {!pro && defaults.combineRules.length > 0 ? <FieldMark text={t("combine.exceptions.locked")} /> : null}
      </s-stack>
    </Anchor>
  );
  return (
    <WonSection
      title={t("editor.pro.title")}
      glyph="target"
      summary={describeProSettings(draft, tr, ruleNames, marketNames)}
      collapsible
      // Open for a Pro shop (§18g: a Pro section is open for the shop that has it), and on Free whenever something
      // is set in it (the plan does not run what is stored).
      // Open always: "Sčítá se s" is every plan's and every discount has it.
      defaultOpen
      anchor="pro"
    >
      <s-stack direction="block" gap="base">
        {gate.length > 0 ? <GateNotes notes={gate} compact pending={gatePending} /> : null}
        {/* The types it adds up with are every plan's and come first; the exceptions and the markets are Pro. */}
        {combines}
        {!pro ? <ProSell benefit={`${t("combine.exceptions.benefit")} ${t("editor.pro.benefit")}`} /> : null}
        <ProFrame locked={!pro}>
          <s-stack direction="block" gap="base">
            {exceptions}
            <Anchor id="markets">
              <div ref={marketsRef}>
                <s-stack direction="block" gap="small-200">
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <s-text type="strong">{t("editor.pro.markets")}</s-text>
                    <PlanBadge tier="pro" locked={!pro} href={pro ? undefined : "/app/plan"} />
                  </span>
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
          </s-stack>
        </ProFrame>
      </s-stack>
    </WonSection>
  );
}
