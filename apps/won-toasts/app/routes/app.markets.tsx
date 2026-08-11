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

import type { NotificationRule } from "@won/core/toasts/notifications";

import { authenticate } from "../shopify.server";
import {
  getToastConfig,
  updateToastConfig,
} from "../services/toast-config.server";
import { MessageMatrix } from "../components/MessageMatrix";
import {
  COMMON_LOCALES,
  mergeMessages,
  pruneMessages,
  updateAnnouncementTranslations,
} from "../lib/localization";
import { EVENT_META, languageName } from "../lib/labels";
import { useSavedToast } from "../lib/use-saved-toast";
import { persistConfig } from "../lib/persist-config.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { config: await getToastConfig(session.shop) };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const config = await getToastConfig(session.shop);
  const f = await request.formData();

  // Which languages exist + the default/fallback (locale-as-data). Free is capped
  // to its language limit; the default is always kept.
  const chosen = COMMON_LOCALES.map((l) => l.code).filter((c) => f.get(`lang_${c}`) === "on");
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

  // Announcement is the one notification with its own copy — its translations live
  // here too. Update only that rule's per-locale messages, preserving everything
  // else (the Toasts page owns its default message + other fields).
  const annIndex = config.notifications.findIndex((n) => n.type === "announcement");
  let notifications: NotificationRule[] | undefined;
  const ann = annIndex >= 0 ? config.notifications[annIndex] : undefined;
  if (ann && ann.type === "announcement") {
    const annEdits: Record<string, string> = {};
    for (const loc of editLocales) {
      annEdits[loc] = String(f.get(`announcement_msg_${loc}`) ?? "");
    }
    const updated: NotificationRule = {
      ...ann,
      messages: updateAnnouncementTranslations(
        ann.messages,
        annEdits,
        locales.defaultLocale,
        locales.enabledLocales,
      ),
    };
    notifications = config.notifications.map((n, i) => (i === annIndex ? updated : n));
  }

  return persistConfig(() =>
    updateToastConfig(session.shop, {
      locales,
      messages,
      ...(notifications ? { notifications } : {}),
    }),
  );
};

export default function LanguagesRoute() {
  const { config } = useLoaderData<typeof loader>();
  const saveError = useSavedToast();
  const isPro = config.plan === "pro";
  const loc = config.locales;
  const langLimit = isPro ? LOCALE_LIMIT_PRO : LOCALE_LIMIT_FREE;

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
    const chosen = COMMON_LOCALES.map((l) => l.code).filter(
      (c) => fd.get(`lang_${c}`) === "on",
    );
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

  // Announcement is the one notification with its own copy — translate it here too.
  const announcement = config.notifications.find((n) => n.type === "announcement");
  const annMessage =
    announcement && "message" in announcement ? announcement.message : "";
  const annMessages =
    announcement && "messages" in announcement ? announcement.messages : undefined;

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
        <s-section heading="Your languages">
          <s-stack direction="block" gap="base">
            <s-text color="subdued">
              Pick the languages your storefront copy is written in. Your plan
              includes <s-text type="strong">{String(langLimit)}</s-text> languages
              {isPro ? "" : " — upgrade to Pro for more"}.
            </s-text>
            <s-stack direction="inline" gap="base">
              {COMMON_LOCALES.map((l) => (
                <s-checkbox
                  key={l.code}
                  label={l.label}
                  name={`lang_${l.code}`}
                  value="on"
                  checked={loc.enabledLocales.includes(l.code)}
                />
              ))}
            </s-stack>
            <s-text-field
              label="Other languages"
              name="lang_custom"
              value={loc.enabledLocales
                .filter((c) => !COMMON_LOCALES.some((l) => l.code === c))
                .join(", ")}
              placeholder="pt-pt, sv, da"
              details="Any code works, e.g. de, pt-BR, zh-Hant. Extras beyond your plan limit are dropped on save."
            />
            <s-select label="Default (fallback) language" name="default_locale" value={loc.defaultLocale}>
              {[...new Set([loc.defaultLocale, ...liveLocales, "en"])].map((c) => (
                <s-option key={c} value={c}>{languageName(c)}</s-option>
              ))}
            </s-select>
          </s-stack>
        </s-section>

        <s-section heading="Translations">
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

              {announcement ? (
                <s-box padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="small">
                    <s-text type="strong">Announcement</s-text>
                    <s-text color="subdued">
                      Your default: “{annMessage || "(not set — write it on Toasts)"}”
                    </s-text>
                    <s-stack direction="inline" gap="base">
                      {editLocales.map((lc) => (
                        <s-text-field
                          key={lc}
                          label={languageName(lc)}
                          name={`announcement_msg_${lc}`}
                          value={annMessages?.[lc] ?? ""}
                          placeholder={annMessage || undefined}
                        />
                      ))}
                    </s-stack>
                  </s-stack>
                </s-box>
              ) : null}
            </s-stack>
          )}
        </s-section>
      </Form>
    </s-page>
  );
}
