import { useCallback, useEffect, useRef, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useLoaderData } from "react-router";

import {
  LOCALE_LIMIT_FREE,
  LOCALE_LIMIT_PRO,
  capLocales,
  localeLimit,
  normalizeLocale,
} from "@won/core/toasts/locales";
import { FREE_CURRENCY_LIMIT } from "@won/core/toasts/tier";

import type {
  NotificationRule,
  NotificationType,
} from "@won/core/toasts/notifications";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import { MessageMatrix } from "../components/MessageMatrix";
import { HydrationGate } from "../components/HydrationGate";
import { ProSell } from "../components/ProSell";
import { WonSection } from "../components/WonSection";
import {
  mergeMessages,
  pruneMessages,
  updateAnnouncementTranslations,
} from "../lib/localization";
import { EVENT_META, languageName } from "../lib/labels";
import { useSavedToast } from "../lib/use-saved-toast";
import { persistConfig } from "../lib/persist-config.server";

// Upper cap on per-currency free-shipping rows the action reads (Markets caps at
// 50). The editor itself shows only existing rows + one blank (lazy-add, §9c).
const MKT_CURRENCY_ROWS = 50;

/**
 * Notification toasts whose wording the merchant writes, and which therefore need
 * per-locale copy. Kept in one list so the editor and the action can't disagree
 * about which types are translatable.
 *
 * order.summary / order.created are absent on purpose: they need the orders/create
 * webhook, which is off, and the app no longer offers them.
 */
const TRANSLATABLE_RULES: { type: NotificationType; label: string }[] = [
  { type: "announcement", label: "Announcement" },
  { type: "countdown", label: "Countdown timer" },
  { type: "stock.low", label: "Low-stock urgency" },
  { type: "cart.activity", label: "Cart activity" },
];

/**
 * The shop's own languages, read from Shopify (`shopLocales`, scope read_locales).
 *
 * The page used to ask the merchant to re-declare their languages in a matrix of
 * 12 checkboxes — a second, hand-maintained copy of something Shopify already
 * knows, free to drift from the storefront it is supposed to describe. Now the
 * shop is the source of truth and the merchant only translates.
 *
 * Degrades to [] rather than failing the page: without languages the merchant
 * still edits their default copy, which is the common case (REL-1).
 */
const SHOP_LOCALES_QUERY = `#graphql
  query WonShopLocales {
    shopLocales { locale name primary published }
  }`;

/**
 * The shop's real free-shipping rules (scope read_shipping). Won only ANNOUNCES a
 * milestone — the rule itself lives in Shopify shipping. Asking the merchant to
 * retype the amount here guarantees the two drift apart silently, so we read the
 * real one and offer it. Validated against Admin API 2026-04.
 */
const FREE_SHIPPING_QUERY = `#graphql
  query WonFreeShipping {
    deliveryProfiles(first: 5) {
      nodes {
        profileLocationGroups {
          locationGroupZones(first: 10) {
            nodes {
              methodDefinitions(first: 20) {
                nodes {
                  active
                  rateProvider {
                    ... on DeliveryRateDefinition {
                      price { amount currencyCode }
                    }
                  }
                  methodConditions {
                    field
                    operator
                    conditionCriteria {
                      ... on MoneyV2 { amount currencyCode }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }`;

/** A free-shipping threshold discovered in the shop's own shipping rates. */
interface DiscoveredThreshold {
  currency: string;
  amount: number;
}

/**
 * Pull "spend X and shipping is free" out of the delivery profiles: an ACTIVE
 * method whose rate is 0 and which carries a minimum-subtotal condition.
 *
 * Deliberately conservative — anything it can't read with confidence is skipped
 * rather than guessed at, because a wrong number here would make the app promise
 * a shopper free shipping they don't get (§12).
 */
function discoverFreeShipping(payload: unknown): DiscoveredThreshold[] {
  const out: DiscoveredThreshold[] = [];
  const seen = new Set<string>();
  const profiles =
    (payload as { data?: { deliveryProfiles?: { nodes?: unknown[] } } })?.data
      ?.deliveryProfiles?.nodes ?? [];
  for (const profile of profiles) {
    const groups = (profile as { profileLocationGroups?: unknown[] })?.profileLocationGroups ?? [];
    for (const group of groups) {
      const zones =
        (group as { locationGroupZones?: { nodes?: unknown[] } })?.locationGroupZones?.nodes ?? [];
      for (const zone of zones) {
        const methods =
          (zone as { methodDefinitions?: { nodes?: unknown[] } })?.methodDefinitions?.nodes ?? [];
        for (const m of methods) {
          const method = m as {
            active?: boolean;
            rateProvider?: { price?: { amount?: string; currencyCode?: string } };
            methodConditions?: {
              field?: string;
              conditionCriteria?: { amount?: string; currencyCode?: string };
            }[];
          };
          if (method.active === false) continue;
          const price = Number(method.rateProvider?.price?.amount);
          if (!Number.isFinite(price) || price !== 0) continue; // not free
          for (const cond of method.methodConditions ?? []) {
            if (cond?.field !== "TOTAL_PRICE") continue;
            const amount = Number(cond.conditionCriteria?.amount);
            const currency = cond.conditionCriteria?.currencyCode;
            if (!Number.isFinite(amount) || amount <= 0 || !currency) continue;
            const key = `${currency}:${amount}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ currency, amount: Math.round(amount * 100) });
          }
        }
      }
    }
  }
  return out.slice(0, 10);
}

interface ShopLocale {
  locale: string;
  name: string;
  primary: boolean;
  published: boolean;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);

  let shopLocales: ShopLocale[] = [];
  try {
    const res = await admin.graphql(SHOP_LOCALES_QUERY);
    const body = (await res.json()) as { data?: { shopLocales?: ShopLocale[] } };
    shopLocales = (body?.data?.shopLocales ?? []).filter((l) => l?.locale);
  } catch {
    // Scope not yet granted, or the API is unhappy — say so in the UI instead of
    // pretending the shop has no languages.
    shopLocales = [];
  }

  // Best-effort: the page is fully usable without it, so a missing scope or an
  // unhappy API must never take Markets down (REL-1).
  let discovered: DiscoveredThreshold[] = [];
  try {
    const res = await admin.graphql(FREE_SHIPPING_QUERY);
    discovered = discoverFreeShipping(await res.json());
  } catch {
    discovered = [];
  }

  return { config, shopLocales, discovered };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  const f = await request.formData();

  // Which languages exist + the default/fallback (locale-as-data). Free is capped
  // to its language limit; the default is always kept.
  // Read every rendered `lang_*` checkbox rather than a hard-coded list — the
  // options now come from the shop's own languages, so the action must not assume
  // which codes exist.
  const chosen: string[] = [];
  for (const [key, value] of f.entries()) {
    if (key === "lang_custom" || !key.startsWith("lang_")) continue;
    if (String(value) === "on") chosen.push(normalizeLocale(key.slice("lang_".length)));
  }
  const extra = String(f.get("lang_custom") ?? "")
    .split(/[\s,]+/)
    .map((c) => normalizeLocale(c))
    .filter(Boolean);
  const wantDefault = normalizeLocale(f.get("default_locale")) || "en";
  const dedup = capLocales([wantDefault, ...chosen, ...extra], localeLimit(config.plan));
  const locales = {
    enabledLocales: dedup.length ? dedup : ["en"],
    defaultLocale: wantDefault,
  };

  // Translations: this page owns every NON-default locale. Merge into the stored
  // map so the default copy (edited on the Toasts page) is preserved.
  const editLocales = locales.enabledLocales.filter((l) => l !== locales.defaultLocale);
  const edits: Record<string, Record<string, string>> = {};
  for (const ev of EVENT_META) {
    edits[ev.key] = {};
    for (const loc of editLocales) {
      edits[ev.key][loc] = String(f.get(`msg_${ev.key}_${loc}`) ?? "");
    }
  }
  // Merge this page's edits, then drop any locale the merchant just removed.
  const messages = pruneMessages(
    mergeMessages(config.messages, edits),
    locales.enabledLocales,
  );

  // Every notification whose wording the merchant writes gets its translations
  // saved here. This page owns the NON-default locales only; the Toasts page owns
  // each rule's default message and its other fields, so we merge rather than
  // replace (a save here must never wipe the default copy).
  let notifications: NotificationRule[] | undefined;
  const translatable = new Set<string>(
    TRANSLATABLE_RULES.map((r) => r.type as string),
  );
  if (config.notifications.some((n) => translatable.has(n.type))) {
    notifications = config.notifications.map((rule) => {
      if (!translatable.has(rule.type)) return rule;
      const edits: Record<string, string> = {};
      for (const loc of editLocales) {
        edits[loc] = String(f.get(`${rule.type}_msg_${loc}`) ?? "");
      }
      const current =
        "messages" in rule
          ? (rule.messages as Record<string, string> | undefined)
          : undefined;
      return {
        ...rule,
        messages: updateAnnouncementTranslations(
          current,
          edits,
          locales.defaultLocale,
          locales.enabledLocales,
        ),
      } as NotificationRule;
    });
  }

  // Currencies: per-presentment-currency free-shipping thresholds. This page owns
  // the currency table; the Toasts page owns the base amount/label/on-off — so we
  // update ONLY the free_shipping milestone's `thresholds` and keep the rest.
  const shipThresholds: Record<string, number> = {};
  for (let i = 0; i < MKT_CURRENCY_ROWS; i++) {
    const code = String(f.get(`cur_code_${i}`) ?? "").trim().toUpperCase();
    const raw = f.get(`cur_amt_${i}`);
    if (!/^[A-Z]{3}$/.test(code)) continue;
    if (raw == null || String(raw).trim() === "") continue;
    const n = Number(String(raw).replace(",", "."));
    if (Number.isFinite(n) && n > 0) shipThresholds[code] = Math.round(n * 100);
  }
  const milestones = config.milestones.map((m) =>
    m.kind === "free_shipping" ? { ...m, thresholds: shipThresholds } : m,
  );

  return persistConfig(() =>
    updateToastConfig(session.shop, {
      locales,
      messages,
      milestones,
      ...(notifications ? { notifications } : {}),
    }),
  );
};

export default function MarketsRoute() {
  const { config, shopLocales, discovered } = useLoaderData<typeof loader>();
  const saveError = useSavedToast();
  const isPro = config.plan === "pro";
  const loc = config.locales;
  const langLimit = isPro ? LOCALE_LIMIT_PRO : LOCALE_LIMIT_FREE;

  // Existing per-currency free-shipping thresholds → editable rows (+ blanks to
  // add more). The base amount + on/off stay on Toasts; here we set per-currency.
  const ship = config.milestones.find((m) => m.kind === "free_shipping");
  const currencyRows: { code: string; amount: string }[] = Object.entries(
    ship?.thresholds ?? {},
  )
    .slice(0, MKT_CURRENCY_ROWS)
    .map(([code, cents]) => ({ code, amount: String(cents / 100) }));
  // §9c: lazy-add — show what's set plus ONE blank row to add the next, not a
  // wall of empty pairs. Each saved currency reveals the next blank.
  currencyRows.push({ code: "", amount: "" });

  // Live language set: checking a language reveals its translation column
  // immediately (no save+reload). Mirrors the action's dedup so what you see is
  // what will save. s-* controls fire NATIVE events (not React), so we listen on
  // the form ref (doctrine §2).
  const formRef = useRef<HTMLFormElement>(null);
  const [liveLocales, setLiveLocales] = useState<string[]>(loc.enabledLocales);
  const [liveDefault, setLiveDefault] = useState<string>(loc.defaultLocale);
  const recompute = useCallback(() => {
    const form = formRef.current;
    if (!form) return;
    const fd = new FormData(form);
    const chosen: string[] = [];
    for (const [key, value] of fd.entries()) {
      if (key === "lang_custom" || !key.startsWith("lang_")) continue;
      if (String(value) === "on") chosen.push(normalizeLocale(key.slice("lang_".length)));
    }
    const extra = String(fd.get("lang_custom") ?? "")
      .split(/[\s,]+/)
      .map((c) => normalizeLocale(c))
      .filter(Boolean);
    const wantDefault = normalizeLocale(fd.get("default_locale")) || "en";
    const dedup = capLocales(
      [wantDefault, ...chosen, ...extra],
      localeLimit(config.plan),
    );
    setLiveLocales(dedup.length ? dedup : ["en"]);
    setLiveDefault(wantDefault);
  }, [config.plan]);
  useEffect(() => {
    const el = formRef.current;
    if (!el) return;
    el.addEventListener("input", recompute);
    el.addEventListener("change", recompute);
    return () => {
      el.removeEventListener("input", recompute);
      el.removeEventListener("change", recompute);
    };
  }, [recompute]);
  useEffect(() => {
    setLiveLocales(config.locales.enabledLocales);
    setLiveDefault(config.locales.defaultLocale);
  }, [config]);

  const editLocales = liveLocales.filter((l) => l !== liveDefault);

  // State-at-rest lines (§17). They state what is ACTUALLY in force: on Free the
  // language count is capped server-side, so quote the cap, not the wish.
  const langSummary = `${liveLocales.length} of ${String(langLimit)} languages in use · default ${languageName(liveDefault)}`;
  const savedCurrencies = Object.keys(ship?.thresholds ?? {}).length;
  const currencySummary =
    savedCurrencies === 0
      ? "Base amount only — no per-currency thresholds set"
      : `${savedCurrencies} ${savedCurrencies === 1 ? "currency" : "currencies"} with their own threshold`;


  return (
    <s-page heading="Markets" inlineSize="large">
      {saveError ? (
        <s-section>
          <s-banner tone="critical" heading="Your changes weren’t saved">
            <s-paragraph>{saveError}</s-paragraph>
          </s-banner>
        </s-section>
      ) : null}

      <s-section>
        <s-paragraph>
          Everything that changes market to market in one place — the language your
          toasts speak, and the currencies you sell in. Write your default copy on{" "}
          <s-link href="/app/toasts">Toasts</s-link>; translate it below for every
          other language (a shopper sees their language, falling back to your default
          when a translation is blank).
        </s-paragraph>
      </s-section>

      <Form method="post" data-save-bar ref={formRef}>
        <HydrationGate>
        {/* The shop is the source of truth for WHICH languages exist (§5 — real
            data). The merchant used to re-pick them from a 12-checkbox matrix that
            had nothing to do with their storefront and could silently disagree
            with it; now they only choose which of their OWN languages the toasts
            get translated into. */}
        <WonSection
          title="Your languages"
          glyph="target"
          summary={langSummary}
          hint="Languages come from your Shopify store. Add one there and it appears here."
        >
          <s-stack direction="block" gap="base">
            {shopLocales.length === 0 ? (
              // Honest on empty (§5/§15): don't imply the shop has no languages
              // when we may simply not have been able to read them.
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">We couldn’t read your store’s languages</s-text>
                  <s-text color="subdued">
                    This needs the app’s language permission. If you just updated the
                    app, re-open it once to accept it. In the meantime you can still
                    type language codes below.
                  </s-text>
                </s-stack>
              </s-box>
            ) : (
              <s-stack direction="block" gap="small">
                <s-text color="subdued">
                  Tick the ones your toasts should be translated into.
                  {isPro ? "" : ` Free covers ${String(LOCALE_LIMIT_FREE)} languages.`}
                </s-text>
                <s-stack direction="inline" gap="base">
                  {shopLocales.map((l) => (
                    <s-checkbox
                      key={l.locale}
                      label={`${l.name}${l.primary ? " (primary)" : ""}`}
                      name={`lang_${l.locale}`}
                      value="on"
                      // Controlled to LIVE state so the box and the translation
                      // columns below can never disagree.
                      checked={liveLocales.includes(l.locale)}
                      onChange={() => recompute()}
                    />
                  ))}
                </s-stack>
              </s-stack>
            )}

            {!isPro ? (
              <ProSell
                benefit={`Free translates into ${String(LOCALE_LIMIT_FREE)} languages. Pro covers up to ${String(LOCALE_LIMIT_PRO)}, so every market a shopper arrives from reads your toasts in their own language.`}
              />
            ) : null}

            <details>
              <summary style={{ cursor: "pointer", padding: "4px 0" }}>
                <s-text type="strong">Need a language that isn’t listed?</s-text>
              </summary>
              <div style={{ marginTop: 8 }}>
                <s-stack direction="block" gap="base">
                  <s-text color="subdued">
                    Add it to your store first — Shopify{" "}
                    <s-text type="strong">Settings → Languages → Add language</s-text>,
                    then publish it. It shows up here automatically. If you want the
                    toasts translated before the language is published, type its code
                    below.
                  </s-text>
                  <s-text-field
                    label="Extra language codes"
                    name="lang_custom"
                    value={loc.enabledLocales
                      .filter((c) => !shopLocales.some((l) => l.locale === c))
                      .join(", ")}
                    placeholder="pt-pt, sv, da"
                    details="Comma-separated, e.g. de, pt-BR, zh-Hant. Anything beyond your plan’s language count is dropped on save."
                  />
                </s-stack>
              </div>
            </details>

            <s-select label="Default (fallback) language" name="default_locale" value={loc.defaultLocale} details="Shown when a shopper’s language has no translation yet.">
              {[...new Set([loc.defaultLocale, ...liveLocales, "en"])].map((c) => (
                <s-option key={c} value={c}>{languageName(c)}</s-option>
              ))}
            </s-select>
          </s-stack>
        </WonSection>

        <WonSection
          title="Translations"
          glyph="toast"
          summary={
            editLocales.length === 0
              ? `Only ${languageName(liveDefault)} — nothing to translate yet`
              : `${editLocales.length} ${editLocales.length === 1 ? "language" : "languages"} to fill in`
          }
        >
          {editLocales.length === 0 ? (
            <s-paragraph>
              You only have your default language ({languageName(liveDefault)}).
              Check another language above and a column to translate into appears
              here right away.
            </s-paragraph>
          ) : (
            <s-stack direction="block" gap="base">
              <s-text color="subdued">
                Under each toast you can see your default wording — translate it in
                each column. Blank cells fall back to that default.
              </s-text>
              <MessageMatrix
                theme={config.theme}
                locales={editLocales}
                messages={config.messages}
                referenceLocale={loc.defaultLocale}
              />

              {/* Cart events are only half the merchant-written copy. The
                  notification toasts carry their own wording and used to be
                  English-only — the announcement row was even hidden entirely
                  until the rule existed, so a merchant looking for it saw nothing
                  and reasonably concluded it wasn't translatable (A5). */}
              {TRANSLATABLE_RULES.map((meta) => {
                const rule = config.notifications.find((n) => n.type === meta.type);
                const base =
                  rule && "message" in rule ? String(rule.message ?? "") : "";
                const perLocale =
                  rule && "messages" in rule
                    ? (rule.messages as Record<string, string> | undefined)
                    : undefined;
                return (
                  <s-box key={meta.type} padding="base" borderWidth="base" borderRadius="base">
                    <s-stack direction="block" gap="small">
                      <s-text type="strong">{meta.label}</s-text>
                      {rule ? (
                        <s-text color="subdued">
                          Your default: “{base || "(not written yet)"}”
                        </s-text>
                      ) : (
                        // Honest empty state instead of hiding the row (§15/§13b).
                        <s-text color="subdued">
                          Not set up yet — turn it on and write its wording on{" "}
                          <s-link href="/app/toasts">Toasts</s-link>, then translate
                          it here.
                        </s-text>
                      )}
                      {rule ? (
                        <s-stack direction="inline" gap="base">
                          {editLocales.map((lc) => (
                            <s-text-field
                              key={lc}
                              label={languageName(lc)}
                              name={`${meta.type}_msg_${lc}`}
                              value={perLocale?.[lc] ?? ""}
                              placeholder={base || undefined}
                            />
                          ))}
                        </s-stack>
                      ) : null}
                    </s-stack>
                  </s-box>
                );
              })}
            </s-stack>
          )}
        </WonSection>

        <WonSection
          title="Currencies"
          glyph="placement"
          summary={currencySummary}
          hint={
            isPro
              ? "Only needed if you sell in more than one currency."
              : `Free covers ${String(FREE_CURRENCY_LIMIT)} currencies. Only needed if you sell in more than one.`
          }
        >
          <s-stack direction="block" gap="base">
            {/* What Shopify actually charges — the merchant should not be copying
                this across by hand and hoping it stays in sync (§12: Won only
                ANNOUNCES the milestone, it never grants it). */}
            {discovered.length > 0 ? (
              <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">Found in your shipping rates</s-text>
                  <s-text color="subdued">
                    Your store gives free shipping from{" "}
                    <s-text type="strong">
                      {discovered
                        .map((d) => `${(d.amount / 100).toLocaleString("en-US")} ${d.currency}`)
                        .join(", ")}
                    </s-text>
                    . Use the same numbers below so the toast never promises free
                    shipping a shopper doesn’t get.
                  </s-text>
                </s-stack>
              </s-box>
            ) : null}

            {!isPro ? (
              <ProSell
                benefit={`Free covers ${String(FREE_CURRENCY_LIMIT)} currencies. Pro removes the limit, so every market you sell into gets its own honest threshold.`}
              />
            ) : null}
            <s-text color="subdued">
              Set your free-shipping threshold per currency so a shopper paying in
              EUR isn&apos;t measured against your base amount. The base amount +
              on/off live on <s-link href="/app/toasts">Toasts</s-link>; currencies
              left blank use it.
            </s-text>
            {currencyRows.map((row, i) => (
              <s-stack key={i} direction="inline" gap="base">
                <s-text-field
                  label="Currency"
                  name={`cur_code_${i}`}
                  value={row.code}
                  placeholder="EUR"
                  maxLength={3}
                  details={i === 0 ? "ISO code, e.g. EUR, USD, GBP." : undefined}
                />
                <s-money-field
                  label="Threshold"
                  name={`cur_amt_${i}`}
                  value={row.amount}
                  min={0}
                />
              </s-stack>
            ))}
          </s-stack>
        </WonSection>
        </HydrationGate>
      </Form>
    </s-page>
  );
}
