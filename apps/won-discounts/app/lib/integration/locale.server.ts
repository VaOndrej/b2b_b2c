// The admin language on the server (A10). Shopify passes it as `?locale=` on
// the document load of the embedded app only; in-app navigations (client-side
// loader fetches) drop it. Most admin copy is worded in the browser, but the
// native-discount sentences (app/lib/native/copy.ts) are worded on the server,
// so a loader needs the language too: the value seen on a document load is
// remembered per shop + staff user (session token `sub`) and reused for the
// fetches that follow. After a server restart, until the next document load,
// the default (Czech) applies.

import { DEFAULT_LOCALE, resolveLocale, type Locale } from "../../i18n";

const remembered = new Map<string, Locale>();
const MAX_REMEMBERED = 10_000;

function key(shop: string, user: string | null | undefined): string {
  return `${shop}|${user ?? ""}`;
}

export function requestLocale(request: Request, shop: string, user?: string | null): Locale {
  const raw = new URL(request.url).searchParams.get("locale");
  if (raw) {
    const locale = resolveLocale(raw);
    if (remembered.size >= MAX_REMEMBERED) remembered.delete(remembered.keys().next().value as string);
    remembered.set(key(shop, user), locale);
    remembered.set(key(shop, null), locale);
    return locale;
  }
  return remembered.get(key(shop, user)) ?? remembered.get(key(shop, null)) ?? DEFAULT_LOCALE;
}

/** A locale the page itself sent (hidden `locale` field of an action form), else the request's. */
export function formLocale(form: { get(name: string): unknown }, fallback: Locale): Locale {
  const raw = form.get("locale");
  return typeof raw === "string" && raw ? resolveLocale(raw) : fallback;
}

/** Test hook. */
export function forgetLocales(): void {
  remembered.clear();
}
