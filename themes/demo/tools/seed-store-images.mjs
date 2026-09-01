#!/usr/bin/env node
/**
 * seed-store-images — put the Won packshots onto the dev store's products and
 * collections.
 *
 * The theme's own art is flat SVG (themes/won-base/assets/won-pack-*.svg), but
 * Shopify does not render SVG as product media, so this uploads the RASTERISED
 * versions. The SVG stays the single source of truth; re-run
 * `render-packs.mjs --apply --raster <dir>` and then this, and the store follows.
 *
 * Why this exists: the demo homepage showed two different pack styles at once —
 * flat vector art in the hero/categories and the older raster placeholders on
 * the product cards, because product images are STORE DATA and the theme cannot
 * reach them.
 *
 * Dry run by default. The token is read from the environment and never printed.
 *
 *   SHOPIFY_ADMIN_TOKEN=… node themes/demo/tools/seed-store-images.mjs
 *   SHOPIFY_ADMIN_TOKEN=… node themes/demo/tools/seed-store-images.mjs --apply
 *   …                                                                 --only kreatin-monohydrat
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

const SHOP = process.env.SHOP || 'b2b-b2c-store-development.myshopify.com';
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API = `https://${SHOP}/admin/api/2025-01/graphql.json`;
const APPLY = process.argv.includes('--apply');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i === -1 ? null : process.argv[i + 1]; })();
const RASTER = (() => { const i = process.argv.indexOf('--raster'); return i === -1 ? 'tmp/packs' : process.argv[i + 1]; })();

if (!TOKEN) {
  console.error('Missing SHOPIFY_ADMIN_TOKEN. Pass it in the environment; it is never written to disk by this tool.');
  process.exit(1);
}

/** Product title (as re-skinned by reskin-products.mjs) → packshot file. */
const PRODUCT_ART = {
  'Whey Protein — Čokoláda': 'won-pack-whey.png',
  'Whey Protein — Vanilka': 'won-pack-whey.png',
  'Protein Blend — Výhodný set': 'won-pack-whey.png',
  'Kreatin Monohydrát': 'won-pack-creatine.png',
  'BCAA Aminokyseliny': 'won-pack-bcaa.png',
  'Recovery Amino': 'won-pack-bcaa.png',
  'Glutamin': 'won-pack-bcaa.png',
  'Vitamín D3 + K2': 'won-pack-vitamin.png',
  'Denní Multivitamín': 'won-pack-vitamin.png',
  'Zinek + Selen': 'won-pack-vitamin.png',
  'Magnesium + B6': 'won-pack-magnesium.png',
  'Omega 3 Rybí olej': 'won-pack-omega.png',
  'Kolagen Peptidy': 'won-pack-omega.png',
  'Ashwagandha': 'won-pack-greens.png',
  'Elektrolyty Hydratace': 'won-pack-electrolytes.png',
  'Pre-Workout Energy': 'won-pack-electrolytes.png',
  'Proteinová tyčinka (12 ks)': 'won-pack-sticks.png',
};

/** Collection handle → category art. */
const COLLECTION_ART = {
  proteiny: 'won-cat-protein.png',
  'kreatin-aminokyseliny': 'won-cat-creatine.png',
  'vitaminy-mineraly': 'won-cat-vitamins.png',
  'zdravi-regenerace': 'won-cat-health.png',
};

// Never touch the app's e2e fixtures or the gift card.
const PROTECT = (h) => /^won-e2e-|^mg-e2e-|^gift-card$/.test(h || '');

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

async function listAll(field, extra = '') {
  const out = [];
  let cursor = null;
  do {
    const d = await gql(
      `query($cursor: String) {
        ${field}(first: 50, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id handle title ${extra} }
        }
      }`,
      { cursor }
    );
    out.push(...d[field].nodes);
    cursor = d[field].pageInfo.hasNextPage ? d[field].pageInfo.endCursor : null;
  } while (cursor);
  return out;
}

/**
 * Shopify will not accept raw bytes on productCreateMedia — media must already
 * live at a URL it can fetch. stagedUploadsCreate hands us a one-shot bucket to
 * PUT the file into, and returns the resourceUrl to reference.
 */
async function stageAndUpload(file) {
  const name = basename(file);
  const d = await gql(
    `mutation($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    { input: [{ filename: name, mimeType: 'image/png', httpMethod: 'POST', resource: 'IMAGE' }] }
  );
  const errs = d.stagedUploadsCreate.userErrors;
  if (errs.length) throw new Error(`stagedUploadsCreate: ${JSON.stringify(errs)}`);
  const target = d.stagedUploadsCreate.stagedTargets[0];

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append('file', new Blob([readFileSync(file)], { type: 'image/png' }), name);
  const up = await fetch(target.url, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`upload ${name}: HTTP ${up.status}`);
  return target.resourceUrl;
}

async function replaceProductMedia(product, resourceUrl, alt) {
  const old = product.media.nodes.map((m) => m.id);
  if (old.length) {
    await gql(
      `mutation($productId: ID!, $mediaIds: [ID!]!) {
        productDeleteMedia(productId: $productId, mediaIds: $mediaIds) { deletedMediaIds userErrors { field message } }
      }`,
      { productId: product.id, mediaIds: old }
    );
  }
  const d = await gql(
    `mutation($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        mediaUserErrors { field message }
      }
    }`,
    { productId: product.id, media: [{ originalSource: resourceUrl, alt, mediaContentType: 'IMAGE' }] }
  );
  const errs = d.productCreateMedia.mediaUserErrors;
  if (errs.length) throw new Error(`productCreateMedia: ${JSON.stringify(errs)}`);
}

async function run() {
  const [products, collections] = await Promise.all([
    listAll('products', 'media(first: 20) { nodes { id } }'),
    listAll('collections', ''),
  ]);

  const planned = [];
  for (const p of products) {
    if (PROTECT(p.handle)) continue;
    const art = PRODUCT_ART[p.title];
    if (!art) continue;
    if (ONLY && p.handle !== ONLY) continue;
    planned.push({ kind: 'product', node: p, art });
  }
  for (const c of collections) {
    const art = COLLECTION_ART[c.handle];
    if (!art) continue;
    if (ONLY && c.handle !== ONLY) continue;
    planned.push({ kind: 'collection', node: c, art });
  }

  const missingArt = [...new Set(planned.map((x) => x.art))].filter((a) => !existsSync(join(RASTER, a)));
  const unmatched = products.filter((p) => !PROTECT(p.handle) && !PRODUCT_ART[p.title]).map((p) => p.title);

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}  store ${SHOP}\n`);
  console.log(`  products on store: ${products.length}   collections: ${collections.length}`);
  console.log(`  planned updates:   ${planned.length}\n`);
  for (const x of planned) {
    const f = join(RASTER, x.art);
    const size = existsSync(f) ? `${(statSync(f).size / 1024).toFixed(0)} kB` : 'MISSING';
    const had = x.kind === 'product' ? `${x.node.media.nodes.length} existing image(s)` : 'collection image';
    console.log(`  ${x.kind.padEnd(10)} ${(x.node.title || x.node.handle).padEnd(30)} ← ${x.art.padEnd(26)} ${size}  (replaces ${had})`);
  }
  if (unmatched.length) console.log(`\n  no art mapped (left untouched): ${unmatched.join(', ')}`);
  if (missingArt.length) {
    console.error(`\n  ! missing raster files in ${RASTER}: ${missingArt.join(', ')}`);
    console.error(`    run: node themes/demo/tools/render-packs.mjs --apply --raster ${RASTER}`);
    process.exit(1);
  }

  if (!APPLY) {
    console.log('\nnothing written. re-run with --apply');
    return;
  }

  const cache = new Map();
  for (const x of planned) {
    const file = join(RASTER, x.art);
    if (!cache.has(x.art)) cache.set(x.art, await stageAndUpload(file));
    const url = cache.get(x.art);
    if (x.kind === 'product') {
      await replaceProductMedia(x.node, url, x.node.title);
    } else {
      const d = await gql(
        `mutation($input: CollectionInput!) {
          collectionUpdate(input: $input) { collection { id } userErrors { field message } }
        }`,
        { input: { id: x.node.id, image: { src: url, altText: x.node.title } } }
      );
      const errs = d.collectionUpdate.userErrors;
      if (errs.length) throw new Error(`collectionUpdate ${x.node.handle}: ${JSON.stringify(errs)}`);
    }
    console.log(`  ✓ ${x.kind} ${x.node.title || x.node.handle}`);
  }
  console.log(`\nupdated ${planned.length} item(s) on ${SHOP}`);
}

run().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
