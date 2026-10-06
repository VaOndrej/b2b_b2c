// The admin preview imports the storefront CSS / locales with Vite `?raw`: node needs the hook first.
import "./support/raw-import.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { TierSetView } from "../../app/components/model/types.ts";

// The faithful preview of the quantity-tier block (MVP 3, doctrine A1/A4, C5):
// the storefront's own markup (K8), CSS (confined to the preview) and texts
// (the extension's locales — so the admin never words the block differently
// from the storefront), on the live theme's tokens.

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LOCALES = path.join(APP, "extensions/won-discounts-storefront/locales");

const SET: TierSetView = {
  id: "global",
  scope: { kind: "global" },
  countAcross: "line",
  breaks: [
    { minQty: 3, kind: "percent", percent: 10, amount: {} },
    { minQty: 5, kind: "percent", percent: 12.5, amount: {} },
  ],
};

async function preview(props: Record<string, unknown>, locale: "cs" | "en" = "cs"): Promise<string> {
  const { TiersPreview } = await import("../../app/components/tiers/TiersPreview.tsx");
  const { LocaleProvider } = await import("../../app/i18n/context.tsx");
  const providerProps = { locale } as ComponentProps<typeof LocaleProvider>;
  return renderToStaticMarkup(createElement(LocaleProvider, providerProps, createElement(TiersPreview, props as never)));
}

test("every storefront text the preview uses exists in each extension locale (cs, sk, en) — the preview never invents copy", async () => {
  const { STOREFRONT_TEXT_KEYS } = await import("../../app/components/tiers/TiersPreview.tsx");
  for (const file of ["cs.json", "sk.json", "en.default.json"]) {
    const tiers = (JSON.parse(readFileSync(path.join(LOCALES, file), "utf8")) as { tiers?: Record<string, string> }).tiers ?? {};
    for (const key of STOREFRONT_TEXT_KEYS) assert.equal(typeof tiers[key], "string", `${file}: tiers.${key}`);
  }
});

test("K8 markup with the storefront's texts, the shop's money format, the theme tokens and the block's accent", async () => {
  const html = await preview({
    set: SET,
    preset: "chips",
    tokens: { themeName: "Dawn", fontBody: "Assistant", fontHeading: null, colorText: "#121212", colorBackground: "#fafafa", colorAccent: "#c0392b", radius: 6, fontSize: 16 },
    product: { productId: "gid://shopify/Product/1", title: "Mikina", unitPrice: 1000_00, currency: "CZK", url: null, moneyFormat: "{{amount_with_comma_separator}} Kč" },
    quantity: 5,
  });
  assert.match(html, /<div class="won-tiers won-tiers--chips" data-won-discounts-tiers="" data-state="ready" data-set-id="global" data-count-mode="line" data-preset="chips" style="--won-tiers-accent:#c0392b">/);
  assert.match(html, /<p class="won-tiers__heading">Množstevní sleva<\/p>/);
  assert.match(html, /<li class="won-tiers__row" data-won-discounts-tier-row="" data-min="3" data-active="false">/);
  assert.match(html, /data-min="5" data-active="true"/);
  assert.match(html, /−12,5\u00a0%/, "one decimal, a decimal comma (cs)");
  assert.match(html, /875,00 Kč\/ks/);
  assert.match(html, /data-unit-cents="87500"/);
  assert.match(html, /5\u00a0ks za 4\.375,00 Kč \(875,00 Kč\/ks\)/);
  assert.match(html, /<p class="won-tiers__next" data-won-discounts-tier-next="" hidden="">/, "no next tier at the top");
  // The theme page around it: font, colors, the input radius variables the block CSS reads.
  assert.match(html, /font-family:&quot;Assistant&quot;/);
  assert.match(html, /background:#fafafa/);
  assert.match(html, /--style-border-radius-inputs:6px;--inputs-radius:6px/);
  assert.doesNotMatch(html, /Barvy a písmo z tématu|jen pokud ho/, "a theme that was read needs no sentence");
});

test("no set yet → the labelled example; English admin → the English storefront texts; no theme → said", async () => {
  const html = await preview({ set: null, preset: "default", tokens: null, product: null, currency: "EUR" }, "en");
  assert.match(html, /Example: you have no tiers yet\./);
  assert.match(html, /Quantity discount/);
  assert.match(html, /From 3 items/);
  assert.match(html, /−10%/);
  assert.match(html, /The theme could not be read/);
  assert.match(html, /Sample product/);
  assert.doesNotMatch(html, /\{(min|pct|price|qty|total|count)\}/, "every placeholder filled");
});

test("a set with nothing offered in the currency (MKT-1) renders the block empty and hidden, and says why", async () => {
  const html = await preview({
    set: { ...SET, breaks: [{ minQty: 2, kind: "amount", percent: null, amount: { EUR: 100 } }] },
    preset: "default",
    tokens: null,
    product: { productId: "p", title: "", unitPrice: 5000, currency: "CZK", url: null },
  });
  assert.match(html, /data-state="empty"[^>]*hidden=""/);
  assert.match(html, /V CZK se tyhle úrovně nenabízejí\./);
  assert.match(html, /Produkt bez názvu/, "never an id for an untitled product");
});

test("the look switcher is a labelled radio group: with a field name it is submitted with the page's form (the look is saved), without one nothing in the preview posts", async () => {
  const plain = await preview({ set: SET, preset: "default", tokens: null, product: null, controls: true });
  assert.match(plain, /Vzhled na webu/, "a visible label, not aria-only");
  assert.equal((plain.match(/<input type="radio"/g) ?? []).length, 4);
  assert.doesNotMatch(plain, /<input[^>]* name=/, "no field name: nothing is submitted");
  assert.equal((plain.match(/<button type="button"/g) ?? []).length, 2, "− and +");
  const saved = await preview({ set: SET, preset: "chips", tokens: null, product: null, controls: true, lookField: "preset" });
  assert.equal((saved.match(/<input type="radio" name="preset"/g) ?? []).length, 4);
  assert.match(saved, /<input type="radio" name="preset"[^>]* checked=""[^>]* value="chips"|<input type="radio" name="preset" value="chips"[^>]* checked=""/, "starts on the stored look");
  assert.match(saved, /class="won-tiers won-tiers--chips"/);
});

test("the preview renders what the config adds: the Pro custom look confined to the preview, and the merchant's storefront texts", async () => {
  const { customLookCss } = await import("@won/core/discounts/custom-look");
  const customCss = customLookCss({ vars: { accent: "#0a7d4f", radius: 4 }, css: ".won-tiers__heading { text-transform: uppercase; }" });
  const html = await preview({
    set: SET,
    preset: "default",
    tokens: null,
    product: null,
    extras: { customCss, texts: { cs: { "tiers.heading": "Kup víc, plať míň", "tiers.row_qty": "Od {min} kusů", "tiers.next": "" } } },
  });
  const style = /<style data-won-custom-look="">([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
  assert.match(style, /^\.won-tiers-preview \{/, "nested under the preview scope: never a style for the admin");
  assert.match(style, /--won-tiers-accent:#0a7d4f;--won-tiers-radius:4px/);
  assert.match(style, /\.won-tiers__heading\s*\{\s*text-transform: uppercase/);
  assert.match(html, /<p class="won-tiers__heading">Kup víc, plať míň<\/p>/);
  assert.match(html, /Od 3 kusů/, "the merchant's text with the block's own placeholder filled");
  assert.match(html, /Ještě 2\u00a0ks a zaplatíte/, "an empty text = the extension's own");
  // Another language's texts are not the admin language's.
  const en = await preview({ set: SET, preset: "default", tokens: null, product: null, extras: { customCss: null, texts: { cs: { "tiers.heading": "Kup víc" } } } }, "en");
  assert.match(en, /Quantity discount/);
  assert.doesNotMatch(en, /data-won-custom-look/);
});

test("'Celý košík' on Free: the note says what the plan does instead only where the stored set counts the whole cart (review fix 6)", async () => {
  const { TierSetEditor } = await import("../../app/components/tiers/TierSetEditor.tsx");
  const { LocaleProvider } = await import("../../app/i18n/context.tsx");
  const render = (countAcross: "line" | "product" | "cart", pro: boolean) =>
    renderToStaticMarkup(
      createElement(
        LocaleProvider,
        { locale: "cs" } as ComponentProps<typeof LocaleProvider>,
        createElement(TierSetEditor, {
          set: { ...SET, countAcross },
          currencies: [{ code: "CZK", markets: [] }],
          kept: [],
          pro,
          live: () => null,
          errorFor: () => undefined,
        }),
      ),
    );
  assert.match(render("cart", false), /Na Free se místo celého košíku počítá po produktech\./);
  assert.doesNotMatch(render("product", false), /Na Free se místo celého košíku/);
  assert.doesNotMatch(render("cart", true), /Na Free se místo celého košíku/);
  // The Pro option stays visible and marked (§16a), not pickable on Free unless stored.
  assert.match(render("product", false), /Pro · odemknout/);
  assert.match(render("product", false), /disabled=""[^>]*value="cart"/);
  assert.doesNotMatch(render("cart", false), /disabled=""[^>]*value="cart"/);
});

test("the look cards: each radio is named by its look only and described by its detail (review fix 12)", async () => {
  const { AppearanceScreen } = await import("../../app/components/screens/AppearanceScreen.tsx");
  const { LocaleProvider } = await import("../../app/i18n/context.tsx");
  const { createStaticHandler, createStaticRouter, StaticRouterProvider } = await import("react-router");
  const { renderToString } = await import("react-dom/server");
  const element = createElement(
    LocaleProvider,
    { locale: "cs" } as ComponentProps<typeof LocaleProvider>,
    createElement(AppearanceScreen, {
      plan: "free",
      configVersion: null,
      preset: "chips",
      tokens: null,
      sample: null,
      product: null,
      block: { state: "no_scope" },
      embed: { state: "on", activateUrl: null },
      cardPrices: false,
      custom: { accent: "", line: "", tint: "", radius: "", css: "" },
      customIssue: null,
      texts: [],
      cardBlockUrl: null,
      aiPrompt: "",
    }),
  );
  const handler = createStaticHandler([{ path: "/", Component: () => element }]);
  const context = await handler.query(new Request("http://localhost/"));
  if (context instanceof Response) throw new Error("render");
  const html = renderToString(createElement(StaticRouterProvider, { router: createStaticRouter(handler.dataRoutes, context), context }));
  const radios = [...html.matchAll(/<input type="radio"[^>]*>/g)].map((m) => m[0]);
  assert.equal(radios.length, 4);
  for (const radio of radios) {
    const labelledby = /aria-labelledby="([^"]+)"/.exec(radio)?.[1];
    const describedby = /aria-describedby="([^"]+)"/.exec(radio)?.[1];
    assert.ok(labelledby && describedby, radio);
    const name = new RegExp(`id="${labelledby}"[^>]*>([^<]+)<`).exec(html)?.[1];
    assert.ok(name && ["Tabulka", "Zvýrazněná úroveň", "Štítky", "Dlaždice"].includes(name), `the name is the look's: ${name}`);
  }
  assert.match(html, /aria-hidden="true"[^>]*><div/, "the preview is decoration for the radio");
});
