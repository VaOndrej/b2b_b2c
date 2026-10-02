import assert from "node:assert/strict";
import { test } from "node:test";

import { readTryCartForm, TRY_CART_LIMITS } from "../../app/components/model/try-cart-form.ts";

// SEC-1 for "Vyzkoušet košík": the server reads only variant ids, quantities, a
// known currency, codes and a day. Prices are never taken from the browser (the
// engine step reads them from Shopify).

function form(entries: [string, string][]): FormData {
  const fd = new FormData();
  for (const [k, v] of entries) fd.append(k, v);
  return fd;
}
const CTX = { currencies: ["CZK", "EUR"], today: "2026-09-28" };

test("a valid simulated cart", () => {
  const { input, errors } = readTryCartForm(
    form([
      ["variantId", "gid://shopify/ProductVariant/11"],
      ["productId", "gid://shopify/Product/1"],
      ["quantity", "2"],
      ["variantId", "gid://shopify/ProductVariant/12"],
      ["productId", "gid://shopify/Product/2"],
      ["quantity", "1"],
      ["currency", "EUR"],
      ["codes", " vip10, leto ,VIP10"],
      ["date", "2026-11-27"],
      ["unitPrice", "1"],
    ]),
    CTX,
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(input, {
    lines: [
      { variantId: "gid://shopify/ProductVariant/11", productId: "gid://shopify/Product/1", quantity: 2 },
      { variantId: "gid://shopify/ProductVariant/12", productId: "gid://shopify/Product/2", quantity: 1 },
    ],
    currency: "EUR",
    market: null,
    codes: ["VIP10", "LETO"],
    date: "2026-11-27",
    time: null,
  });
});

test("market choice: `CZK:cz` names an enabled Won market of that currency, anything else is refused", () => {
  const ctx = { ...CTX, markets: [{ handle: "cz", currency: "CZK" }, { handle: "sk", currency: "EUR" }] };
  const line: [string, string][] = [
    ["variantId", "gid://shopify/ProductVariant/11"],
    ["productId", "gid://shopify/Product/1"],
    ["quantity", "1"],
  ];
  const ok = readTryCartForm(form([...line, ["currency", "CZK:cz"]]), ctx);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.input.currency, "CZK");
  assert.equal(ok.input.market, "cz");
  for (const bad of ["CZK:sk", "CZK:hu", "EUR:cz:x", "HUF:hu"]) {
    const res = readTryCartForm(form([...line, ["currency", bad]]), ctx);
    assert.deepEqual(res.errors.map((e) => e.field), ["currency"], bad);
    assert.equal(res.input.market, null, bad);
  }
});

test("junk is refused: foreign ids, zero quantities, an unknown currency, a bad date", () => {
  const { input, errors } = readTryCartForm(
    form([
      ["variantId", "javascript:alert(1)"],
      ["productId", "gid://shopify/Product/1"],
      ["quantity", "1"],
      ["variantId", "gid://shopify/ProductVariant/12"],
      ["productId", "gid://shopify/Product/2"],
      ["quantity", "0"],
      ["currency", "USD"],
      ["date", "2026-02-30"],
    ]),
    CTX,
  );
  assert.deepEqual(input.lines, []);
  assert.deepEqual(
    errors.map((e) => `${e.field}:${e.key}`),
    ["lines:tryCart.error.lines", "currency:tryCart.error.currency", "date:tryCart.error.date"],
  );
});

test("bounded: quantities are capped, lines and codes are limited, an empty date means today", () => {
  const entries: [string, string][] = [];
  for (let i = 0; i < TRY_CART_LIMITS.lines + 5; i++) {
    entries.push(["variantId", `gid://shopify/ProductVariant/${i + 1}`], ["productId", "gid://shopify/Product/1"], ["quantity", "5000"]);
  }
  entries.push(["currency", "CZK"], ["codes", Array.from({ length: 30 }, (_, i) => `C${i}`).join(",")]);
  const { input, errors } = readTryCartForm(form(entries), CTX);
  assert.deepEqual(errors, []);
  assert.equal(input.lines.length, TRY_CART_LIMITS.lines);
  assert.equal(input.lines[0].quantity, TRY_CART_LIMITS.quantity);
  assert.equal(input.codes.length, TRY_CART_LIMITS.codes);
  assert.equal(input.date, "2026-09-28");
});

test("MVP 6: a time of day HH:MM (a campaign's window); empty = now, anything else is refused on the field", () => {
  const base: [string, string][] = [
    ["variantId", "gid://shopify/ProductVariant/11"],
    ["productId", "gid://shopify/Product/1"],
    ["quantity", "1"],
    ["currency", "CZK"],
  ];
  assert.equal(readTryCartForm(form([...base, ["time", "09:30"]]), CTX).input.time, "09:30");
  assert.equal(readTryCartForm(form(base), CTX).input.time, null);
  for (const bad of ["9:30", "24:00", "12:60", "noon"]) {
    assert.deepEqual(readTryCartForm(form([...base, ["time", bad]]), CTX).errors, [{ field: "time", key: "tryCart.error.time" }], bad);
  }
});

test("MVP 6: a campaign's link (?date=&time=) opens the simulation at that moment; junk in the URL is ignored", async () => {
  const { buildTryCartProps } = await import("../../app/components/screens/TryCartScreen.tsx");
  const { DEFAULT_CONFIG } = await import("@won/core/discounts/config");
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const at = buildTryCartProps(config, { timezone: "Europe/Prague", date: "2026-11-27", time: "00:01" });
  assert.equal(at.date, "2026-11-27");
  assert.equal(at.time, "00:01");
  const junk = buildTryCartProps(config, { timezone: "Europe/Prague", date: "zítra", time: "25:00" });
  assert.equal(junk.date, undefined);
  assert.equal(junk.time, undefined);
});
