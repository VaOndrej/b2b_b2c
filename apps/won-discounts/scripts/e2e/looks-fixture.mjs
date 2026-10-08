// The looks and texts E2E fixture (úkol 8: Překlady, vzhled u modulů), shared by the seed
// (scripts/e2e/seed-mvp1.mjs --texts / --looks <element>=<look>[+blink],…) and the spec
// (tests/e2e/storefront.looks.spec.ts). Both flags ADD to a profile's seed, so the elements have something to show:
//   --texts   the merchant's own texts in Czech (the shop's default language) for every element a customer sees,
//             and ONE in Slovak; English has none. A page in Czech shows the Czech ones, a Slovak page its one
//             and otherwise the extension's Slovak, an English page the extension's English.
//             With a tier set in the profile, prices on product cards are switched on (the card line has a text too).
//   --looks   storefront.looks.<element>: the ready-made look, the green highlight colour, on Milníky the flash.
//   --old-look  the storefront settings in the shape of BEFORE the split (7 Oct 2026): one highlight colour and one
//             custom look for every block, no `looks`. Saving it converts it; the spec then compares the page with
//             the stylesheet the old code made of the same settings (OLD_ROOT).
// Every changed text starts with MARK, so a test tells it from the extension's own at a glance.

export const MARK = "E2E";

export const LOOK_TEXTS = {
  cs: {
    "tiers.heading": `${MARK} množstevní sleva`,
    "tiers.row_qty": `${MARK} od {min} ks`,
    "cards.pct": `${MARK} od {min} ks −{pct} %`,
    "cart.ms_left": `${MARK} ještě {amount} a máte: {reward}`,
    "cart.ms_done": `${MARK} máte všechno.`,
    "cart.ms_from": `${MARK} od {amount}`,
    "cart.ms_ship": `${MARK} doprava zdarma`,
    "cart.ms_gift": `${MARK} dárek`,
    "cart.ms_gift_named": `${MARK} dárek: {name}`,
    "cart.ms_disc": `${MARK} sleva {value}`,
    "cart.code_label": `${MARK} slevový kód`,
    "cart.gift_done": `${MARK} dárek je v košíku.`,
    "outlet.badge": `${MARK} výprodej`,
    "campaign.ends": `${MARK} končí za {time}`,
  },
  sk: { "tiers.heading": `${MARK} množstevná zľava`, "cart.ms_ship": `${MARK} doprava zadarmo` },
};

/** Elements and their ready-made looks (core looks.ts LOOK_PRESETS without the default of each). */
export const LOOK_CHOICES = { milestones: ["checklist", "sentence"], outlet: ["countdown", "strip"], campaign: ["strip", "card"] };

/** The highlight colour every seeded look carries, and what getComputedStyle reports for it (core ACCENT_COLORS.green). */
export const LOOK_ACCENT = "green";
export const LOOK_ACCENT_RGB = "rgb(26, 127, 69)";

/** What a shop had stored before the split: a ready-made colour and (Pro) a custom look with rules for the table. */
export const OLD_LOOK = {
  accent: "green",
  custom: { vars: { accent: "#0a7d4f", tint: "#f2fbf6", radius: 4 }, css: '.won-tiers__heading { text-transform: uppercase; }\n.won-tiers__row[data-active="true"] { font-weight: 700 }' },
};
/** The root every block shared before the split (core custom-look.ts WON_BLOCK_ROOT at dd48a75). */
export const OLD_ROOT = ":is(.won-tiers,.won-cart,.won-cart-slot,.won-outlet,.won-progress,.won-campaign,.won-topbar)";

/** storefront settings as stored before the split: the old fields, and no `looks` at all. */
export function oldLookStorefront(storefront) {
  const next = { ...storefront, accent: OLD_LOOK.accent, custom: structuredClone(OLD_LOOK.custom) };
  delete next.looks;
  return next;
}

/**
 * `milestones=checklist+blink,outlet=strip` → { milestones: { preset, blink }, outlet: { preset } }; throws on anything unknown.
 * @param {string | undefined} text
 * @returns {Record<string, { preset: string; blink?: boolean }>}
 */
export function parseLooks(text) {
  /** @type {Record<string, { preset: string; blink?: boolean }>} */
  const out = {};
  for (const part of String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [element, rest = ""] = part.split("=");
    const [preset, ...flags] = rest.split("+");
    if (!Object.hasOwn(LOOK_CHOICES, element) || !LOOK_CHOICES[element].includes(preset)) throw new Error(`unknown look ${part} (${Object.entries(LOOK_CHOICES).map(([e, p]) => `${e}=${p.join("|")}`).join(", ")})`);
    if (flags.some((f) => f !== "blink") || (flags.length > 0 && element !== "milestones")) throw new Error(`unknown look option in ${part} (only milestones=<look>+blink)`);
    out[element] = { preset, ...(flags.includes("blink") ? { blink: true } : {}) };
  }
  return out;
}

/** storefront settings of the seed config with the looks (and, with texts and a tier set, card prices on). */
export function looksStorefront(storefront, { looks, texts, hasTiers }) {
  const next = { ...storefront };
  if (Object.keys(looks).length > 0) {
    next.looks = Object.fromEntries(Object.entries(looks).map(([element, look]) => [element, { preset: look.preset, accent: LOOK_ACCENT, ...(look.blink ? { blink: true } : {}) }]));
  }
  if (texts) {
    next.languages = Object.keys(LOOK_TEXTS);
    if (hasTiers) next.cardPricesEnabled = true;
  }
  return next;
}
