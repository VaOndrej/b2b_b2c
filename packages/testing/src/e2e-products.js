// Shared, app-agnostic E2E product catalog. These products are created ONCE in
// the dev store (via scripts/seed-e2e-products.mjs) and reused by every app's
// storefront tests. They are READ-ONLY fixtures: apps key their own DB state to
// these products' ids/handles but never mutate the products themselves, so one
// catalog serves all apps forever. Prefer enhancing an existing entry over
// adding a new one; only add a product when an existing shape cannot cover the
// case.
//
// `options: {}` variants use a map of { optionName: value }; the seed script
// turns them into Admin `productSet` optionValues.

export const WON_E2E_PRODUCTS = {
  // Single-variant baseline product.
  simpleA: {
    handle: "won-e2e-simple-a",
    title: "Won E2E — Simple A",
    options: [],
    variants: [{ price: "10.00" }],
  },
  // Second single-variant product (for roles that need a distinct product).
  simpleB: {
    handle: "won-e2e-simple-b",
    title: "Won E2E — Simple B",
    options: [],
    variants: [{ price: "12.00" }],
  },
  // Two variants on one axis — step / variant-morph coverage.
  twoVariants: {
    handle: "won-e2e-two-variants",
    title: "Won E2E — Two Variants",
    options: [{ name: "Size", values: ["Small", "Large"] }],
    variants: [
      { price: "15.00", options: { Size: "Small" } },
      { price: "18.00", options: { Size: "Large" } },
    ],
  },
  // Multi-axis variants (Size × Color = 4 variants) — e.g. variant-level
  // pricing/discount rules that need several axes.
  multiAxis: {
    handle: "won-e2e-multiaxis",
    title: "Won E2E — Multi Axis",
    options: [
      { name: "Size", values: ["S", "M"] },
      { name: "Color", values: ["Red", "Blue"] },
    ],
    variants: [
      { price: "20.00", options: { Size: "S", Color: "Red" } },
      { price: "20.00", options: { Size: "S", Color: "Blue" } },
      { price: "22.00", options: { Size: "M", Color: "Red" } },
      { price: "22.00", options: { Size: "M", Color: "Blue" } },
    ],
  },
  // Spare single-variant product held in reserve for future roles.
  spare: {
    handle: "won-e2e-spare",
    title: "Won E2E — Spare",
    options: [],
    variants: [{ price: "9.00" }],
  },
};

/** Every catalog entry as a list (seed order). */
export const WON_E2E_PRODUCT_LIST = Object.values(WON_E2E_PRODUCTS);
