#!/usr/bin/env node
// Jednorázová příprava dev storu pro Won Discounts (2026-09-28, go od Ondřeje).
//
//   node tmp/won-discounts-setup/setup-devstore.mjs            # dry-run (výchozí)
//   node tmp/won-discounts-setup/setup-devstore.mjs --live     # provede změny
//
// Co dělá:
//   1. Záloha stavu → tmp/won-discounts-setup/backup-<timestamp>.json
//   2. Vypne cizí automatickou slevu `Test_Code_discount` (SMART Functions).
//   3. Publikuje jazyk sk.
//   4. Přidá 1 pevnou cenu do ceníku trhu `česko` (won-e2e-spare → 199 CZK),
//      aby šel testovat výprodej per trh.
//
// Undo: discountAutomaticActivate(id), shopLocaleUpdate(sk, published:false),
//       priceListFixedPricesDelete(priceListId, [variantId]).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const STORE = "b2b-b2c-store-development.myshopify.com";
const API = `https://${STORE}/admin/api/2026-07/graphql.json`;
const LIVE = process.argv.includes("--live");

const DISCOUNT_ID = "gid://shopify/DiscountAutomaticNode/2179405644017";
const DISCOUNT_TITLE = "Test_Code_discount";
const FIXED_PRICE_HANDLE = "won-e2e-spare";
const FIXED_PRICE_CZK = "199.00";

const token = readFileSync(join(REPO, "shpat.md"), "utf8").match(/shpat_[A-Za-z0-9]+/)?.[0];
if (!token) throw new Error("Token v shpat.md nenalezen");

async function gql(query, variables = {}) {
  const res = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

function userErrors(payload, name) {
  const errs = payload?.[name]?.userErrors ?? [];
  if (errs.length) throw new Error(`${name}: ${JSON.stringify(errs)}`);
}

const state = await gql(`{
  discountNode(id: "${DISCOUNT_ID}") {
    id
    discount { ... on DiscountAutomaticApp { title status startsAt endsAt appDiscountType { title app { title } } } }
  }
  shopLocales { locale primary published }
  catalogs(first: 20, type: MARKET) { nodes { title priceList { id currency fixedPricesCount } } }
  products(first: 1, query: "handle:${FIXED_PRICE_HANDLE}") {
    nodes { handle variants(first: 1) { nodes { id price } } }
  }
}`);

const backupPath = join(HERE, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(backupPath, JSON.stringify(state, null, 2));
console.log(`Záloha: ${backupPath}\n`);

const discount = state.discountNode?.discount;
const sk = state.shopLocales.find((l) => l.locale === "sk");
const czPriceList = state.catalogs.nodes.find((c) => c.priceList?.currency === "CZK")?.priceList;
const variant = state.products.nodes[0]?.variants.nodes[0];

const plan = [];
if (discount?.title === DISCOUNT_TITLE && discount.status === "ACTIVE") {
  plan.push({ what: `Vypnout slevu „${discount.title}“ (${discount.appDiscountType?.app?.title})`, run: async () => {
    const d = await gql(`mutation($id: ID!) { discountAutomaticDeactivate(id: $id) { automaticDiscountNode { id } userErrors { field message } } }`, { id: DISCOUNT_ID });
    userErrors(d, "discountAutomaticDeactivate");
  } });
} else {
  console.log(`Sleva: přeskakuji (stav: ${discount?.status ?? "nenalezena"}, název: ${discount?.title ?? "—"})`);
}

if (sk && !sk.published) {
  plan.push({ what: "Publikovat jazyk sk", run: async () => {
    const d = await gql(`mutation { shopLocaleUpdate(locale: "sk", shopLocale: { published: true }) { shopLocale { locale published } userErrors { field message } } }`);
    userErrors(d, "shopLocaleUpdate");
  } });
} else {
  console.log(`Jazyk sk: přeskakuji (${sk ? "už publikovaný" : "není přidaný"})`);
}

if (czPriceList && variant) {
  plan.push({ what: `Pevná cena ${FIXED_PRICE_HANDLE} (${variant.id}) = ${FIXED_PRICE_CZK} CZK v ceníku ${czPriceList.id} (dnes ${czPriceList.fixedPricesCount} pevných cen)`, run: async () => {
    const d = await gql(
      `mutation($id: ID!, $prices: [PriceListPriceInput!]!) { priceListFixedPricesAdd(priceListId: $id, prices: $prices) { prices { variant { id } price { amount currencyCode } } userErrors { field message } } }`,
      { id: czPriceList.id, prices: [{ variantId: variant.id, price: { amount: FIXED_PRICE_CZK, currencyCode: "CZK" } }] },
    );
    userErrors(d, "priceListFixedPricesAdd");
  } });
} else {
  console.log(`Pevná cena: přeskakuji (ceník CZK: ${czPriceList ? "ano" : "ne"}, varianta: ${variant ? "ano" : "ne"})`);
}

console.log(`\n${LIVE ? "PROVÁDÍM" : "DRY-RUN — nic se nemění"}:`);
for (const step of plan) {
  console.log(`- ${step.what}`);
  if (LIVE) {
    await step.run();
    console.log("  ✓ hotovo");
  }
}
if (!plan.length) console.log("- nic k provedení");
