// Kampaně (MVP 6, Pro) — the module screen (contract K7). "Black Friday: od pátku do pondělí jinak":
//   1. Nová / upravit kampaň — a name, the window in the shop's time (a date and HH:MM each end), and per discount
//      rule what changes during the campaign (D2: switched on / off, another value). The function starts and ends it
//      on its own (C4); two campaigns never overlap (A8). Free (amber, §16): the form is shown locked (BILL-1);
//   2. Kampaně — running, scheduled, ended, ended by hand: the window, what changes, "Vyzkoušet košík v době kampaně",
//      "Upravit", "Ukončit hned" (the kill switch, any plan), "Smazat" (not while running).
// Množstevní slevy and dárky run unchanged during a campaign (D1) — the screen says so.
// Each action is its own small form; the server parses it (campaigns-admin.server.ts).

import { Form } from "react-router";

import { useT } from "../../i18n/context";
import { CAMPAIGN_FIELD as F, CAMPAIGN_INTENT } from "../model/campaigns";
import type { CampaignsActionResult, CampaignsScreenData, CampaignView, UiResult } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { Notice } from "../shell/Notice";
import { ProFrame } from "../shell/ProFrame";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export interface CampaignsScreenProps extends CampaignsScreenData {
  result?: CampaignsActionResult | UiResult | null;
}

const isCampaignResult = (r: CampaignsActionResult | UiResult | null | undefined): r is CampaignsActionResult =>
  !!r && ((r.ok && "kind" in r) || (!r.ok && r.reason === "invalid" && !("message" in r) && Array.isArray((r as { errors?: unknown }).errors)));

function CampaignBanner({ result }: { result: CampaignsActionResult }) {
  const { t } = useT();
  if (!result.ok) return <s-banner tone="critical" heading={t("campaign.result.invalid")} />;
  const problems = result.sync && !result.sync.ok;
  return (
    <s-banner tone={problems ? "warning" : "success"} heading={t(`campaign.result.${result.kind}` as "campaign.result.saved")}>
      {problems ? <s-paragraph>{t("campaign.result.syncPending")}</s-paragraph> : null}
    </s-banner>
  );
}

function CampaignCard({ c, pro }: { c: CampaignView; pro: boolean }) {
  const { t } = useT();
  const live = c.status === "running" || c.status === "scheduled";
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small-300">
        <s-heading>{c.name}</s-heading>
        <s-text>
          {t(`campaign.status.${c.status}` as "campaign.status.running")} · {t("campaign.card.window", { start: c.startText, end: c.endText })}
        </s-text>
        {c.overrides.length === 0 ? <RowNote>{t("campaign.card.noOverrides")}</RowNote> : null}
        {c.overrides.map((o) => (
          <RowNote key={o.ruleId}>
            {o.enabled === false
              ? t("campaign.card.off", { rule: o.ruleName })
              : o.valueText
                ? t(o.enabled ? "campaign.card.onValue" : "campaign.card.value", { rule: o.ruleName, value: o.valueText })
                : t("campaign.card.on", { rule: o.ruleName })}
          </RowNote>
        ))}
        {c.unused > 0 ? <RowNote tone="attention">{t("campaign.card.unused", { n: c.unused })}</RowNote> : null}
        {c.finishing ? <RowNote>{t("campaign.card.finishing")}</RowNote> : null}
        <s-stack direction="inline" gap="small-300">
          {live ? (
            <s-button href={c.tryCartUrl} variant="secondary">
              {t("campaign.action.tryCart")}
            </s-button>
          ) : null}
          {live && pro ? (
            <s-button href={`/app/campaigns?edit=${encodeURIComponent(c.id)}#form`} variant="secondary">
              {t("campaign.action.edit")}
            </s-button>
          ) : null}
          {live ? (
            <Form method="post">
              <input type="hidden" name={F.intent} value={CAMPAIGN_INTENT.kill} />
              <input type="hidden" name={F.id} value={c.id} />
              <s-button type="submit" variant="secondary" tone="critical">
                {t(c.status === "running" ? "campaign.action.killNow" : "campaign.action.cancel")}
              </s-button>
            </Form>
          ) : null}
          {c.status !== "running" ? (
            <Form method="post">
              <input type="hidden" name={F.intent} value={CAMPAIGN_INTENT.delete} />
              <input type="hidden" name={F.id} value={c.id} />
              <s-button type="submit" variant="tertiary">
                {t("campaign.action.delete")}
              </s-button>
            </Form>
          ) : null}
        </s-stack>
      </s-stack>
    </s-box>
  );
}

export function CampaignsScreen(props: CampaignsScreenProps) {
  const tr = useT();
  const { t } = tr;
  const { plan, result, campaigns, rules, editing, today, nowTime, timezone, configVersion, limits } = props;
  const pro = plan === "pro";
  const err = (field: string) => {
    if (!result || result.ok || result.reason !== "invalid" || !("errors" in result)) return undefined;
    const e = result.errors?.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };
  const ov = new Map((editing?.overrides ?? []).map((o) => [o.ruleId, o]));

  const form = (
    <Form method="post" data-won-campaign-form>
      <input type="hidden" name={F.intent} value={CAMPAIGN_INTENT.save} />
      {editing ? <input type="hidden" name={F.id} value={editing.id} /> : null}
      {configVersion ? <input type="hidden" name="configVersion" value={configVersion} /> : null}
      <s-stack direction="block" gap="base">
        <s-text-field name={F.name} label={t("campaign.field.name")} value={editing?.name ?? ""} error={err(F.name)} disabled={boolAttr(!pro)} />
        <s-grid gridTemplateColumns="minmax(0, 2fr) minmax(0, 1fr)" gap="base" alignItems="start">
          <s-date-field
            name={F.startDate}
            label={t("campaign.field.start")}
            value={editing?.start.date ?? ""}
            // Audit C2: a running campaign keeps its past start; a new or scheduled one starts today at the earliest.
            allow={editing?.status === "running" ? undefined : `${today}--`}
            error={err(F.startDate)}
            disabled={boolAttr(!pro)}
          />
          <s-text-field name={F.startTime} label={t("campaign.field.time")} value={editing?.start.time ?? "00:00"} placeholder="HH:MM" disabled={boolAttr(!pro)} />
          <s-date-field name={F.endDate} label={t("campaign.field.end")} value={editing?.end.date ?? ""} allow={`${today}--`} error={err(F.endDate)} disabled={boolAttr(!pro)} />
          <s-text-field name={F.endTime} label={t("campaign.field.time")} value={editing?.end.time ?? "23:59"} placeholder="HH:MM" disabled={boolAttr(!pro)} />
        </s-grid>
        <RowNote>{t(timezone ? "campaign.field.zone" : "campaign.field.zoneUnknown", { zone: timezone ?? "", now: `${today} ${nowTime}`, n: limits.maxDays })}</RowNote>
        {editing?.status === "running" ? <RowNote tone="attention">{t("campaign.edit.running")}</RowNote> : null}
        <s-stack direction="block" gap="small-300">
          <s-text>{t("campaign.rules.title")}</s-text>
          <RowNote>{t("campaign.rules.hint")}</RowNote>
          {rules.length === 0 ? <RowNote>{t("campaign.rules.none")}</RowNote> : null}
          {rules.map((r) => {
            const o = ov.get(r.id);
            return (
              <s-box key={r.id} padding="small-300" border="base" borderRadius="base">
                <s-stack direction="block" gap="small-300">
                  <s-checkbox
                    name={F.use}
                    value={r.id}
                    label={`${r.name} · ${r.valueText}${r.enabled ? "" : ` · ${t("campaign.rule.isOff")}`}`}
                    checked={boolAttr(!!o)}
                    disabled={boolAttr(!pro)}
                  />
                  <s-grid gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)" gap="base">
                    <s-select name={`${F.enabled}${r.id}`} label={t("campaign.rule.enabled")} disabled={boolAttr(!pro)}>
                      <s-option value="" selected={boolAttr(o?.enabled === undefined)}>
                        {t("campaign.rule.keep")}
                      </s-option>
                      <s-option value="on" selected={boolAttr(o?.enabled === true)}>
                        {t("campaign.rule.on")}
                      </s-option>
                      <s-option value="off" selected={boolAttr(o?.enabled === false)}>
                        {t("campaign.rule.off")}
                      </s-option>
                    </s-select>
                    {r.kind === "percentage" ? (
                      <s-number-field
                        name={`${F.percent}${r.id}`}
                        label={t("campaign.rule.percent")}
                        value={o?.percent !== undefined ? String(o.percent) : ""}
                        min={1}
                        max={100}
                        step={1}
                        suffix="%"
                        inputMode="numeric"
                        disabled={boolAttr(!pro)}
                      />
                    ) : r.kind === "fixed" ? (
                      <s-stack direction="block" gap="small-300">
                        {r.currencies.map((cur) => (
                          <s-text-field
                            key={cur}
                            name={`${F.amount}${r.id}.${cur}`}
                            label={t("campaign.rule.amount", { currency: cur })}
                            value={o?.amount?.[cur] ?? ""}
                            disabled={boolAttr(!pro)}
                          />
                        ))}
                      </s-stack>
                    ) : (
                      <RowNote>{t("campaign.rule.noValue")}</RowNote>
                    )}
                  </s-grid>
                </s-stack>
              </s-box>
            );
          })}
          {err(F.use) ? <RowNote tone="attention">{err(F.use)}</RowNote> : null}
        </s-stack>
        <RowNote>{t("campaign.scope")}</RowNote>
        <s-stack direction="inline" gap="small-300">
          <s-button type="submit" variant="primary" disabled={boolAttr(!pro)}>
            {t(editing ? "campaign.save.edit" : "campaign.save.new")}
          </s-button>
          {editing ? (
            <s-button href="/app/campaigns" variant="tertiary">
              {t("campaign.edit.cancel")}
            </s-button>
          ) : null}
        </s-stack>
      </s-stack>
    </Form>
  );

  const groups = (["running", "scheduled", "ended", "killed"] as const).map((status) => ({ status, items: campaigns.filter((c) => c.status === status) }));
  const live = campaigns.filter((c) => c.status === "running" || c.status === "scheduled").length;

  return (
    <s-page heading={t("module.campaigns")}>
      <s-stack direction="block" gap="base">
        {isCampaignResult(result) ? <CampaignBanner result={result} /> : <Notice result={result as UiResult | null | undefined} />}
        <RowNote>{t("campaign.hint")}</RowNote>

        <WonSection
          title={t(editing ? "campaign.edit.title" : "campaign.new.title")}
          glyph="calendar"
          pro={!pro}
          locked={!pro}
          summary={editing ? editing.name : t("campaign.new.summary")}
          anchor="form"
        >
          {pro ? (
            form
          ) : (
            <ProFrame locked>
              <s-stack direction="block" gap="small-300">
                <RowNote>{t("campaign.pro.locked")}</RowNote>
                {form}
              </s-stack>
            </ProFrame>
          )}
        </WonSection>

        <WonSection
          title={t("campaign.list.title")}
          glyph="tag"
          on={campaigns.some((c) => c.status === "running")}
          summary={live === 0 ? t("campaign.list.none") : tr.tp("campaign.list.live", live)}
          anchor="list"
        >
          <s-stack direction="block" gap="base">
            {campaigns.length === 0 ? <RowNote>{t("campaign.list.empty")}</RowNote> : null}
            {groups
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <WonRow key={g.status}>
                  <s-stack direction="block" gap="small-300">
                    <s-text>{t(`campaign.group.${g.status}` as "campaign.group.running")}</s-text>
                    {g.items.map((c) => (
                      <CampaignCard key={c.id} c={c} pro={pro} />
                    ))}
                  </s-stack>
                </WonRow>
              ))}
          </s-stack>
        </WonSection>
      </s-stack>
    </s-page>
  );
}
