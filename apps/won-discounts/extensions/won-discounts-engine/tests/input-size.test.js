// Pins tests/input-size.js to what Shopify counts: runs logged by the dev store
// (apps/won-discounts/.shopify/logs; `payload.inputBytes` / `outputBytes`), and the
// encoding's length headers at their edges.

import { describe, expect, test } from "vitest";

import { inputLimit, messagePackBytes } from "./input-size.js";

/** A delivery run of the MVP 2 E2E (logged inputBytes 1894, outputBytes 13). */
const LOGGED_INPUT = {"triggeringDiscountCode":null,"enteredDiscountCodes":[{"code":"WONE2EM20"}],"discount":{"discountClasses":["PRODUCT","ORDER","SHIPPING"],"vars":{"jsonValue":{"role":"automatic","campaignId":null,"campaignStart":"1970-01-01T00:00:00","campaignEnd":"1970-01-01T00:00:00","varsVersion":null}}},"shop":{"config":{"jsonValue":{"schemaVersion":1,"campaignId":null,"campaignVarsVersion":null,"engine":{"combination":{"outletWithAnything":false,"productWithProduct":"best","productWithOrder":true,"productWithShipping":true,"orderWithShipping":true}},"marketCountries":{},"modules":{"codes":{"rules":[{"id":"e2e-margin-auto-50","enabled":true,"name":"E2E marže auto 50 %","method":"automatic","value":{"kind":"percentage","percent":50},"target":{"kind":"products"}},{"id":"e2e-margin-code-20","enabled":true,"name":"E2E marže kód 20 %","method":"code","value":{"kind":"percentage","percent":20},"target":{"kind":"order"},"codeHashes":["5f441098"]}]},"tiers":{"sets":[]},"rewards":{"gifts":[],"countOtherDiscounts":false},"margin":{"enabled":true,"min":25,"max":30,"cur":"USD","col":{"491958272241":[null,10]}}},"campaigns":[]}},"localTime":{"date":"2026-09-29","campaignActive":false}},"localization":{"country":{"isoCode":"CZ"},"language":{"isoCode":"CS"}},"presentmentCurrencyRate":"21.8802535","cart":{"cost":{"subtotalAmount":{"currencyCode":"CZK"}},"deliveryGroups":[{"id":"gid://shopify/CartDeliveryGroup/0"}],"lines":[{"id":"gid://shopify/CartLine/0","quantity":1,"cost":{"amountPerQuantity":{"amount":"219.0"}},"gift":null,"merchandise":{"__typename":"ProductVariant","id":"gid://shopify/ProductVariant/48468678902001","wonVariant":{"jsonValue":{"cost":6,"cur":"USD"}},"product":{"wonProduct":{"jsonValue":{"ruleIds":["e2e-margin-auto-50"],"variantRuleIds":{}}}}}},{"id":"gid://shopify/CartLine/1","quantity":1,"cost":{"amountPerQuantity":{"amount":"263.0"}},"gift":null,"merchandise":{"__typename":"ProductVariant","id":"gid://shopify/ProductVariant/48468678934769","wonVariant":null,"product":{"wonProduct":{"jsonValue":{"ruleIds":["e2e-margin-auto-50"],"variantRuleIds":{},"marginRefs":["491958272241"]}}}}},{"id":"gid://shopify/CartLine/2","quantity":1,"cost":{"amountPerQuantity":{"amount":"329.0"}},"gift":null,"merchandise":{"__typename":"ProductVariant","id":"gid://shopify/ProductVariant/48468678967537","wonVariant":{"jsonValue":{"cost":5,"cur":"USD"}},"product":{"wonProduct":null}}}]}};
/** A lines run of MVP 1's E2E (logged outputBytes 169). */
const LOGGED_OUTPUT = {"operations":[{"productDiscountsAdd":{"candidates":[{"message":"WON:SHOP|A|12%","targets":[{"cartLine":{"id":"gid://shopify/CartLine/0"}}],"value":{"percentage":{"value":12}}}],"selectionStrategy":"FIRST"}}]};

describe("messagePackBytes: the bytes Shopify counts against its input and output limits", () => {
  test("logged runs: inputBytes and outputBytes", () => {
    expect(messagePackBytes(LOGGED_INPUT)).toBe(1894);
    expect(new TextEncoder().encode(JSON.stringify(LOGGED_INPUT)).length).toBe(2401);
    expect(messagePackBytes({ operations: [] })).toBe(13);
    expect(messagePackBytes(LOGGED_OUTPUT)).toBe(169);
  });

  test("the length headers and number forms at their edges", () => {
    expect([0, 127, 128, -32, -33, 255, 256, 65535, 65536, 2 ** 32 - 1, 2 ** 32, 12.5, -0.5].map(messagePackBytes)).toEqual([1, 1, 2, 1, 2, 2, 3, 3, 5, 5, 9, 9, 9]);
    // Negative integers take the SIGNED forms: int 8 down to −128, int 16 to −32 768, int 32 to −2^31.
    expect([-128, -129, -256, -32768, -32769, -65536, -(2 ** 31), -(2 ** 31) - 1, -(2 ** 32)].map(messagePackBytes)).toEqual([2, 3, 3, 3, 5, 5, 5, 9, 9]);
    expect(["", "a".repeat(31), "a".repeat(32), "a".repeat(255), "a".repeat(256), "č"].map(messagePackBytes)).toEqual([1, 32, 34, 257, 259, 3]);
    expect(messagePackBytes(Array(15).fill(null))).toBe(16);
    expect(messagePackBytes(Array(16).fill(null))).toBe(19);
    expect(messagePackBytes(Object.fromEntries(Array.from({ length: 16 }, (_, k) => [String.fromCharCode(97 + k), true])))).toBe(3 + 16 * 3);
  });

  test("the input limit scales with the lines above 200", () => {
    expect([1, 200, 240, 500].map(inputLimit)).toEqual([128000, 128000, 153600, 320000]);
  });
});
