// Výprodej (MVP 5, Pro) — the module screen (contract O10). "Doprodat N kusů, pak zpět na plnou cenu":
//   1. Nový výprodej — a variant (Shopify's picker), the quota (every piece sold counts, the screen says so),
//      a whole percent, an optional end day (shop-local), the price lists with fixed prices; one button starts
//      it. Free (amber, §16): the form is shown locked, nothing starts (BILL-1, A6);
//   2. Běžící výprodeje — price before → during, the ledger (sold / returned / left), an exact "sold past the
//      quota", the end, the steps, "Ukončit výprodej";
//   3. Skončené výprodeje — why and when; returned pieces after the end ask "Znovu otevřít" / "Nechat skončený";
//   4. Zobrazení a vratky — the 4 display levels, the return-after-end setting, the badge block deep link.
// Each action is its own small form (one button = one action, §13); the server parses it (outlet-admin.server.ts).

import { useState } from "react";
import { Form } from "react-router";

import { formatMoney } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import { pickProducts } from "../model/app-bridge";
import { OUTLET_FIELD, OUTLET_INTENT } from "../model/outlet";
import type { OutletActionResult, OutletRunView, OutletScreenData, UiResult } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { Notice } from "../shell/Notice";
import { ProFrame } from "../shell/ProFrame";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

const F = OUTLET_FIELD;
const DISPLAYS = ["silent", "strike", "strike_badge", "strike_badge_left"] as const;
const REOPENS = ["ask", "auto", "never"] as const;

export interface OutletScreenProps extends OutletScreenData {
  result?: OutletActionResult | UiResult | null;
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
  return null;
}

function RunCard({ run, pro, money }: { run: OutletRunView; pro: boolean; money: (minor: number, currency: string) => string }) {
  const { t } = useT();
  const ended = run.status === "ended";
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small-300">
        <s-heading>{run.title || t("outlet.run.unknown")}</s-heading>
        <s-text>
          {t(`outlet.status.${run.status}` as "outlet.status.active")}
          {run.price ? ` · ${t("outlet.run.price", { before: money(run.price.before, run.price.currency), after: money(run.price.sale, run.price.currency), percent: run.percent })}` : ""}
        </s-text>
        <RowNote>{t("outlet.run.ledger", { sold: run.sold, quota: run.quota, returned: run.returned, left: run.left })}</RowNote>
        {run.oversold > 0 ? <RowNote tone="attention">{t("outlet.run.oversold", { n: run.oversold })}</RowNote> : null}
        {ended && run.endReason && run.endedAt ? <RowNote>{t(`outlet.ended.reason.${run.endReason}` as "outlet.ended.reason.manual", { at: run.endedAt })}</RowNote> : null}
        {!ended ? <RowNote>{run.endsAt ? t("outlet.run.ends", { at: run.endsAt }) : t("outlet.run.noEnd")}</RowNote> : null}
        {run.lists > 0 ? <RowNote>{t("outlet.run.lists", { n: run.lists })}</RowNote> : null}
        {run.problem ? <RowNote tone="attention">{run.problem}</RowNote> : null}
        {run.history.length > 0 ? (
          <details>
            <summary style={{ cursor: "pointer", fontSize: 13 }}>{t("outlet.run.history")}</summary>
            <s-unordered-list>
              {run.history.map((h, i) => (
                <s-list-item key={`${h.kind}-${i}`}>
                  {h.at} · {h.text}
                </s-list-item>
              ))}
            </s-unordered-list>
          </details>
        ) : null}
        {run.status === "active" ? (
          <Form method="post">
            <input type="hidden" name={F.intent} value={OUTLET_INTENT.end} />
            <input type="hidden" name={F.run} value={run.id} />
            <s-button type="submit" variant="secondary" tone="critical">
              {t("outlet.run.end")}
            </s-button>
          </Form>
        ) : null}
        {ended && run.returnPending > 0 ? (
          <WonRow tone="attention" action={null}>
            <s-stack direction="block" gap="small-300">
              <RowNote tone="attention">{t("outlet.ended.pending", { n: run.returnPending })}</RowNote>
              <s-stack direction="inline" gap="small-300">
                <Form method="post">
                  <input type="hidden" name={F.intent} value={OUTLET_INTENT.reopen} />
                  <input type="hidden" name={F.run} value={run.id} />
                  <s-button type="submit" variant="primary" disabled={boolAttr(!pro)}>
                    {t("outlet.ended.reopen")}
                  </s-button>
                </Form>
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
      </s-stack>
    </s-box>
  );
}

export function OutletScreen(props: OutletScreenProps) {
  const tr = useT();
  const { t } = tr;
  const { plan, result, running, ended, priceLists, limits, display, reopen, today, configVersion, badgeBlockAddUrl } = props;
  const pro = plan === "pro";
  const money = (minor: number, currency: string) => formatMoney(minor, currency, tr.locale);
  const [variant, setVariant] = useState<{ id: string; productId: string; title: string } | null>(null);
  const [pickError, setPickError] = useState(false);
  const err = (field: string) => {
    if (!result || result.ok || result.reason !== "invalid") return undefined;
    const e = result.errors?.find((x) => x.field === field);
    return e ? t(e.key, e.params) : undefined;
  };

  const pick = async () => {
    // One variant a sale (audit A2): the picker takes a single product; its first picked variant.
    const picked = await pickProducts(variant ? [variant.productId] : [], { multiple: false });
    setPickError(!picked.ok && picked.reason === "unavailable");
    if (!picked.ok) return;
    const product = picked.items[0];
    const v = product?.variants[0];
    if (!product || !v) return;
    setVariant({ id: v.id, productId: product.id, title: v.title && v.title !== "Default Title" ? `${product.title} — ${v.title}` : product.title });
  };

  const form = (
    <Form method="post" data-won-outlet-new>
      <input type="hidden" name={F.intent} value={OUTLET_INTENT.start} />
      {variant ? <input type="hidden" name={F.variant} value={variant.id} /> : null}
      {variant ? <input type="hidden" name={F.product} value={variant.productId} /> : null}
      <s-stack direction="block" gap="base">
        <s-stack direction="block" gap="small-300">
          <s-text>{t("outlet.new.variant")}</s-text>
          <RowNote>{variant ? variant.title : t("outlet.new.none")}</RowNote>
          <div>
            <s-button variant="secondary" onClick={() => void pick()} disabled={boolAttr(!pro)}>
              {t(variant ? "outlet.new.change" : "outlet.new.pick")}
            </s-button>
          </div>
          {pickError ? <RowNote tone="attention">{t("outlet.new.pickUnavailable")}</RowNote> : null}
          {err(F.variant) ? <RowNote tone="attention">{err(F.variant)}</RowNote> : null}
        </s-stack>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <s-number-field name={F.quota} label={t("outlet.new.quota")} min={1} max={limits.quotaMax} step={1} inputMode="numeric" error={err(F.quota)} disabled={boolAttr(!pro)} />
          <s-number-field
            name={F.percent}
            label={t("outlet.new.percent")}
            min={limits.percentMin}
            max={limits.percentMax}
            step={1}
            suffix="%"
            inputMode="numeric"
            error={err(F.percent)}
            disabled={boolAttr(!pro)}
          />
          <s-date-field name={F.endsOn} label={t("outlet.new.endsOn")} allow={`${nextDay(today)}--`} error={err(F.endsOn)} disabled={boolAttr(!pro)} />
        </div>
        <RowNote>{t("outlet.new.quotaHint")}</RowNote>
        <RowNote>{t("outlet.new.endsOnHint")}</RowNote>
        <s-stack direction="block" gap="small-300">
          <s-text>{t("outlet.new.lists")}</s-text>
          {priceLists.length === 0 ? (
            <RowNote>{t("outlet.new.listsNone")}</RowNote>
          ) : (
            priceLists.map((l) => <s-checkbox key={l.id} name={F.priceList} value={l.id} label={`${l.title} (${l.currency})`} disabled={boolAttr(!pro)} />)
          )}
          <RowNote>{err(F.priceList) ?? t("outlet.new.listsHint")}</RowNote>
        </s-stack>
        <RowNote>{t("outlet.new.backup")}</RowNote>
        <div>
          <s-button type="submit" variant="primary" disabled={boolAttr(!pro)}>
            {t("outlet.new.start")}
          </s-button>
        </div>
      </s-stack>
    </Form>
  );

  return (
    <s-page heading={t("module.outlet")}>
      <s-stack direction="block" gap="base">
        {isOutletResult(result) ? <OutletBanner result={result} /> : <Notice result={result as UiResult | null | undefined} />}
        <RowNote>{t("outlet.hint")}</RowNote>
        {!pro && running.length > 0 ? <RowNote>{t("outlet.pro.running")}</RowNote> : null}

        <WonSection title={t("outlet.new.title")} glyph="tag" pro={!pro} locked={!pro} summary={t("outlet.new.summary")} anchor="new">
          {pro ? (
            form
          ) : (
            <ProFrame locked>
              <s-stack direction="block" gap="small-300">
                <RowNote>{t("outlet.pro.locked")}</RowNote>
                {form}
              </s-stack>
            </ProFrame>
          )}
        </WonSection>

        <WonSection
          title={t("outlet.running.title")}
          glyph="calendar"
          on={running.length > 0}
          summary={running.length === 0 ? t("outlet.running.none") : tr.tp("overview.outlet.running", running.length)}
          anchor="running"
        >
          <s-stack direction="block" gap="base">
            {running.length === 0 ? <RowNote>{t("outlet.running.none")}</RowNote> : running.map((run) => <RunCard key={run.id} run={run} pro={pro} money={money} />)}
          </s-stack>
        </WonSection>

        <WonSection title={t("outlet.ended.title")} glyph="receipt" summary={ended.length === 0 ? t("outlet.ended.none") : t("outlet.ended.count", { n: ended.length })} anchor="ended">
          <s-stack direction="block" gap="base">
            {ended.length === 0 ? <RowNote>{t("outlet.ended.none")}</RowNote> : ended.map((run) => <RunCard key={run.id} run={run} pro={pro} money={money} />)}
          </s-stack>
        </WonSection>

        <WonSection title={t("outlet.settings.title")} glyph="sliders" summary={t(`outlet.display.${display}` as "outlet.display.strike")} hint={t("outlet.settings.summary")}>
          <Form method="post">
            <input type="hidden" name={F.intent} value={OUTLET_INTENT.settings} />
            {configVersion ? <input type="hidden" name="configVersion" value={configVersion} /> : null}
            <s-stack direction="block" gap="base">
              <s-select name={F.display} label={t("outlet.display.label")}>
                {DISPLAYS.map((d) => (
                  <s-option key={d} value={d} selected={boolAttr(d === display)}>
                    {t(`outlet.display.${d}` as "outlet.display.strike")}
                  </s-option>
                ))}
              </s-select>
              <RowNote>{t("outlet.display.note")}</RowNote>
              {badgeBlockAddUrl ? (
                <WonRow
                  action={
                    <s-button href={badgeBlockAddUrl} target="_top" variant="secondary">
                      {t("outlet.badge.add")}
                    </s-button>
                  }
                >
                  <RowNote>{t("outlet.badge.hint")}</RowNote>
                </WonRow>
              ) : null}
              <s-select name={F.reopen} label={t("outlet.reopen.label")}>
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
      </s-stack>
    </s-page>
  );
}
