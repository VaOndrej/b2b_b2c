// Kampaně, the parts of the screen (campaigns/CampaignsScreen.tsx): a campaign's card, the banner of an action's
// result, the fields of a tier set and the draft a campaign keeps while its discount is created.

import { amountKeyCurrency } from "@won/core/discounts/money";
import { useT } from "../../../i18n/context";
import { CAMPAIGN_FIELD as F } from "../../model/campaigns";
import { type Seed } from "../../model/submitted";
import type { AmountSuggestView } from "../../model/markets";
import type { CampaignsActionResult, CampaignsScreenData, CampaignTierChoice, CampaignView, CurrencyView, SubmittedValues, UiResult } from "../../model/types";
import { FieldMessage } from "../../rule-editor/parts";
import { AmountSuggestions } from "../../shell/AmountSuggestions";
import { boolAttr } from "../../shell/attrs";
import { ResyncButton } from "../../shell/Notice";
import { SubCard } from "../../shell/SubCard";
import { RowNote } from "../../shell/WonSection";
import { StatusBadge } from "../../shell/StatusBadge";

export interface CampaignsScreenProps extends CampaignsScreenData {
  result?: CampaignsActionResult | UiResult | null;
}

export const DRAFT_KEY = "won-discounts.campaign-draft";

/** Keeps the typed campaign form in the browser while the merchant creates a discount for it (never sent anywhere). */
export function keepCampaignDraft(campaignId: string | null, values: SubmittedValues): void {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ campaignId, values }));
  } catch {
    // No storage (blocked by the browser): the form comes back with the new discount ticked, the rest is typed again.
  }
}

/** The kept form of this campaign, once (it is removed when read); null = none, or another campaign's. */
export function takeCampaignDraft(campaignId: string | null): SubmittedValues | null {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    window.sessionStorage.removeItem(DRAFT_KEY);
    const draft = JSON.parse(raw) as { campaignId?: unknown; values?: unknown };
    if (draft.campaignId !== campaignId || !draft.values || typeof draft.values !== "object") return null;
    const out: SubmittedValues = {};
    for (const [name, list] of Object.entries(draft.values as Record<string, unknown>)) {
      if (Array.isArray(list)) out[name] = list.filter((v): v is string => typeof v === "string");
    }
    return out;
  } catch {
    return null;
  }
}

/** Where a campaign's banner can stand in the theme (the tile "Kampaň na webu" counts them). */
export const PLACE_KEYS = ["campaignHome", "campaignProduct", "topBarCampaign"] as const;

export const isCampaignResult = (r: CampaignsActionResult | UiResult | null | undefined): r is CampaignsActionResult =>
  !!r && ((r.ok && "kind" in r) || (!r.ok && r.reason === "invalid" && !("message" in r) && Array.isArray((r as { errors?: unknown }).errors)));

export const dialogId = (kind: "kill" | "delete", id: string) => `won-campaign-${kind}-${id.replace(/[^A-Za-z0-9_-]/g, "")}`;
export const editHref = (id: string) => `/app/campaigns?edit=${encodeURIComponent(id)}#form`;

export function CampaignBanner({ result }: { result: CampaignsActionResult }) {
  const { t } = useT();
  if (!result.ok) {
    // A refusal that is not about a field of the form (deleting a running campaign) is said here.
    const loose = result.errors.find((e) => e.key === "campaign.error.deleteRunning");
    return <s-banner tone="critical" heading={loose ? t(loose.key, loose.params) : t("campaign.result.invalid")} />;
  }
  const problems = result.sync && !result.sync.ok;
  return (
    <s-banner tone={problems ? "warning" : "success"} heading={t(`campaign.result.${result.kind}` as "campaign.result.saved")}>
      {problems ? <s-paragraph>{t("campaign.result.syncPending")}</s-paragraph> : null}
      {problems ? <ResyncButton slot="secondary-actions" /> : null}
    </s-banner>
  );
}

export function CampaignCard({ c, pro }: { c: CampaignView; pro: boolean }) {
  const { t } = useT();
  const live = c.status === "running" || c.status === "scheduled";
  const editable = live && pro;
  // One card per campaign, like a running sale: the name and its state in the header strip with the card's
  // buttons, what it changes in the body (pravidla vzhledu P4; before the first review, nález 11).
  return (
    <SubCard
      marker={{ "data-won-campaign": c.status }}
      title={<span style={{ fontSize: 15 }}>{c.name}</span>}
      label={<StatusBadge plain badge={{ tone: c.status === "running" ? "live" : "neutral", label: t(`campaign.status.${c.status}` as "campaign.status.running") }} />}
      tone={c.unusedNames.length > 0 ? "attention" : undefined}
      action={
        <>
          {live ? (
            <s-button href={c.tryCartUrl} variant="secondary">
              {t("campaign.action.tryCart")}
            </s-button>
          ) : null}
          {editable ? (
            <s-button href={editHref(c.id)} variant="secondary">
              {t("campaign.action.edit")}
            </s-button>
          ) : null}
          {live ? (
            <s-button variant="secondary" tone="critical" commandFor={dialogId("kill", c.id)} command="--show">
              {t(c.status === "running" ? "campaign.action.killNow" : "campaign.action.cancel")}
            </s-button>
          ) : null}
          {c.status !== "running" ? (
            <s-button variant="tertiary" commandFor={dialogId("delete", c.id)} command="--show">
              {t("campaign.action.delete")}
            </s-button>
          ) : null}
        </>
      }
    >
      <s-stack direction="block" gap="small-300">
        <s-text>{t("campaign.card.window", { start: c.startText, end: c.endText })}</s-text>
        {c.overrides.length === 0 && c.tiers.length === 0 ? (
          <RowNote>
            {t("campaign.card.noOverrides")} {editable ? <s-link href={editHref(c.id)}>{t("campaign.action.edit")}</s-link> : null}
          </RowNote>
        ) : null}
        {c.overrides.map((o) => (
          <RowNote key={o.ruleId}>
            {o.enabled === false
              ? t("campaign.card.off", { rule: o.ruleName })
              : o.valueText
                ? t(o.enabled ? "campaign.card.onValue" : "campaign.card.value", { rule: o.ruleName, value: o.valueText })
                : t("campaign.card.on", { rule: o.ruleName })}
          </RowNote>
        ))}
        {c.tiers.map((x) => (
          <RowNote key={x.setId}>{t("campaign.card.tier", { set: x.label, breaks: x.text })}</RowNote>
        ))}
        {c.unusedNames.length > 0 ? (
          <RowNote tone="attention">
            {t("campaign.card.unused", { names: c.unusedNames.map((name) => name || t("campaign.card.unusedGone")).join(", ") })}{" "}
            {editable ? <s-link href={editHref(c.id)}>{t("campaign.action.edit")}</s-link> : null}
          </RowNote>
        ) : null}
        {c.finishing ? <RowNote>{t("campaign.card.finishing")}</RowNote> : null}
      </s-stack>
    </SubCard>
  );
}

/** The markets of the currencies a discount asks for, in the form's order; a currency without a known market is still offered, by its code. */
export function suggestFor(currencies: readonly CurrencyView[], codes: readonly string[]): CurrencyView[] {
  return codes.map((code) => currencies.find((c) => c.code === code) ?? { code, markets: [] });
}

/** One quantity tier set in the form (MVP 6.1): tick it, then its breaks during the campaign. */
export function TierSetFields({
  set,
  rowCount,
  ownRows,
  init,
  ticked,
  disabled,
  error,
  currencies,
  suggest,
}: {
  set: CampaignTierChoice;
  rowCount: number;
  /** Rows that are the set's (or the campaign's) own breaks; the rest are the empty extra ones. */
  ownRows: number;
  init: Seed;
  ticked: boolean;
  disabled: boolean;
  error?: string;
  /** The enabled markets by currency: a field is named by its market, and the other markets get a suggested amount. */
  currencies: readonly CurrencyView[];
  suggest?: AmountSuggestView;
}) {
  const { t } = useT();
  const marketsOf = (code: string) => currencies.find((c) => c.code === code)?.markets.map((m) => m.name).join(", ") ?? "";
  return (
    <s-box padding="small-300" border="base" borderRadius="base">
      <s-stack direction="block" gap="small-300">
        <s-checkbox name={F.tierUse} value={set.id} label={set.label} checked={boolAttr(init.all(F.tierUse, []).includes(set.id))} disabled={boolAttr(disabled)} />
        <RowNote>{t("campaign.tiers.base", { breaks: set.baseText })}</RowNote>
        {/* B7: the rows exist only while the set is ticked. */}
        {ticked
          ? Array.from({ length: rowCount }, (_, i) => (
              <s-grid key={i} gridTemplateColumns="minmax(0, 1fr) minmax(0, 2fr)" gap="base" alignItems="start">
                <s-number-field
                  name={`${F.tierQty}${set.id}.${i}`}
                  label={t(i < ownRows ? "campaign.tiers.qty" : "campaign.tiers.qtyExtra")}
                  value={init.one(`${F.tierQty}${set.id}.${i}`, "")}
                  min={1}
                  step={1}
                  inputMode="numeric"
                />
                {set.kind === "percent" ? (
                  <s-number-field
                    name={`${F.tierPercent}${set.id}.${i}`}
                    label={t("campaign.tiers.percent")}
                    value={init.one(`${F.tierPercent}${set.id}.${i}`, "")}
                    min={0}
                    max={100}
                    step={0.01}
                    suffix="%"
                    inputMode="decimal"
                  />
                ) : (
                  <s-stack direction="block" gap="small-300">
                    {set.currencies.map((cur) => (
                      <s-number-field
                        key={cur}
                        name={`${F.tierAmount}${set.id}.${i}.${cur}`}
                        label={marketsOf(cur) ? t("campaign.tiers.amountMarket", { currency: cur, markets: marketsOf(cur) }) : t("campaign.tiers.amount", { currency: cur })}
                        value={init.one(`${F.tierAmount}${set.id}.${i}.${cur}`, "")}
                        min={0}
                        step={0.01}
                        suffix={amountKeyCurrency(cur)}
                        inputMode="decimal"
                      />
                    ))}
                    {/* Úkol 3 (7 Oct 2026): the other markets' amounts, suggested from the rate set by hand in Shopify. */}
                    <AmountSuggestions
                      suggest={suggest}
                      currencies={suggestFor(currencies, set.currencies)}
                      field={(code) => `${F.tierAmount}${set.id}.${i}.${code}`}
                      initial={Object.fromEntries(set.currencies.map((cur) => [cur, init.one(`${F.tierAmount}${set.id}.${i}.${cur}`, "")]))}
                    />
                  </s-stack>
                )}
              </s-grid>
            ))
          : null}
        <FieldMessage text={error} />
      </s-stack>
    </s-box>
  );
}
