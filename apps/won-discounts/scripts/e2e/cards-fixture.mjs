// The MVP 7 E2E fixture (prices by quantity on product cards BETA + the Pro custom look), shared by the seed
// (scripts/e2e/seed-mvp1.mjs --profile cards) and the spec (tests/e2e/storefront.cards.spec.ts):
//   global tier set "e2e-cards-global", counted per line: from 2 items −10 %
//   storefront: card prices ON; the table's custom look (accent #0a7d4f + a CSS rule) — applied on Pro only (BILL-1).
// No rule, no margin protection: the card may say the first break, and the cart gives exactly it.

export const CARDS_HANDLES = ["won-e2e-simple-a"];
export const CARDS_SET_ID = "e2e-cards-global";
export const CARDS_MIN_QTY = 2;
export const CARDS_PERCENT = 10;
export const CARDS_ACCENT = "#0a7d4f";
/** rgb() of CARDS_ACCENT, as getComputedStyle reports a colour. */
export const CARDS_ACCENT_RGB = "rgb(10, 125, 79)";

/** modules.tiers of the seed config. */
export function cardsTiersModule() {
  return { sets: [{ id: CARDS_SET_ID, scope: "global", countAcross: "line", breaks: [{ minQty: CARDS_MIN_QTY, percent: CARDS_PERCENT }] }] };
}

/** storefront settings of the seed config: cards on + a custom look (the gate drops the look on Free). */
export function cardsStorefront(storefront) {
  return {
    ...storefront,
    cardPricesEnabled: true,
    looks: { ...storefront.looks, tiers: { ...storefront.looks?.tiers, custom: { vars: { accent: CARDS_ACCENT }, css: ".won-tiers__heading { letter-spacing: 0.05em; }" } } },
  };
}
