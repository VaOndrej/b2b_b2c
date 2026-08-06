// reskin-products.mjs — turn the dev store's demo snowboards into a food-supplement
// storefront (path A): rename to supplement titles + remove product images so the
// won product cards fall back to a clean neutral placeholder (no snowboards).
//
// SAFE: only touches products whose handle starts with "the-" (Shopify's sample
// snowboards) or "selling-plans-ski-wax". It NEVER touches app-test products
// (won-e2e-*, mg-e2e-*) or the gift card. Dry-run by default.
//
// Usage (you keep the token — it is never printed):
//   SHOPIFY_ADMIN_TOKEN=shpat_xxx node themes/demo/tools/reskin-products.mjs          # dry run
//   SHOPIFY_ADMIN_TOKEN=shpat_xxx node themes/demo/tools/reskin-products.mjs --apply   # do it
//
// Token: dev store Admin → Settings → Apps and sales channels → Develop apps →
// Create an app → Admin API scopes: write_products → Install → reveal Admin API
// access token.

const SHOP = process.env.SHOP || 'b2b-b2c-store-development.myshopify.com';
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const APPLY = process.argv.includes('--apply');
const API = `https://${SHOP}/admin/api/2025-01/graphql.json`;

if (!TOKEN) {
  console.error('Missing SHOPIFY_ADMIN_TOKEN env var. See header of this file.');
  process.exit(1);
}

// Never rename/strip these (app e2e fixtures + gift card).
const PROTECT = (h) => /^won-e2e-|^mg-e2e-|^gift-card$/.test(h);

// Snowboard/ski-wax handle → supplement title. Handles not listed but matching
// the "the-*"/ski-wax rule get a generic supplement name by index.
const MAP = {
  'the-collection-snowboard-liquid': 'Whey Protein — Čokoláda',
  'the-collection-snowboard-oxygen': 'Whey Protein — Vanilka',
  'the-collection-snowboard-hydrogen': 'Kreatin Monohydrát',
  'the-complete-snowboard': 'Protein Blend — Výhodný set',
  'the-multi-managed-snowboard': 'BCAA Aminokyseliny',
  'the-multi-location-snowboard': 'Vitamín D3 + K2',
  'the-compare-at-price-snowboard': 'Magnesium + B6',
  'the-3p-fulfilled-snowboard': 'Omega 3 Rybí olej',
  'the-videographer-snowboard': 'Pre-Workout Energy',
  'the-out-of-stock-snowboard': 'Proteinová tyčinka (12 ks)',
  'the-inventory-not-tracked-snowboard': 'Elektrolyty Hydratace',
  'selling-plans-ski-wax': 'Denní Multivitamín',
};
const GENERIC = ['Recovery Amino', 'Zinek + Selen', 'Kolagen Peptidy', 'Glutamin', 'Ashwagandha'];

async function gql(query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function listProducts() {
  const out = [];
  let cursor = null;
  do {
    const data = await gql(
      `query($cursor: String) {
        products(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id handle title media(first: 20) { nodes { id } } }
        }
      }`,
      { cursor }
    );
    out.push(...data.products.nodes);
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

async function run() {
  const products = await listProducts();
  const targets = products.filter(
    (p) => !PROTECT(p.handle) && (/^the-/.test(p.handle) || p.handle === 'selling-plans-ski-wax')
  );
  console.log(`Found ${products.length} products, ${targets.length} to re-skin (${APPLY ? 'APPLY' : 'DRY RUN'}).\n`);

  let gi = 0;
  for (const p of targets) {
    const title = MAP[p.handle] || GENERIC[gi++ % GENERIC.length];
    const mediaIds = p.media.nodes.map((m) => m.id);
    console.log(`  ${p.handle}\n    title → "${title}"   images to remove: ${mediaIds.length}`);
    if (!APPLY) continue;

    const upd = await gql(
      `mutation($input: ProductInput!) {
        productUpdate(input: $input) { product { id } userErrors { field message } }
      }`,
      { input: { id: p.id, title } }
    );
    if (upd.productUpdate.userErrors.length) console.error('    ! rename:', upd.productUpdate.userErrors);

    if (mediaIds.length) {
      const del = await gql(
        `mutation($pid: ID!, $ids: [ID!]!) {
          productDeleteMedia(productId: $pid, mediaIds: $ids) { deletedMediaIds mediaUserErrors { field message } }
        }`,
        { pid: p.id, ids: mediaIds }
      );
      if (del.productDeleteMedia.mediaUserErrors.length) console.error('    ! media:', del.productDeleteMedia.mediaUserErrors);
    }
  }
  console.log(`\n${APPLY ? 'Done.' : 'Dry run complete — re-run with --apply to execute.'}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
