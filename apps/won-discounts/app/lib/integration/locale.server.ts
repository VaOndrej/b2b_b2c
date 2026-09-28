// The admin language on the server (A10), from the request or the SESSION —
// never from process memory, so a restarted server or a second instance
// renders an English admin in English on its very first fetch.
//
// Most admin copy is worded in the browser, but the native-discount sentences
// (app/lib/native/copy.ts) are worded on the server, so loaders need the
// language too. Sources, first that answers:
//   1. `?locale=` of the request — Shopify adds it to the embedded DOCUMENT
//      load; it is kept on the session row (Session.adminLocale, a column the
//      session library never writes, so a token refresh keeps it);
//   2. an online session's staff user locale (Shopify's associated_user);
//   3. Session.adminLocale of this session (client-side fetches carry no
//      `?locale=`, and an offline session has no user locale);
//   4. Czech (the default).
// An offline session is shared by the shop's staff: the language of the last
// document load wins for fetches until the next one.

import type { PrismaClient } from "../../generated/prisma/client";
import { DEFAULT_LOCALE, resolveLocale, type Locale } from "../../i18n";

/** The part of the authenticated session read here. */
export interface SessionLike {
  id: string;
  shop: string;
  onlineAccessInfo?: { associated_user?: { locale?: string | null } | null } | null;
}

export async function adminLocale(request: Request, session: SessionLike, db: Pick<PrismaClient, "session">): Promise<Locale> {
  const raw = new URL(request.url).searchParams.get("locale");
  if (raw) {
    const locale = resolveLocale(raw);
    try {
      await db.session.updateMany({ where: { id: session.id }, data: { adminLocale: locale } });
    } catch {
      // Remembering is a convenience: the page still renders in `locale`.
    }
    return locale;
  }
  const user = session.onlineAccessInfo?.associated_user?.locale;
  if (typeof user === "string" && user) return resolveLocale(user);
  try {
    const row = await db.session.findUnique({ where: { id: session.id }, select: { adminLocale: true } });
    if (row?.adminLocale) return resolveLocale(row.adminLocale);
  } catch {
    // An unreadable session row never breaks a page: default language.
  }
  return DEFAULT_LOCALE;
}

/** A locale the page itself sent (hidden `locale` field of an action form), else the request's. */
export function formLocale(form: { get(name: string): unknown }, fallback: Locale): Locale {
  const raw = form.get("locale");
  return typeof raw === "string" && raw ? resolveLocale(raw) : fallback;
}
