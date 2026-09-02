/**
 * pack-catalog — the single source of truth for the demo packshots.
 *
 * Two tables that MUST agree lived in two files that could not see each other:
 * `render-packs.mjs` drew the art, `seed-store-images.mjs` decided which product
 * got which file. Nothing checked that the label PRINTED on a pack matched the
 * product it was pinned to, so "Pre-Workout Energy" shipped wearing the
 * Elektrolyty pack and "Denní Multivitamín" wore "D3 + K2".
 *
 * tests/smoke/won-packshot-labels.spec.ts reads both tables from here and fails
 * when a product is given art that prints somebody else's name.
 */

/**
 * One restrained family, keyed to the theme's brand token (--won-accent
 * #ff5a3c). `bg` is a very light tint of the pack colour so the card reads as a
 * deliberate set rather than as products photographed by four different people —
 * that inconsistency is what made the old placeholders look unfinished.
 *
 * `name` + `sub` are PRINTED ON THE PACK. They are not decoration: whatever is
 * written here is what the shopper reads on the product card.
 */
export const PACKS = {
  'won-pack-whey': { form: 'tub', name: 'Whey', sub: 'Čokoláda', body: '#8a5a3c', cap: '#5f3c27', dark: '#6d4630', accent: '#8a5a3c', bg: '#f6efe9' },
  'won-pack-creatine': { form: 'tub', name: 'Kreatin', sub: 'Monohydrát', body: '#2b323c', cap: '#171c23', dark: '#1e242c', accent: '#ff5a3c', bg: '#eceef1' },
  'won-pack-bcaa': { form: 'tub', name: 'BCAA', sub: 'Recovery', body: '#e8563a', cap: '#b8402a', dark: '#c2452d', accent: '#b8402a', bg: '#fdeee9' },
  'won-pack-vitamin': { form: 'tub', name: 'D3 + K2', sub: '90 kapslí', body: '#e0a52e', cap: '#b07f1c', dark: '#c08f22', accent: '#a8761a', bg: '#fdf5e4' },
  'won-pack-magnesium': { form: 'tub', name: 'Magnesium', sub: 'B6', body: '#5b6bb5', cap: '#3f4c8a', dark: '#4a5799', accent: '#4a5799', bg: '#eef0f9' },
  'won-pack-omega': { form: 'tub', name: 'Omega 3', sub: 'Rybí olej', body: '#3f7f74', cap: '#2b5c54', dark: '#33685f', accent: '#2b5c54', bg: '#eaf3f1' },
  'won-pack-electrolytes': { form: 'tub', name: 'Elektrolyty', sub: 'Hydratace', body: '#3d6d8f', cap: '#2a4f69', dark: '#325b78', accent: '#2a4f69', bg: '#eaf1f6' },
  'won-pack-greens': { form: 'pouch', name: 'Greens', sub: 'Detox', body: '#5f8f4a', cap: '#456b36', dark: '#4c7539', accent: '#456b36', bg: '#eff5ea' },
  // The box art is the protein bar multipack; the printed count must match the
  // product title, or the card sells 20 pieces and the buy box sells 12.
  'won-pack-sticks': { form: 'box', name: 'Tyčinka', sub: 'Protein · 12 ks', body: '#d8cdb8', cap: '#b3a68d', dark: '#b3a68d', accent: '#8a6f45', bg: '#f7f3ea' },

  // One pack per product. Reusing a neighbour's art means printing a neighbour's
  // name on the card — see tests/smoke/won-packshot-labels.spec.ts.
  'won-pack-whey-vanilla': { form: 'tub', name: 'Whey', sub: 'Vanilka', body: '#c9a86a', cap: '#a3854c', dark: '#b09258', accent: '#a3854c', bg: '#f9f3e6' },
  'won-pack-protein-blend': { form: 'tub', name: 'Protein Blend', sub: 'Výhodný set', body: '#7a6a5c', cap: '#57493e', dark: '#645446', accent: '#57493e', bg: '#f2eeea' },
  'won-pack-recovery': { form: 'tub', name: 'Recovery', sub: 'Amino', body: '#a1497f', cap: '#7c3660', dark: '#8c3f6e', accent: '#7c3660', bg: '#f9ebf3' },
  'won-pack-glutamine': { form: 'tub', name: 'Glutamin', sub: 'Regenerace', body: '#4f8f8a', cap: '#376b67', dark: '#3f7975', accent: '#376b67', bg: '#eaf4f3' },
  'won-pack-multivitamin': { form: 'tub', name: 'Multivitamín', sub: 'Denní dávka', body: '#e2762a', cap: '#b3591c', dark: '#c46522', accent: '#b3591c', bg: '#fdefe3' },
  'won-pack-zinc': { form: 'tub', name: 'Zinek + Selen', sub: 'Imunita', body: '#6e7d8c', cap: '#4e5b68', dark: '#5c6a77', accent: '#4e5b68', bg: '#eff2f5' },
  'won-pack-collagen': { form: 'tub', name: 'Kolagen', sub: 'Peptidy', body: '#d98b7a', cap: '#b06655', dark: '#c27565', accent: '#b06655', bg: '#fbeee9' },
  'won-pack-ashwagandha': { form: 'pouch', name: 'Ashwagandha', sub: 'KSM-66', body: '#6b5b3e', dark: '#54472f', accent: '#54472f', bg: '#f4f0e6' },
  'won-pack-preworkout': { form: 'tub', name: 'Pre-Workout', sub: 'Energy', body: '#ff5a3c', cap: '#cc3f26', dark: '#e04a2f', accent: '#cc3f26', bg: '#ffeee9' },
};

/** Product title (as re-skinned by reskin-products.mjs) -> packshot file. */
export const PRODUCT_ART = {
  'Whey Protein — Čokoláda': 'won-pack-whey.png',
  'Whey Protein — Vanilka': 'won-pack-whey-vanilla.png',
  'Protein Blend — Výhodný set': 'won-pack-protein-blend.png',
  'Kreatin Monohydrát': 'won-pack-creatine.png',
  'BCAA Aminokyseliny': 'won-pack-bcaa.png',
  'Recovery Amino': 'won-pack-recovery.png',
  'Glutamin': 'won-pack-glutamine.png',
  'Vitamín D3 + K2': 'won-pack-vitamin.png',
  'Denní Multivitamín': 'won-pack-multivitamin.png',
  'Zinek + Selen': 'won-pack-zinc.png',
  'Magnesium + B6': 'won-pack-magnesium.png',
  'Omega 3 Rybí olej': 'won-pack-omega.png',
  'Kolagen Peptidy': 'won-pack-collagen.png',
  'Ashwagandha': 'won-pack-ashwagandha.png',
  'Elektrolyty Hydratace': 'won-pack-electrolytes.png',
  'Pre-Workout Energy': 'won-pack-preworkout.png',
  'Proteinová tyčinka (12 ks)': 'won-pack-sticks.png',
};

/** Collection handle -> category art. */
export const COLLECTION_ART = {
  proteiny: 'won-cat-protein.png',
  'kreatin-aminokyseliny': 'won-cat-creatine.png',
  'vitaminy-mineraly': 'won-cat-vitamins.png',
  'zdravi-regenerace': 'won-cat-health.png',
};
