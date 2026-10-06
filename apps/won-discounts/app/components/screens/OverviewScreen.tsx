// Přehled — the admin home (doctrine A3: status first; §19d: a signpost of tiles).
// A presentational component rendered by the embedded route
// (app/routes/app._index.tsx, the shop's config + store signals) and by the dev
// harness (app/routes/dev.preview.$.tsx, fixtures), so the harness screenshots
// the real screen (audit P2-5). Props are plain serializable data built by
// buildOverviewProps(); every word comes from i18n + the core formatter.
//
// Feedback 3 (6 Oct 2026), body 2 a 3: the page is a GRID OF TILES, one per part
// of the app, each a single link to its page. A tile says the part's state with
// the same label the page itself shows (model/module-status.ts) and one sentence
// with the real settings; the detailed rows (the list of discounts, the table in
// the theme, the cost prices, returned pieces of a sale) live on the pages. The
// page does not grow when a module is added.
//
// Above the grid sits only what is not a module and has something to say (P2):
// the setup guide, "Vyžaduje pozornost" (every row links to the field that fixes
// it, P3), the store status (collapsed to one line while everything is fine) and
// the discounts outside Won (only while there is something to do about them).
// With only { schemaVersion, ruleCount, readOnly } the screen still renders: a
// tile whose state is not known says what the part is for and shows no label
// (§12). No router hook runs at this level, so the component also renders
// outside a router (unit renders).

import type { DiscountRule, OnboardingGoal, WonDiscountsConfig } from "@won/core/discounts/config";

import { useT } from "../../i18n/context";
import type { Translator } from "../../i18n";
import { describeMarginSettings, formatMoney } from "@won/core/discounts/describe";

import { NativeDiscountsPanel, nativeSummary } from "../NativeDiscounts";
import { collectWarnings, type RuleWarning } from "../model/describe";
import { currencyCodes, currencyViews } from "../model/markets";
import { embedPlacement } from "../model/embed";
import { moduleStatuses, type ModuleStatus } from "../model/module-status";
import { shopToday } from "../model/rule-form";
import { needsAttention, ruleStatus, ruleStatusSummary, type RuleStatus, type RuleStatusKind } from "../model/rule-status";
import { tierSummary } from "../model/tiers";
import { uiText } from "../model/result-copy";
import { NOT_WIRED_SIGNALS, embedText, nativeNeedsSection, statusAllGood, statusSummary, syncNeedsRetry, syncText, targetingText } from "../model/signals";
import type { AdminSignals, CurrencyView, GateNoteView, RuleSyncMap, UiResult } from "../model/types";
import { GateNotes } from "../shell/GateNotes";
import { ModuleTile, ModuleTiles } from "../shell/ModuleTile";
import { RefreshTargetingButton, ResyncButton } from "../shell/Notice";
import { PlacementPill, RowNote, WonRow, WonSection } from "../shell/WonSection";
import { WON_ATTENTION } from "../shell/tokens";
import { onboardingHasNative, onboardingProgress } from "./OnboardingScreen";

export interface OverviewScreenProps {
  schemaVersion: number;
  ruleCount: number;
  /** The stored config belongs to a newer app version (DATA-3): changes are not saved. */
  readOnly: boolean;
  /** The shop's rules (what runs). Absent → only the count is known. */
  rules?: DiscountRule[];
  currencies?: CurrencyView[];
  /** Onboarding step 1–5 and goals from the config (goals order the modules). */
  onboardingStep?: number;
  goals?: OnboardingGoal[];
  /** Shop-local today and zone: a rule's schedule is judged on the shop's day. */
  today?: string;
  timezone?: string | null;
  /** Store signals (embed, checkout, sync, native discounts). Absent → not connected yet. */
  signals?: AdminSignals;
  /** Per-rule sync facts (is this version in Shopify). Absent → judged by the sync line. */
  ruleSync?: RuleSyncMap;
  /** The last move / undo result, when the page (not the section's fetcher) has it. */
  nativeResult?: UiResult | null;
  /** Pro settings stored but not in force on the shop's plan (BILL-1, explainGate). */
  gate?: GateNoteView[];
  /** Rules the plan switches off. */
  gateOff?: string[];
  /** Checkout still runs a config built with those Pro settings; a resync is under way (I-2). */
  gatePending?: boolean;
  /** Handles of the enabled Won markets (a rule targeting only others never runs). */
  enabledMarkets?: string[];
  /** The plan in force: on Free the Pro cards (Kampaně, Výprodej) say so instead of offering their setup. Absent = not known. */
  plan?: "free" | "pro";
}

export function buildOverviewProps(
  config: WonDiscountsConfig,
  opts: {
    readOnly: boolean;
    signals?: AdminSignals;
    ruleSync?: RuleSyncMap;
    gate?: GateNoteView[];
    gateOff?: string[];
    gatePending?: boolean;
    shopCurrency?: string | null;
    timezone?: string | null;
    marketNames?: Readonly<Record<string, string>>;
    now?: Date;
    plan?: "free" | "pro";
  },
): OverviewScreenProps {
  const rules = config.modules.codes.rules;
  const timezone = opts.timezone ?? null;
  const props: OverviewScreenProps = {
    schemaVersion: config.schemaVersion,
    ruleCount: rules.length,
    readOnly: opts.readOnly,
    rules,
    currencies: currencyViews(config.markets, { shopCurrency: opts.shopCurrency, rules, marketNames: opts.marketNames }),
    onboardingStep: config.onboarding.step,
    goals: [...config.onboarding.goals],
    today: shopToday(timezone, opts.now),
    timezone,
    enabledMarkets: config.markets.filter((m) => m.enabled).map((m) => m.handle),
  };
  if (opts.signals) props.signals = opts.signals;
  if (opts.ruleSync) props.ruleSync = { ...opts.ruleSync };
  if (opts.gate && opts.gate.length > 0) props.gate = opts.gate.map((g) => ({ ...g }));
  if (opts.gateOff && opts.gateOff.length > 0) props.gateOff = [...opts.gateOff];
  if (opts.gatePending) props.gatePending = true;
  if (opts.plan) props.plan = opts.plan;
  return props;
}

function warningText(w: RuleWarning, tr: Translator): string {
  const rule = w.ruleName.trim() || tr.t("common.untitled");
  if (w.kind === "unsupported") return tr.t("overview.warning.unsupported", { rule });
  if (w.kind === "missingCurrency") return tr.t("overview.warning.missingCurrency", { rule, currencies: tr.list(w.currencies ?? []) });
  if (w.kind === "noCode") return tr.t("overview.warning.noCode", { rule });
  if (w.kind === "marketOff") return tr.t("overview.warning.marketOff", { rule });
  return tr.t("overview.warning.noTarget", { rule });
}

function warningFix(w: RuleWarning, tr: Translator): string {
  if (w.kind === "unsupported") return tr.t("overview.warning.unsupported.fix");
  if (w.kind === "missingCurrency") return tr.t("overview.warning.missingCurrency.fix");
  if (w.kind === "noCode") return tr.t("overview.warning.noCode.fix");
  if (w.kind === "marketOff") return tr.t("overview.warning.marketOff.fix");
  return tr.t("overview.warning.noTarget.fix");
}

/** A rule that does not run as set up → the warning (model/describe collectWarnings) that names its field. */
const STATUS_WARNING: Partial<Record<RuleStatusKind, RuleWarning["kind"]>> = {
  unsupported: "unsupported",
  no_code: "noCode",
  no_target: "noTarget",
  no_value: "missingCurrency",
  market_off: "marketOff",
};

/**
 * "Neaktivní: …" in "Aktivní slevy" → the link to the field that fixes it (P3). The anchor is the warning's own
 * `field` (the editor owns the anchor names); a Pro setting the plan does not run and a switched-off
 * market are both set in the Pro block.
 */
export function ruleFix(ruleId: string, status: RuleStatus, warnings: readonly RuleWarning[], tr: Translator): { href: string; label: string } | null {
  if (!needsAttention(status) || status.kind === "sync_failed") return null;
  const warning = warnings.find((w) => w.ruleId === ruleId && w.kind === STATUS_WARNING[status.kind]);
  const field = warning?.field ?? (status.kind === "pro_off" || status.kind === "market_off" ? "pro" : null);
  if (!field) return null;
  return { href: `/app/discounts/${encodeURIComponent(ruleId)}#${field}`, label: warning ? warningFix(warning, tr) : tr.t("overview.running.fix") };
}

const reload = () => window.location.reload();

/**
 * What is active under each tile, one sentence from the real settings (P5). A part whose state the signals
 * do not know has no such line — the tile then only says what the part is for, never an invented state (§12).
 */
function tileBodies(signals: AdminSignals, opts: { codes: string; plan?: "free" | "pro" }, tr: Translator): Record<"codes", string> & Partial<Record<"tiers" | "rewards" | "outlet" | "campaigns" | "margin" | "analytics", string>> {
  const { t } = tr;
  const free = opts.plan === "free";
  const { tiers, rewards, outlet, campaigns, margin, analytics } = signals;

  let tiersBody: string | undefined;
  if (tiers) {
    const names = (tiers.setNames ?? []).filter(Boolean);
    const sets = names.length > 0 ? t("overview.tiers.setsNamed", { names: tr.list(names) }) : t("overview.tiers.sets", { sets: tr.tp("count.tierSet", tiers.sets) });
    tiersBody = tiers.global ? tierSummary(tiers.global, tr) : tiers.sets > 0 ? sets : t("overview.tiers.none");
  }

  let rewardsBody: string | undefined;
  if (rewards) {
    const money = (minor: number) => formatMoney(minor, rewards.currency, tr.locale);
    const lines: string[] = [];
    if (rewards.shipping !== null) lines.push(t("overview.rewards.ship", { amount: money(rewards.shipping) }));
    rewards.gifts.forEach((g, i) => {
      const name = rewards.giftNames?.[i]?.trim();
      if (g === null) lines.push(t("overview.rewards.giftNoCurrency", { currency: rewards.currency }));
      else lines.push(name ? t("overview.rewards.giftNamed", { name, amount: money(g) }) : t("overview.rewards.gift", { amount: money(g) }));
    });
    rewardsBody = lines.length > 0 ? lines.join(" · ") : t("overview.rewards.none");
  }

  let outletBody: string | undefined;
  if (outlet) {
    const titles = (outlet.runningTitles ?? []).filter(Boolean);
    if (outlet.running > 0) outletBody = titles.length > 0 ? t("overview.outlet.runningNamed", { names: tr.list(titles) }) : tr.tp("overview.outlet.running", outlet.running);
    else outletBody = free && outlet.pendingReturns.length === 0 ? t("overview.outlet.locked") : t("overview.outlet.none");
  }

  let campaignsBody: string | undefined;
  if (campaigns) {
    if (campaigns.running) campaignsBody = t("overview.campaigns.running", { name: campaigns.running.name, end: campaigns.running.endText });
    else if (free) campaignsBody = t("overview.campaigns.locked");
    else campaignsBody = campaigns.next ? t("overview.campaigns.next", { name: campaigns.next.name, start: campaigns.next.startText }) : t("overview.campaigns.none");
  }

  let marginBody: string | undefined;
  if (margin) {
    const settings = describeMarginSettings(
      { enabled: margin.enabled, global: { maxDiscountPercent: margin.maxDiscountPercent, ...(margin.minMarginPercent !== null ? { minMarginPercent: margin.minMarginPercent } : {}) }, perCollection: [] },
      tr.locale,
    );
    // §12: until the costs are read once, unread products have only the ceiling.
    marginBody = margin.enabled && margin.productsWithoutCost === null ? `${settings} · ${t("tile.margin.costsUnknown")}` : settings;
  }

  const analyticsBody =
    analytics && analytics.available && !analytics.empty
      ? analytics.tiles.map((tile) => `${t(`analytics.tile.${tile.id}` as "analytics.tile.cost")}: ${tile.value}`).join(" · ")
      : undefined;

  return { codes: opts.codes, tiers: tiersBody, rewards: rewardsBody, outlet: outletBody, campaigns: campaignsBody, margin: marginBody, analytics: analyticsBody };
}

export function OverviewScreen({
  ruleCount,
  readOnly,
  rules,
  currencies = [],
  onboardingStep,
  today,
  timezone = null,
  signals,
  ruleSync,
  nativeResult,
  gate = [],
  gateOff,
  gatePending = false,
  enabledMarkets,
  plan,
}: OverviewScreenProps) {
  const tr = useT();
  const { t } = tr;
  const codes = currencyCodes(currencies);
  const status = signals ?? NOT_WIRED_SIGNALS;
  const warnings = rules ? collectWarnings(rules, codes, { enabledMarkets }) : [];
  const statusCtx = { today: today ?? null, timezone, sync: status.sync, ruleSync, gateOff, currencies: codes, enabledMarkets };
  const targeting = status.targeting;
  const syncAttention = status.sync.state === "ok" ? (status.sync.attention ?? []) : [];
  const statuses = (rules ?? []).map((rule) => ruleStatus(rule, statusCtx));
  // B16: the same step and the same number of steps as the guide itself shows.
  const progress = onboardingProgress(onboardingStep ?? 1, { embedOn: status.embed.state === "on", rules: ruleCount, hasNative: onboardingHasNative(status.native) });
  const showOnboarding = onboardingStep !== undefined && ruleCount === 0;
  // The embed row's action: switch it on in the theme editor; where the state cannot be read (no permission,
  // or no link to the editor), read it again.
  const embedAction =
    status.embed.state === "on" ? undefined : status.embed.state !== "no_scope" && status.embed.activateUrl ? (
      <s-button href={status.embed.activateUrl} target="_blank" variant="secondary">
        {t("overview.embed.activate")}
      </s-button>
    ) : (
      <s-button variant="secondary" onClick={reload}>
        {t("overview.embed.recheck")}
      </s-button>
    );
  const showNative = nativeNeedsSection(status.native);
  const summary =
    ruleCount === 0 ? t("overview.running.none") : rules ? ruleStatusSummary(statuses, tr) : tr.tp("count.discount", ruleCount);
  const allGood = statusAllGood(status);
  // The same function the module pages call (model/module-status.ts): a tile and its page cannot disagree.
  const states: Partial<Record<string, ModuleStatus>> = moduleStatuses(status, { plan: plan ?? "pro", rules: statuses });
  const bodies = tileBodies(status, { codes: summary, plan }, tr);
  const free = plan === "free";
  const lockedTile = (key: "outlet" | "campaigns") => states[key]?.state === "locked";

  return (
    <s-page heading="Won Discounts">
      {readOnly ? (
        <s-banner tone="warning" heading={t("common.readOnly.heading")}>
          {t("common.readOnly.body")}
        </s-banner>
      ) : null}

      <s-stack direction="block" gap="base">
        {showOnboarding ? (
          <WonSection
            title={t("overview.onboarding.title")}
            glyph="spark"
            summary={t("overview.onboarding.summary", { step: progress.position, total: progress.total })}
            action={
              <s-button variant="primary" href="/app/onboarding">
                {t("overview.onboarding.cta")}
              </s-button>
            }
          />
        ) : null}

        {gate.length > 0 ? <GateNotes notes={gate} pending={gatePending} /> : null}

        {warnings.length > 0 ? (
          <WonSection title={t("overview.warnings.title")} glyph="alert" summary={tr.tp("count.warning", warnings.length)}>
            <div>
              {warnings.map((w) => (
                <WonRow
                  key={`${w.kind}-${w.ruleId}`}
                  tone="attention"
                  action={
                    // §13a: the diagnosis ships its own fix link, to the exact field (§13c).
                    <s-button href={`/app/discounts/${encodeURIComponent(w.ruleId)}#${w.field}`} variant="secondary">
                      {warningFix(w, tr)}
                    </s-button>
                  }
                >
                  <span style={{ color: WON_ATTENTION, fontWeight: 600, fontSize: 12.5 }}>{t("common.attention")} · </span>
                  <s-text>{warningText(w, tr)}</s-text>
                </WonRow>
              ))}
            </div>
          </WonSection>
        ) : null}

        {/* One line while everything is fine (the green label says it); open with its fixes when something is not. */}
        <WonSection
          key={allGood ? "status-ok" : "status-open"}
          title={t("overview.status.title")}
          glyph="store"
          summary={statusSummary(status, tr)}
          {...(allGood ? { on: true } : {})}
          collapsible
          defaultOpen={!allGood}
          anchor="status"
        >
          <div>
            <WonRow action={embedAction}>
              <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <s-text type="strong">{t("overview.embed.label")}</s-text>
                <PlacementPill placement={embedPlacement(status.embed.state)} />
              </span>
              <RowNote>{embedText(status.embed.state, tr)}</RowNote>
            </WonRow>
            <WonRow
              tone={status.sync.state === "error" || status.sync.state === "blocked" || syncAttention.length > 0 ? "attention" : undefined}
              action={
                syncNeedsRetry(status.sync) ? (
                  <ResyncButton />
                ) : status.sync.state === "blocked" ? (
                  // Blocked is fixed elsewhere: saving a discount replaces an unreadable config; a newer version needs the page reloaded.
                  status.sync.reason === "unreadable_config" ? (
                    <s-button href="/app/discounts" variant="secondary">
                      {t("result.action.showDiscounts")}
                    </s-button>
                  ) : (
                    <s-button variant="secondary" onClick={reload}>
                      {t("result.action.reload")}
                    </s-button>
                  )
                ) : undefined
              }
            >
              <s-text type="strong">{t("overview.sync.label")}</s-text>
              <RowNote tone={status.sync.state === "error" ? "attention" : undefined}>{syncText(status.sync, tr)}</RowNote>
              {status.sync.state === "error"
                ? (status.sync.problems ?? []).map((problem, i) => <RowNote key={i}>{uiText(problem, tr)}</RowNote>)
                : null}
              {syncAttention.map((problem, i) => (
                <RowNote key={`a${i}`} tone="attention">
                  {uiText(problem, tr)}
                </RowNote>
              ))}
              {status.sync.state === "ok"
                ? (status.sync.warnings ?? []).map((warning, i) => <RowNote key={i}>{uiText(warning, tr)}</RowNote>)
                : null}
            </WonRow>
            {targeting && targeting.state !== "none" ? (
              <WonRow action={<RefreshTargetingButton />}>
                <s-text type="strong">{t("overview.targeting.label")}</s-text>
                <RowNote>{targetingText(targeting, tr)}</RowNote>
              </WonRow>
            ) : null}
          </div>
        </WonSection>

        {showNative ? (
          <WonSection title={t("overview.native.title")} glyph="move" summary={nativeSummary(status.native, tr)} anchor="native">
            <NativeDiscountsPanel native={status.native} mode="each" result={nativeResult} readOnly={readOnly} />
          </WonSection>
        ) : null}

        <ModuleTiles label={t("overview.tiles.label")}>
          <ModuleTile id="codes" href="/app/discounts" title={t("nav.discounts")} glyph="tag" about={t("tile.about.codes")} active={bodies.codes} status={states.codes} />
          <ModuleTile id="tiers" href="/app/tiers" title={t("module.tiers")} glyph="layers" about={t("tile.about.tiers")} active={bodies.tiers} status={states.tiers} />
          <ModuleTile id="rewards" href="/app/rewards" title={t("nav.rewards")} glyph="spark" about={t("tile.about.rewards")} active={bodies.rewards} status={states.rewards} />
          <ModuleTile id="outlet" href="/app/outlet" title={t("module.outlet")} glyph="receipt" about={t("tile.about.outlet")} active={bodies.outlet} status={states.outlet} pro locked={lockedTile("outlet") || (free && !states.outlet)} />
          <ModuleTile id="campaigns" href="/app/campaigns" title={t("module.campaigns")} glyph="calendar" about={t("tile.about.campaigns")} active={bodies.campaigns} status={states.campaigns} pro locked={lockedTile("campaigns") || (free && !states.campaigns)} />
          <ModuleTile id="margin" href="/app/margin" title={t("module.margin")} glyph="shield" about={t("tile.about.margin")} active={bodies.margin} status={states.margin} />
          <ModuleTile id="analytics" href="/app/analytics" title={t("nav.analytics")} glyph="check" about={t("tile.about.analytics")} active={bodies.analytics} />
          <ModuleTile id="appearance" href="/app/appearance" title={t("nav.appearance")} glyph="store" about={t("tile.about.appearance")} />
          <ModuleTile id="tryCart" href="/app/try-cart" title={t("nav.tryCart")} glyph="cart" about={t("tile.about.tryCart")} active={free ? t("tile.tryCart.locked") : undefined} pro locked={free} />
          <ModuleTile id="settings" href="/app/settings" title={t("nav.settings")} glyph="sliders" about={t("tile.about.settings")} active={plan ? t(plan === "pro" ? "tile.settings.pro" : "tile.settings.free") : undefined} />
        </ModuleTiles>
      </s-stack>
    </s-page>
  );
}
