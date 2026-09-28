import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createElement, type ReactElement, type ReactNode } from "react";

import { adminLocale } from "../../app/lib/integration/locale.server.ts";
import { clearDetectionCache } from "../../app/lib/integration/native.server.ts";
import { overviewPage } from "../../app/lib/integration/pages.server.ts";
import { OverviewScreen } from "../../app/components/screens/OverviewScreen.tsx";
import { LocaleProvider } from "../../app/i18n/context.tsx";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";
import { otherNode } from "../lib/native/fake-shopify.ts";
import { FakeStore, renderPage, testCtx, text } from "./helpers.ts";

// Fix round 1, item 3: the admin language on the server comes from the request
// (`?locale=` of the document load) or the SESSION — never from process memory —
// so a fresh server (a restart, another instance) renders an English admin in
// English on its very first client-side fetch.

let db: TestDatabase;
before(() => {
  db = createTestDatabase("int-locale");
});
after(async () => {
  await db.drop();
});

const SHOP = "locale.myshopify.com";
const fetchWithoutLocale = () => new Request(`https://app.test/app.data?_routes=routes%2Fapp._index`);

test("an online session carries the staff user's language", async () => {
  const session = { id: "online-1", shop: SHOP, onlineAccessInfo: { associated_user: { locale: "en-GB" } } };
  assert.equal(await adminLocale(fetchWithoutLocale(), session, db.prisma), "en");
});

test("offline session: the document load's ?locale= is kept ON THE SESSION row; a fresh server's fetch reads it back", async () => {
  await db.prisma.session.create({ data: { id: `offline_${SHOP}`, shop: SHOP, state: "", accessToken: "x" } });
  const session = { id: `offline_${SHOP}`, shop: SHOP };
  assert.equal(await adminLocale(new Request("https://app.test/app?embedded=1&locale=en"), session, db.prisma), "en");

  // "Fresh server": nothing in memory — a module copy with its own state reads the same answer from the DB.
  const fresh = (await import(new URL("../../app/lib/integration/locale.server.ts?fresh=1", import.meta.url).href)) as typeof import("../../app/lib/integration/locale.server.ts");
  assert.equal(await fresh.adminLocale(fetchWithoutLocale(), session, db.prisma), "en");

  // The session library re-storing the offline session (token refresh writes its own columns) keeps it.
  await db.prisma.session.update({ where: { id: session.id }, data: { accessToken: "refreshed", locale: null } });
  assert.equal(await fresh.adminLocale(fetchWithoutLocale(), session, db.prisma), "en");

  // A Czech document load switches it back; no session at all → Czech (default).
  assert.equal(await fresh.adminLocale(new Request("https://app.test/app?locale=cs-CZ"), session, db.prisma), "cs");
  assert.equal(await fresh.adminLocale(fetchWithoutLocale(), session, db.prisma), "cs");
  assert.equal(await fresh.adminLocale(fetchWithoutLocale(), { id: "missing", shop: SHOP }, db.prisma), "cs");
});

test("…and the page is English: Přehled's server-worded sentences (native discounts) follow that language", async () => {
  clearDetectionCache();
  await db.prisma.session.upsert({
    where: { id: `offline_${SHOP}` },
    create: { id: `offline_${SHOP}`, shop: SHOP, state: "", accessToken: "x", adminLocale: "en" },
    update: { adminLocale: "en" },
  });
  const locale = await adminLocale(fetchWithoutLocale(), { id: `offline_${SHOP}`, shop: SHOP }, db.prisma);
  const store = new FakeStore();
  store.native.add(otherNode("DiscountAutomaticBxgy", { title: "Buy 2 get 1" }));
  const props = await overviewPage(testCtx(db.prisma, SHOP, store, { locale }), { scopes: "write_discounts,read_themes" });
  // The embedded layout (routes/app.tsx) puts the language in a LocaleProvider around the page.
  const Provider = LocaleProvider as unknown as (props: { locale: typeof locale; children?: ReactNode }) => ReactElement;
  const html = text(await renderPage(createElement(Provider, { locale }, createElement(OverviewScreen, props))));
  assert.match(html, /Discounts outside Won/);
  assert.doesNotMatch(html, /nepřenáší/, "no Czech detector sentence on an English page");
});
