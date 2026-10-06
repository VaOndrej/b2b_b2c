// Kampaně (MVP 6, Pro) — the module screen (contract K7). "Black Friday: od pátku do pondělí jinak":
//   1. Nová / upravit kampaň — a name, the window in the shop's time (a date and a time picked from a list each
//      end), and per discount rule what changes during the campaign (D2: switched on / off, another value). A rule's
//      or a tier set's fields are shown only while it is ticked (B7: the server reads only ticked ids, so nothing
//      typed can be dropped silently). The summary of the form is computed from what is typed (P5). The function
//      starts and ends the campaign on its own (C4); two campaigns never overlap (A8). Free (amber, §16): the form
//      is shown locked under one sentence of what the feature does and the plan link (BILL-1);
//   2. Kampaně — running, scheduled, ended, ended by hand: the window, what changes, "Vyzkoušet košík v době kampaně",
//      "Upravit", "Ukončit hned" (the kill switch, any plan), "Smazat" (not while running). Each of the three asks
//      first. Not rendered while there is no campaign (P2).
// MVP 6.1: a campaign also changes the breaks of quantity tier sets — only to the same or more (the server refuses
// less); the table on the product page follows a minute after the start and goes back 7 minutes before the end.
// Dárky run unchanged during a campaign — the screen says so.
// B14: a refused save keeps what was typed: the action returns the posted values, the fields are seeded from them
// and errors are rendered beside the field, the discount or the set they are about (never through `error`).
// Each action is its own small form; the server parses it (campaigns-admin.server.ts).

import { StorefrontPlacements } from "../StorefrontPlacements";
import { useEffect, useMemo, useRef, useState } from "react";

import { ModuleTiles, ViewTile } from "../shell/ModuleTile";
import { useView, ViewPanel } from "../shell/views";
import { Form, useSubmit } from "react-router";

import { formatMoney, formatPercent } from "@won/core/discounts/describe";
import { currencyExponent } from "@won/core/discounts/money";

import { useT } from "../../i18n/context";
import {
  CAMPAIGN_FIELD as F,
  CAMPAIGN_INTENT,
  campaignFieldNames,
  campaignFormValues,
  campaignTierFormRows,
  campaignTimeOptions,
  minorFromInput,
} from "../model/campaigns";
import { formatDateTime } from "../model/signals";
import { seedOf, submittedOf, useRefusedSeed, type Seed } from "../model/submitted";
import type { CampaignsActionResult, CampaignsScreenData, CampaignTierChoice, CampaignView, SubmittedValues, UiResult } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { boolAttr } from "../shell/attrs";
import { Notice, ResyncButton } from "../shell/Notice";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { DiscountsSubNav } from "../shell/SubNav";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

export interface CampaignsScreenProps extends CampaignsScreenData {
  result?: CampaignsActionResult | UiResult | null;
}

const isCampaignResult = (r: CampaignsActionResult | UiResult | null | undefined): r is CampaignsActionResult =>
  !!r && ((r.ok && "kind" in r) || (!r.ok && r.reason === "invalid" && !("message" in r) && Array.isArray((r as { errors?: unknown }).errors)));

const dialogId = (kind: "kill" | "delete", id: string) => `won-campaign-${kind}-${id.replace(/[^A-Za-z0-9_-]/g, "")}`;
const editHref = (id: string) => `/app/campaigns?edit=${encodeURIComponent(id)}#form`;

function CampaignBanner({ result }: { result: CampaignsActionResult }) {
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

function CampaignCard({ c, pro }: { c: CampaignView; pro: boolean }) {
  const { t } = useT();
  const live = c.status === "running" || c.status === "scheduled";
  const editable = live && pro;
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small-300">
        <s-heading>{c.name}</s-heading>
        <s-text>
          {t(`campaign.status.${c.status}` as "campaign.status.running")} · {t("campaign.card.window", { start: c.startText, end: c.endText })}
        </s-text>
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
        <s-stack direction="inline" gap="small-300">
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
        </s-stack>
      </s-stack>
    </s-box>
  );
}

/** One quantity tier set in the form (MVP 6.1): tick it, then its breaks during the campaign. */
function TierSetFields({
  set,
  rowCount,
  ownRows,
  init,
  ticked,
  disabled,
  error,
}: {
  set: CampaignTierChoice;
  rowCount: number;
  /** Rows that are the set's (or the campaign's) own breaks; the rest are the empty extra ones. */
  ownRows: number;
  init: Seed;
  ticked: boolean;
  disabled: boolean;
  error?: string;
}) {
  const { t } = useT();
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
                        label={t("campaign.tiers.amount", { currency: cur })}
                        value={init.one(`${F.tierAmount}${set.id}.${i}.${cur}`, "")}
                        min={0}
                        step={0.01}
                        suffix={cur}
                        inputMode="decimal"
                      />
                    ))}
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

export function CampaignsScreen(props: CampaignsScreenProps) {
  const tr = useT();
  const { t } = tr;
  const { plan, result, campaigns, rules, tierSets, editing, today, nowTime, timezone, configVersion, limits } = props;
  const pro = plan === "pro";
  const submit = useSubmit();
  const errors = result && !result.ok && result.reason === "invalid" && "errors" in result ? (result.errors ?? []) : [];
  /** An error of the field itself (not about one discount or set). */
  const err = (field: string) => {
    const e = errors.find((x) => x.field === field && !x.at && x.key !== "campaign.error.deleteRunning");
    return e ? t(e.key, e.params) : undefined;
  };
  /** An error about one discount or one tier set, shown at its row. */
  const errAt = (field: string, id: string) => {
    const e = errors.find((x) => x.field === field && x.at === id);
    return e ? t(e.key, e.params) : undefined;
  };

  // B14: what a refused save posted comes back with the result; else the edited campaign or a new one's defaults.
  const { values: refused, key: seedKey } = useRefusedSeed(result);
  const initial: SubmittedValues = useMemo(() => refused ?? campaignFormValues(editing, rules, tierSets), [refused, editing, rules, tierSets]);
  const init = seedOf(initial);
  const names = useMemo(() => campaignFieldNames(rules, tierSets), [rules, tierSets]);

  // P5 / B7: the live form, re-read on native input / change (React 18 wires only onClick on `s-*`).
  const formRef = useRef<HTMLFormElement>(null);
  const [live, setLive] = useState<SubmittedValues>(initial);
  const latest = useRef({ initial, names });
  latest.current = { initial, names };
  const read = () => {
    const el = formRef.current;
    if (el) setLive(submittedOf(new FormData(el), latest.current.names));
  };
  useEffect(() => {
    setLive(latest.current.initial);
  }, [seedKey]);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    el.addEventListener("input", read);
    el.addEventListener("change", read);
    return () => {
      el.removeEventListener("input", read);
      el.removeEventListener("change", read);
    };
  }, []);
  const now = seedOf(live);
  const usedRules = now.all(F.use, []);
  const usedSets = now.all(F.tierUse, []);
  // A row ticked just now mounts its fields after the event that ticked it: read them once they exist.
  const tickedKey = `${usedRules.join("|")}#${usedSets.join("|")}`;
  useEffect(() => {
    if (pro) read();
  }, [tickedKey, pro]);

  // --- What the campaign does, from the live form ------------------------------------------------------------
  const typedValue = (rule: (typeof rules)[number]): string => {
    if (rule.kind === "percentage") {
      const p = Number(now.one(`${F.percent}${rule.id}`, "").replace(",", "."));
      return now.one(`${F.percent}${rule.id}`, "") !== "" && Number.isFinite(p) ? formatPercent(p, tr.locale) : "";
    }
    if (rule.kind !== "fixed") return "";
    return rule.currencies
      .map((cur) => {
        const minor = minorFromInput(now.one(`${F.amount}${rule.id}.${cur}`, ""), currencyExponent(cur));
        return minor === null ? null : formatMoney(minor, cur, tr.locale);
      })
      .filter((x): x is string => x !== null)
      .join(" / ");
  };
  const ruleLines = rules
    .filter((r) => usedRules.includes(r.id))
    .map((r) => {
      const enabled = now.one(`${F.enabled}${r.id}`, "");
      const value = typedValue(r);
      const changed = enabled !== "" || value !== "";
      const text =
        enabled === "off"
          ? t("campaign.card.off", { rule: r.name })
          : value
            ? t(enabled === "on" ? "campaign.card.onValue" : "campaign.card.value", { rule: r.name, value })
            : enabled === "on"
              ? t("campaign.card.on", { rule: r.name })
              : t("campaign.summary.ruleKeep", { rule: r.name });
      return { id: r.id, text, changed };
    });
  const tierForm = new Map(tierSets.map((set) => [set.id, campaignTierFormRows(set, editing)]));
  const setLines = tierSets
    .filter((set) => usedSets.includes(set.id))
    .map((set) => {
      const breaks: string[] = [];
      for (let i = 0; i < (tierForm.get(set.id)?.rows.length ?? 0); i += 1) {
        const qty = now.one(`${F.tierQty}${set.id}.${i}`, "");
        if (!/^\d{1,5}$/.test(qty)) continue;
        if (set.kind === "percent") {
          const raw = now.one(`${F.tierPercent}${set.id}.${i}`, "");
          const p = Number(raw.replace(",", "."));
          if (raw !== "" && Number.isFinite(p)) breaks.push(t("campaign.tiers.break", { qty: Number(qty), value: formatPercent(p, tr.locale) }));
        } else {
          const amounts = set.currencies
            .map((cur) => {
              const minor = minorFromInput(now.one(`${F.tierAmount}${set.id}.${i}.${cur}`, ""), currencyExponent(cur));
              return minor === null ? null : formatMoney(minor, cur, tr.locale);
            })
            .filter((x): x is string => x !== null);
          if (amounts.length > 0) breaks.push(t("campaign.tiers.breakAmount", { qty: Number(qty), value: amounts.join(" / ") }));
        }
      }
      return { id: set.id, text: breaks.length > 0 ? t("campaign.card.tier", { set: set.label, breaks: breaks.join(", ") }) : t("campaign.summary.ruleKeep", { rule: set.label }) };
    });
  const liveName = now.one(F.name, "").trim();
  const when = (date: string, time: string) => (/^\d{4}-\d{2}-\d{2}$/.test(date) ? formatDateTime(`${date}T${time || "00:00"}`, tr.locale) : null);
  const startText = when(now.one(F.startDate, ""), now.one(F.startTime, ""));
  const endText = when(now.one(F.endDate, ""), now.one(F.endTime, ""));
  const counts = [ruleLines.length > 0 ? tr.tp("campaign.summary.rules", ruleLines.length) : null, setLines.length > 0 ? tr.tp("campaign.summary.sets", setLines.length) : null].filter(
    (x): x is string => x !== null,
  );
  const summaryParts = [
    liveName || null,
    startText && endText ? t("campaign.card.window", { start: startText, end: endText }) : null,
    liveName || startText || endText || counts.length > 0 ? (counts.length > 0 ? t("campaign.summary.changes", { what: tr.list(counts) }) : t("campaign.summary.nothing")) : null,
  ].filter((x): x is string => x !== null);
  const summary = summaryParts.length > 0 ? summaryParts.join(" · ") : t("campaign.summary.empty");

  const timeSelect = (name: string) => {
    const current = init.one(name, "");
    return (
      <div>
        <s-select name={name} label={t("campaign.field.time")} value={current} disabled={boolAttr(!pro)}>
          {campaignTimeOptions(current).map((option) => (
            <s-option key={option} value={option} selected={boolAttr(option === current)}>
              {option}
            </s-option>
          ))}
        </s-select>
        <FieldMessage text={err(name)} />
      </div>
    );
  };

  const form = (
    <Form method="post" ref={formRef} data-won-campaign-form>
      <input type="hidden" name={F.intent} value={CAMPAIGN_INTENT.save} />
      {editing ? <input type="hidden" name={F.id} value={editing.id} /> : null}
      {configVersion ? <input type="hidden" name="configVersion" value={configVersion} /> : null}
      <s-stack key={seedKey} direction="block" gap="base">
        <div>
          <s-text-field name={F.name} label={t("campaign.field.name")} value={init.one(F.name, "")} disabled={boolAttr(!pro)} />
          <FieldMessage text={err(F.name)} />
        </div>
        <s-grid gridTemplateColumns="minmax(0, 2fr) minmax(0, 1fr)" gap="base" alignItems="start">
          <div>
            <s-date-field
              name={F.startDate}
              label={t("campaign.field.start")}
              value={init.one(F.startDate, "")}
              // Audit C2: a running campaign keeps its past start; a new or scheduled one starts today at the earliest.
              allow={editing?.status === "running" ? undefined : `${today}--`}
              disabled={boolAttr(!pro)}
            />
            <FieldMessage text={err(F.startDate)} />
          </div>
          {timeSelect(F.startTime)}
          <div>
            <s-date-field name={F.endDate} label={t("campaign.field.end")} value={init.one(F.endDate, "")} allow={`${today}--`} disabled={boolAttr(!pro)} />
            <FieldMessage text={err(F.endDate)} />
          </div>
          {timeSelect(F.endTime)}
        </s-grid>
        <RowNote>{t(timezone ? "campaign.field.zone" : "campaign.field.zoneUnknown", { zone: timezone ?? "", now: `${today} ${nowTime}`, n: limits.maxDays })}</RowNote>
        {editing?.status === "running" ? <RowNote tone="attention">{t("campaign.edit.running")}</RowNote> : null}
        <s-stack direction="block" gap="small-300">
          <s-text>{t("campaign.rules.title")}</s-text>
          {rules.length === 0 ? (
            <RowNote>
              {t("campaign.rules.none")} <s-link href="/app/discounts">{t("campaign.rules.create")}</s-link>
            </RowNote>
          ) : (
            <RowNote>{t("campaign.rules.hint")}</RowNote>
          )}
          {rules.map((r) => {
            const ticked = usedRules.includes(r.id);
            const line = ruleLines.find((x) => x.id === r.id);
            const rowError = errAt(F.use, r.id);
            return (
              <s-box key={r.id} padding="small-300" border="base" borderRadius="base">
                <s-stack direction="block" gap="small-300">
                  <s-checkbox
                    name={F.use}
                    value={r.id}
                    label={`${r.name} · ${r.valueText}${r.enabled ? "" : ` · ${t("campaign.rule.isOff")}`}`}
                    checked={boolAttr(init.all(F.use, []).includes(r.id))}
                    disabled={boolAttr(!pro)}
                  />
                  {/* B7: the fields exist only while the discount is ticked, so nothing typed is ever left unread. */}
                  {ticked ? (
                    <s-grid gridTemplateColumns="minmax(0, 1fr) minmax(0, 1fr)" gap="base" alignItems="start">
                      <s-select name={`${F.enabled}${r.id}`} label={t("campaign.rule.enabled")} value={init.one(`${F.enabled}${r.id}`, "")}>
                        {(["", "on", "off"] as const).map((option) => (
                          <s-option key={option} value={option} selected={boolAttr(init.one(`${F.enabled}${r.id}`, "") === option)}>
                            {t(option === "" ? "campaign.rule.keep" : option === "on" ? "campaign.rule.on" : "campaign.rule.off")}
                          </s-option>
                        ))}
                      </s-select>
                      {r.kind === "percentage" ? (
                        <s-number-field
                          name={`${F.percent}${r.id}`}
                          label={t("campaign.rule.percent")}
                          value={init.one(`${F.percent}${r.id}`, "")}
                          min={1}
                          max={100}
                          step={1}
                          suffix="%"
                          inputMode="numeric"
                        />
                      ) : r.kind === "fixed" ? (
                        <s-stack direction="block" gap="small-300">
                          {r.currencies.map((cur) => (
                            <s-number-field
                              key={cur}
                              name={`${F.amount}${r.id}.${cur}`}
                              label={t("campaign.rule.amount", { currency: cur })}
                              value={init.one(`${F.amount}${r.id}.${cur}`, "")}
                              min={0}
                              step={0.01}
                              suffix={cur}
                              inputMode="decimal"
                            />
                          ))}
                        </s-stack>
                      ) : (
                        <RowNote>{t("campaign.rule.noValue")}</RowNote>
                      )}
                    </s-grid>
                  ) : null}
                  {rowError ? <FieldMessage text={rowError} /> : ticked && line && !line.changed ? <RowNote tone="attention">{t("campaign.rule.needsChange")}</RowNote> : null}
                </s-stack>
              </s-box>
            );
          })}
          <FieldMessage text={err(F.use)} />
        </s-stack>
        <s-stack direction="block" gap="small-300" data-won-campaign-tiers>
          <s-text>{t("campaign.tiers.title")}</s-text>
          {tierSets.length === 0 ? (
            <RowNote>
              {t("campaign.tiers.none")} <s-link href="/app/tiers">{t("campaign.tiers.create")}</s-link>
            </RowNote>
          ) : (
            <RowNote>{t("campaign.tiers.hint")}</RowNote>
          )}
          {tierSets.map((set) => (
            <TierSetFields
              key={set.id}
              set={set}
              rowCount={tierForm.get(set.id)!.rows.length}
              ownRows={tierForm.get(set.id)!.own}
              init={init}
              ticked={usedSets.includes(set.id)}
              disabled={!pro}
              error={errAt(F.tierUse, set.id)}
            />
          ))}
          <FieldMessage text={err(F.tierUse)} />
          {tierSets.length > 0 ? <RowNote>{t("campaign.tiers.timing")}</RowNote> : null}
        </s-stack>
        <RowNote>{t("campaign.scope")}</RowNote>
        {pro ? (
          <s-box padding="small-300" border="base" borderRadius="base" data-won-campaign-summary>
            <s-stack direction="block" gap="small-300">
              <s-text type="strong">{t("campaign.summary.title")}</s-text>
              <RowNote>{startText && endText ? t("campaign.summary.window", { start: startText, end: endText }) : t("campaign.summary.windowMissing")}</RowNote>
              {ruleLines.length === 0 && setLines.length === 0 ? <RowNote>{t("campaign.summary.nothingLong")}</RowNote> : null}
              {ruleLines.map((line) => (
                <RowNote key={line.id}>{line.text}</RowNote>
              ))}
              {setLines.map((line) => (
                <RowNote key={line.id}>{line.text}</RowNote>
              ))}
            </s-stack>
          </s-box>
        ) : null}
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
  const liveCount = campaigns.filter((c) => c.status === "running" || c.status === "scheduled").length;
  const act = (intent: string, id: string) => submit({ [F.intent]: intent, [F.id]: id }, { method: "post" });

  // Which panel is open: a campaign being edited or a refused save → the form; else the list when there is one.
  const running = campaigns.find((c) => c.status === "running") ?? null;
  const next = campaigns.find((c) => c.status === "scheduled") ?? null;
  const showPlaces = pro && props.placements !== undefined;
  const [view, setView] = useView<"list" | "form" | "places">({
    initial: () => (editing || (result && !result.ok) ? "form" : liveCount > 0 || (isCampaignResult(result) && result.ok) || (!pro && campaigns.length > 0) ? "list" : "form"),
    hash: { list: "list", form: "form", places: "places" },
    resetKey: `${editing?.id ?? ""}|${result ? JSON.stringify(result).length : 0}`,
  });
  const listActive = running ? t("campaign.view.list.running", { name: running.name }) : next ? t("campaign.view.list.next", { name: next.name }) : t("overview.campaigns.none");
  const placed = props.placed ?? {};
  const placedCount = [placed.campaignHome, placed.campaignProduct, placed.topBarCampaign].filter(Boolean).length;
  const placesActive = placedCount > 0 ? tr.tp("placement.count", placedCount) : t("placement.none");

  return (
    <s-page heading={t("module.campaigns")}>
      <DiscountsSubNav active="campaigns" />
      <s-stack direction="block" gap="base">
        {isCampaignResult(result) ? <CampaignBanner result={result} /> : <Notice result={result as UiResult | null | undefined} />}

        {/* Three tiles, one panel at a time (doctrine §19e): what runs is the first thing seen. */}
        <ModuleTiles label={t("campaign.view.label")}>
          <ViewTile id="list" title={t("campaign.list.title")} glyph="calendar" about={t("campaign.view.list.about")} active={listActive} status={running ? props.status : undefined} selected={view === "list"} onPick={() => setView("list")} />
          <ViewTile id="form" title={t(editing ? "campaign.edit.title" : "campaign.new.title")} glyph="tag" about={t("campaign.view.form.about")} active={pro ? undefined : t("overview.campaigns.locked")} pro={!pro} locked={!pro} selected={view === "form"} onPick={() => setView("form")} />
          {showPlaces ? (
            <ViewTile id="places" title={t("campaign.places.title")} glyph="store" about={t("campaign.view.places.about")} active={placesActive} selected={view === "places"} onPick={() => setView("places")} />
          ) : null}
        </ModuleTiles>

        <ViewPanel id="list" view={view}>
          {campaigns.length === 0 ? (
            <WonSection
              title={t("campaign.list.title")}
              glyph="calendar"
              summary={t("overview.campaigns.none")}
              action={
                <s-button variant="primary" onClick={() => setView("form")}>
                  {t("campaign.new.title")}
                </s-button>
              }
            />
          ) : null}
        {campaigns.length > 0 ? (
          <WonSection
            title={t("campaign.list.title")}
            glyph="tag"
            // Running → the module's state (the same as the home tile); only scheduled or past ones → no label.
            state={campaigns.some((c) => c.status === "running") ? props.status : undefined}
            summary={liveCount > 0 ? tr.tp("campaign.list.live", liveCount) : undefined}
            anchor="list"
          >
            <s-stack direction="block" gap="base">
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
        ) : null}
        </ViewPanel>

        <ViewPanel id="form" view={view}>
          <RowNote>{t("campaign.hint")}</RowNote>
        <WonSection title={t(editing ? "campaign.edit.title" : "campaign.new.title")} glyph="calendar" pro={!pro} locked={!pro} summary={pro ? summary : undefined} anchor="form">
          {pro ? (
            form
          ) : (
            <s-stack direction="block" gap="base">
              <ProSell benefit={t("campaign.pro.benefit")} />
              <ProFrame locked>{form}</ProFrame>
            </s-stack>
          )}
        </WonSection>

        </ViewPanel>

        <ViewPanel id="places" view={view}>
        {/* Feedback 2, bod 7: the running campaign on the storefront — a banner with a countdown for any page, and the strip at the top. */}
        {pro && props.placements ? (
          <WonSection title={t("campaign.places.title")} glyph="store" summary={t("campaign.places.summary")} anchor="places">
            <StorefrontPlacements
              links={props.placements}
              placed={props.placed}
              rows={[
                { place: "home", key: "campaignHome", text: "campaign.places.home" },
                { place: "product", key: "campaignProduct", text: "campaign.places.product" },
                { place: "topBar", key: "topBarCampaign", text: "campaign.places.topBar", action: "placements.openEmbed" },
              ]}
            />
          </WonSection>
        ) : null}

        </ViewPanel>
      </s-stack>

      {/* "Ukončit hned", "Zrušit kampaň" and "Smazat" ask first (the confirm pattern of the rule editor's delete). */}
      {campaigns.map((c) => {
        const running = c.status === "running";
        const live = running || c.status === "scheduled";
        return (
          <div key={c.id}>
            {live ? (
              <s-modal id={dialogId("kill", c.id)} heading={t(running ? "campaign.confirm.kill.heading" : "campaign.confirm.cancel.heading", { name: c.name })}>
                <s-paragraph>{t(running ? "campaign.confirm.kill.body" : "campaign.confirm.cancel.body")}</s-paragraph>
                <s-button slot="primary-action" variant="primary" tone="critical" commandFor={dialogId("kill", c.id)} command="--hide" onClick={() => act(CAMPAIGN_INTENT.kill, c.id)}>
                  {t(running ? "campaign.action.killNow" : "campaign.action.cancel")}
                </s-button>
                <s-button slot="secondary-actions" commandFor={dialogId("kill", c.id)} command="--hide">
                  {t("campaign.confirm.back")}
                </s-button>
              </s-modal>
            ) : null}
            {!running ? (
              <s-modal id={dialogId("delete", c.id)} heading={t("campaign.confirm.delete.heading", { name: c.name })}>
                <s-paragraph>{t("campaign.confirm.delete.body")}</s-paragraph>
                <s-button slot="primary-action" variant="primary" tone="critical" commandFor={dialogId("delete", c.id)} command="--hide" onClick={() => act(CAMPAIGN_INTENT.delete, c.id)}>
                  {t("campaign.action.delete")}
                </s-button>
                <s-button slot="secondary-actions" commandFor={dialogId("delete", c.id)} command="--hide">
                  {t("campaign.confirm.back")}
                </s-button>
              </s-modal>
            ) : null}
          </div>
        );
      })}
    </s-page>
  );
}
