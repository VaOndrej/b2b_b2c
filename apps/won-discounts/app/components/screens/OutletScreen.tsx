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

import { useEffect, useRef, useState } from "react";
import { Form, useSubmit } from "react-router";

import { formatMoney } from "@won/core/discounts/describe";

import { useT } from "../../i18n/context";
import { pickProducts } from "../model/app-bridge";
import { OUTLET_FIELD, OUTLET_INTENT, outletPreviewPrice, readOutletLive, type OutletLiveDraft } from "../model/outlet";
import { formatDateTime } from "../model/signals";
import { useRefusedSeed } from "../model/submitted";
import type { OutletActionResult, OutletRunView, OutletScreenData, UiResult } from "../model/types";
import { FieldMessage } from "../rule-editor/parts";
import { boolAttr } from "../shell/attrs";
import { Notice } from "../shell/Notice";
import { ProFrame } from "../shell/ProFrame";
import { ProSell } from "../shell/ProSell";
import { DiscountsSubNav } from "../shell/SubNav";
import { RowNote, WonRow, WonSection } from "../shell/WonSection";

const F = OUTLET_FIELD;
const DISPLAYS = ["silent", "strike", "strike_badge", "strike_badge_left"] as const;
const REOPENS = ["ask", "auto", "never"] as const;
/** Where the "sold pieces are not counted" warning points: the end-date field of the new sale. */
const ENDS_ANCHOR = "outlet-ends";
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

function RunCard({ run, pro, money }: { run: OutletRunView; pro: boolean; money: (minor: number, currency: string) => string }) {
  const { t } = useT();
  const ended = run.status === "ended";
  const active = run.status === "active";
  const end = active ? (
    <s-button variant="secondary" tone="critical" commandFor={endDialogId(run.id)} command="--show">
      {t("outlet.run.end")}
    </s-button>
  ) : null;
  return (
    <s-box padding="base" border="base" borderRadius="base">
      <s-stack direction="block" gap="small-300">
        <s-heading>{run.title || t("outlet.run.unknown")}</s-heading>
        <s-text>
          {t(`outlet.status.${run.status}` as "outlet.status.active")}
          {run.price ? ` · ${t("outlet.run.price", { before: money(run.price.before, run.price.currency), after: money(run.price.sale, run.price.currency), percent: run.percent })}` : ""}
        </s-text>
        <RowNote>{t("outlet.run.ledger", { sold: run.sold, quota: run.quota, returned: run.returned, left: run.left })}</RowNote>
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
        {!ended ? <RowNote>{run.endsAt ? t("outlet.run.ends", { at: run.endsAt }) : t("outlet.run.noEnd")}</RowNote> : null}
        {run.listNames.length > 0 ? <RowNote>{t("outlet.run.lists", { names: run.listNames.join(", ") })}</RowNote> : null}
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
        {end && run.oversold === 0 ? <div>{end}</div> : null}
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
      </s-stack>
    </s-box>
  );
}

export function OutletScreen(props: OutletScreenProps) {
  const tr = useT();
  const { t } = tr;
  const { plan, result, running, ended, priceLists, limits, display, reopen, today, configVersion, badgeBlockAddUrl, ordersCounted, shopCurrency } = props;
  const withOthers = props.withOthers === true;
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
    return { quota: whole(F.quota), percent: whole(F.percent), endsOn: seed.one(F.endsOn, ""), priceListIds: seed.all(F.priceList, []) };
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

  const preview = variant ? outletPreviewPrice(variant.price, shopCurrency, live.percent, display) : null;
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

  const form = (
    <Form method="post" ref={formRef} data-won-outlet-new>
      <input type="hidden" name={F.intent} value={OUTLET_INTENT.start} />
      {variant ? <input type="hidden" name={F.variant} value={variant.id} /> : null}
      {variant ? <input type="hidden" name={F.product} value={variant.productId} /> : null}
      {variant ? <input type="hidden" name={F.variantTitle} value={variant.title} /> : null}
      {variant?.price ? <input type="hidden" name={F.variantPrice} value={variant.price} /> : null}
      <s-stack key={seedKey} direction="block" gap="base">
        <s-stack direction="block" gap="small-300">
          <s-text>{t("outlet.new.variant")}</s-text>
          {variant ? <s-text type="strong">{variant.title || t("outlet.summary.variantPicked")}</s-text> : null}
          <div>
            <s-button variant="secondary" onClick={() => void pick()} disabled={boolAttr(!pro)}>
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
        </s-stack>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-start" }}>
          <div>
            <s-number-field name={F.quota} label={t("outlet.new.quota")} value={seed.one(F.quota, "")} min={1} max={limits.quotaMax} step={1} inputMode="numeric" disabled={boolAttr(!pro)} />
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
            <s-date-field name={F.endsOn} label={t("outlet.new.endsOn")} value={seed.one(F.endsOn, "")} allow={`${nextDay(today)}--`} disabled={boolAttr(!pro)} />
            <FieldMessage text={err(F.endsOn)} />
            {/* P3: the warning sits at the field that answers it. */}
            {pro && !ordersCounted && !live.endsOn ? <RowNote tone="attention">{t("outlet.orders.quotaHint")}</RowNote> : null}
          </div>
        </div>
        <RowNote>{priceLine}</RowNote>
        <RowNote>{t("outlet.new.quotaHint")}</RowNote>
        <RowNote>{t("outlet.new.endsOnHint")}</RowNote>
        {priceLists.length > 0 ? (
          <s-stack direction="block" gap="small-300">
            <s-text>{t("outlet.new.lists")}</s-text>
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
        <RowNote>{t("outlet.new.backup")}</RowNote>
        <div>
          <s-button type="submit" variant="primary" disabled={boolAttr(!pro)}>
            {t("outlet.new.start")}
          </s-button>
        </div>
      </s-stack>
    </Form>
  );

  // B15: on Free the settings matter only while earlier sales still run (the server refuses the save the same way).
  const settingsShown = pro || running.length > 0;
  const activeRuns = running.filter((r) => r.status === "active");

  return (
    <s-page heading={t("module.outlet")}>
      <DiscountsSubNav active="outlet" />
      <s-stack direction="block" gap="base">
        {isOutletResult(result) ? <OutletBanner result={result} /> : <Notice result={result as UiResult | null | undefined} />}
        <RowNote>{t("outlet.hint")}</RowNote>
        {!ordersCounted && (pro || running.length > 0) ? (
          <s-banner tone="warning" heading={t("outlet.orders.off")} data-won-outlet-orders="off">
            <s-paragraph>
              {t("outlet.orders.offDetail")} {pro ? <s-link href={`#${ENDS_ANCHOR}`}>{t("outlet.orders.link")}</s-link> : null}
            </s-paragraph>
          </s-banner>
        ) : null}
        {!pro && running.length > 0 ? <RowNote>{t("outlet.pro.running")}</RowNote> : null}

        <WonSection title={t("outlet.new.title")} glyph="tag" pro={!pro} locked={!pro} summary={pro ? summary : undefined} anchor="new">
          {pro ? (
            form
          ) : (
            <s-stack direction="block" gap="base">
              <ProSell benefit={t("outlet.pro.benefit")} />
              <ProFrame locked>{form}</ProFrame>
            </s-stack>
          )}
        </WonSection>

        {/* What a clearance item combines with: said here in full, computed from the one switch in Nastavení (never left to guesswork). */}
        <WonSection title={t("outlet.combine.title")} glyph="sliders" summary={t(withOthers ? "outlet.combine.summary.on" : "outlet.combine.summary.off")} anchor="combine">
          <div>
            <WonRow>
              <RowNote>{t("outlet.combine.price")}</RowNote>
            </WonRow>
            {(["tiers", "product", "order", "shipping", "rewards"] as const).map((key) => (
              <WonRow key={key}>
                <s-text type="strong">{t(`outlet.combine.${key}.label` as "outlet.combine.tiers.label")}</s-text>
                <RowNote>{t(`outlet.combine.${key}.${key === "shipping" || key === "rewards" ? "always" : withOthers ? "on" : "off"}` as "outlet.combine.tiers.on")}</RowNote>
              </WonRow>
            ))}
            <WonRow action={<s-link href="/app/settings#combination">{t("outlet.combine.change")}</s-link>}>
              <RowNote>{t(withOthers ? "outlet.combine.switch.on" : "outlet.combine.switch.off")}</RowNote>
            </WonRow>
          </div>
        </WonSection>
        {running.length > 0 ? (
          <WonSection title={t("outlet.running.title")} glyph="calendar" on summary={tr.tp("overview.outlet.running", running.length)} anchor="running">
            <s-stack direction="block" gap="base">
              {running.map((run) => (
                <RunCard key={run.id} run={run} pro={pro} money={money} />
              ))}
            </s-stack>
          </WonSection>
        ) : null}

        {ended.length > 0 ? (
          <WonSection title={t("outlet.ended.title")} glyph="receipt" summary={t("outlet.ended.count", { n: ended.length })} anchor="ended">
            <s-stack direction="block" gap="base">
              {ended.map((run) => (
                <RunCard key={run.id} run={run} pro={pro} money={money} />
              ))}
            </s-stack>
          </WonSection>
        ) : null}

        {settingsShown ? (
          <WonSection title={t("outlet.settings.title")} glyph="sliders" summary={t(`outlet.display.${display}` as "outlet.display.strike")} hint={t("outlet.settings.summary")}>
            <Form method="post">
              <input type="hidden" name={F.intent} value={OUTLET_INTENT.settings} />
              {configVersion ? <input type="hidden" name="configVersion" value={configVersion} /> : null}
              <s-stack direction="block" gap="base">
                <s-select name={F.display} label={t("outlet.display.label")} value={display}>
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
