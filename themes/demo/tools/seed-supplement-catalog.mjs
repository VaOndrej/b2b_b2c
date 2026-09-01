// seed-supplement-catalog.mjs — dorovná demo katalog dev storu na doplňky stravy.
//
// PROČ: produkty jsou přejmenované Shopify snowboardy. Titulky sedí, ale popisy jsou
// prázdné (6 ze 7) a varianty jsou "Ice / Dawn / Powder". Na takových datech nejde
// dělat obsahový ani konfigurační audit šablony — viz
// docs/plans/2026-08-30-won-theme-e2e-matrix.md, vrstva 1 a 4.
//
// BEZPEČNOST — přečti, než pustíš s --apply:
//   • Dry-run je DEFAULT. Bez --apply se nezapíše nic.
//   • Nedotýká se: won-e2e-*, mg-e2e-*, gift-card (PROTECT).
//   • Nemění: status (draft/archived), inventory (out-of-stock, untracked),
//     selling plans, obrázky, kolekce. To jsou záměrné testovací fixtures.
//   • Používá jen ADITIVNÍ mutace: productUpdate (jen zadaná pole),
//     productOptionsCreate, productOptionUpdate, productVariantsBulkUpdate,
//     metafieldsSet. NIKDY productSet — ten maže varianty i metafieldy,
//     které nejsou v inputu.
//   • Záloha katalogu: node themes/demo/tools/dump-products.mjs > tmp/store-backup-<datum>.json
//
// Použití:
//   SHOPIFY_ADMIN_TOKEN=shpat_… node themes/demo/tools/seed-supplement-catalog.mjs
//   SHOPIFY_ADMIN_TOKEN=shpat_… node themes/demo/tools/seed-supplement-catalog.mjs --step=desc --apply
//
//   --step=desc|options|prices|stock|meta|all  (default vše; dá se opakovat: --step=desc --step=meta)
//   --handle=<handle>                      omezí na jeden produkt (ověření na jednom kusu)
//   --apply                                teprve tohle zapisuje

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SHOP = process.env.SHOP || 'b2b-b2c-store-development.myshopify.com';
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
const API = `https://${SHOP}/admin/api/2025-07/graphql.json`;
if (!TOKEN) {
  console.error('Chybí SHOPIFY_ADMIN_TOKEN. Viz hlavička souboru.');
  process.exit(1);
}

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const ONLY_HANDLE = (argv.find((a) => a.startsWith('--handle=')) || '').split('=')[1] || null;
const steps = argv.filter((a) => a.startsWith('--step=')).map((a) => a.split('=')[1]);
const STEPS = steps.length ? new Set(steps) : new Set(['desc', 'options', 'prices', 'stock', 'meta']);
const wants = (s) => STEPS.has(s) || STEPS.has('all');

const PROTECT = (h) => /^won-e2e-|^mg-e2e-|^gift-card$/.test(h);
/** Produkty, jejichž stav skladu JE ten fixture — nesahat na něj. */
const FIXTURE_STOCK = new Set(['the-out-of-stock-snowboard', 'the-inventory-not-tracked-snowboard']);
const STOCK_QTY = 50;

let _fallbackLoc = null;
async function fallbackLocation() {
  if (_fallbackLoc) return _fallbackLoc;
  const d = await gql(Q_LOCATION, {});
  const first = d.locations.nodes.find((l) => l.isActive) || d.locations.nodes[0];
  if (!first) throw new Error('Store nemá aktivní lokaci pro sklad.');
  _fallbackLoc = first.id;
  return _fallbackLoc;
}

/* Sklad se NEnaskladňuje na "první aktivní lokaci" — tenhle store jich má dvě a
   online objednávky obsluhuje jen jedna. Naskladnění na tu druhou vypadá v adminu
   správně (inventoryQuantity sčítá lokace), ale varianta zůstane na storefrontu
   NEDOSTUPNÁ. Jediná spolehlivá odpověď je lokace, na které už leží existující
   varianta téhož produktu. */
function locationOfProduct(variants) {
  for (const v of variants) {
    const level = (v.inventoryItem.inventoryLevels?.nodes || [])
      .find((l) => (l.quantities || []).some((q) => q.name === 'available' && q.quantity > 0));
    if (level) return level.location.id;
  }
  return null;
}

const catalog = JSON.parse(readFileSync(join(here, 'supplement-catalog.json'), 'utf8'));

async function gql(query, variables) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error('GraphQL: ' + JSON.stringify(json.errors));
  return json.data;
}

/** Každá mutace vrací userErrors — tichý neúspěch je horší než pád. */
function assertNoUserErrors(label, payload) {
  const errs = payload?.userErrors || [];
  if (errs.length) throw new Error(`${label}: ${JSON.stringify(errs)}`);
}

const Q_PRODUCT = `query($handle: String!) {
  productByHandle(handle: $handle) {
    id handle title status
    options { id name position optionValues { id name } }
    variants(first: 50) { nodes { id title price compareAtPrice sku selectedOptions { name value } } }
  }
}`;

const M_UPDATE = `mutation($product: ProductUpdateInput!) {
  productUpdate(product: $product) { product { id } userErrors { field message } }
}`;

const M_OPTIONS_CREATE = `mutation($productId: ID!, $options: [OptionCreateInput!]!, $variantStrategy: ProductOptionCreateVariantStrategy) {
  productOptionsCreate(productId: $productId, options: $options, variantStrategy: $variantStrategy) {
    product { id options { id name optionValues { id name } } }
    userErrors { field message code }
  }
}`;

const M_OPTION_UPDATE = `mutation($productId: ID!, $option: OptionUpdateInput!, $optionValuesToUpdate: [OptionValueUpdateInput!], $variantStrategy: ProductOptionUpdateVariantStrategy) {
  productOptionUpdate(productId: $productId, option: $option, optionValuesToUpdate: $optionValuesToUpdate, variantStrategy: $variantStrategy) {
    product { id options { id name optionValues { id name } } }
    userErrors { field message code }
  }
}`;

const M_VARIANTS_UPDATE = `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id title price sku }
    userErrors { field message }
  }
}`;

const Q_LOCATION = `query { locations(first: 5, includeInactive: false) { nodes { id name isActive } } }`;

const Q_INVENTORY = `query($handle: String!) {
  productByHandle(handle: $handle) {
    id
    variants(first: 50) { nodes { id title inventoryQuantity inventoryItem { id tracked
      inventoryLevels(first: 10) { nodes { id location { id name } quantities(names: ["available"]) { name quantity } } } } } }
  }
}`;

/* Nově založená varianta NENÍ na lokaci naskladněná, takže inventorySetQuantities
   na ni spadne s ITEM_NOT_STOCKED_AT_LOCATION. inventoryActivate udělá obojí
   naráz: napojí položku na lokaci a nastaví množství. */
const M_INVENTORY_ACTIVATE = `mutation($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
  inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
    inventoryLevel { id quantities(names: ["available"]) { name quantity } }
    userErrors { field message }
  }
}`;

const M_INVENTORY_SET = `mutation($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup { createdAt reason }
    userErrors { field message code }
  }
}`;

const M_METAFIELDS = `mutation($metafields: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $metafields) { metafields { key namespace } userErrors { field message } }
}`;

/** Popis: krátký odstavec + skenovatelné odrážky + dávkování.
 *  PDP-006 chce OBOJÍ — vyprávění samo o sobě se nečte, samotné odrážky neprodají. */
function descriptionHtml(d) {
  const bullets = d.bullets.map((b) => `<li>${b}</li>`).join('');
  return (
    `<p>${d.lead}</p>` +
    `<ul>${bullets}</ul>` +
    (d.dosage ? `<p><strong>Dávkování:</strong> ${d.dosage}</p>` : '')
  );
}

const plan = [];
const log = (action, handle, detail) => plan.push({ action, handle, detail });

async function run() {
  console.log(`\n${APPLY ? 'ZÁPIS' : 'DRY RUN'}  ${SHOP}  kroky: ${[...STEPS].join(',')}${ONLY_HANDLE ? `  jen: ${ONLY_HANDLE}` : ''}\n`);

  for (const item of catalog.products) {
    if (PROTECT(item.handle)) { log('SKIP chráněný', item.handle, ''); continue; }
    if (ONLY_HANDLE && item.handle !== ONLY_HANDLE) continue;

    const { productByHandle: p } = await gql(Q_PRODUCT, { handle: item.handle });
    if (!p) { log('CHYBÍ ve storu', item.handle, ''); continue; }

    // ---- 1. popis + typ + tagy ------------------------------------------
    if (wants('desc')) {
      const html = descriptionHtml(item.description);
      log('popis', item.handle, `${html.length} znaků, ${item.description.bullets.length} odrážek, typ "${item.productType}"`);
      if (APPLY) {
        const d = await gql(M_UPDATE, {
          product: { id: p.id, descriptionHtml: html, productType: item.productType, tags: item.tags },
        });
        assertNoUserErrors(`productUpdate ${item.handle}`, d.productUpdate);
      }
    }

    // ---- 2. varianty: přidat osu / přejmenovat existující ----------------
    if (wants('options')) {
      const hasRealOption = p.options.some((o) => o.name !== 'Title');

      if (item.option && !hasRealOption) {
        // Produkt má jen výchozí variantu → založ osu. CREATE dogeneruje varianty
        // pro každou hodnotu; existující výchozí varianta se stane první z nich.
        log('nová osa variant', item.handle, `${item.option.name}: ${item.option.values.map((v) => v.name).join(' / ')}`);
        if (APPLY) {
          const d = await gql(M_OPTIONS_CREATE, {
            productId: p.id,
            options: [{ name: item.option.name, values: item.option.values.map((v) => ({ name: v.name })) }],
            variantStrategy: 'CREATE',
          });
          assertNoUserErrors(`productOptionsCreate ${item.handle}`, d.productOptionsCreate);
        }
      } else if (item.renameOption) {
        const opt = p.options.find((o) => o.name === item.renameOption.from);
        if (!opt) {
          log('přejmenování osy — PŘESKOČENO', item.handle, `osa "${item.renameOption.from}" už neexistuje`);
        } else {
          const toUpdate = opt.optionValues
            .filter((ov) => item.renameOption.values[ov.name])
            .map((ov) => ({ id: ov.id, name: item.renameOption.values[ov.name] }));
          log('přejmenování osy', item.handle,
            `${item.renameOption.from} → ${item.renameOption.to}; ` +
            toUpdate.map((v) => `${opt.optionValues.find((o) => o.id === v.id).name}→${v.name}`).join(', '));
          if (APPLY) {
            const d = await gql(M_OPTION_UPDATE, {
              productId: p.id,
              option: { id: opt.id, name: item.renameOption.to },
              optionValuesToUpdate: toUpdate,
              variantStrategy: 'LEAVE_AS_IS',
            });
            assertNoUserErrors(`productOptionUpdate ${item.handle}`, d.productOptionUpdate);
          }
        }
      } else if (item.option && hasRealOption) {
        log('osa variant — PŘESKOČENO', item.handle, 'produkt už má vlastní osu, nepřepisuju ji');
      }
    }

    // ---- 3. ceny / SKU na variantách ------------------------------------
    if (wants('prices')) {
      // Čti stav znovu — krok 2 mohl varianty právě založit.
      const { productByHandle: fresh } = await gql(Q_PRODUCT, { handle: item.handle });
      const byName = {};
      if (item.option) for (const v of item.option.values) byName[v.name] = v;
      if (item.variantPrices) Object.assign(byName, item.variantPrices);
      // Produkt bez osy variant má jedinou variantu "Default Title".
      if (item.singleVariant) byName['Default Title'] = item.singleVariant;
      // U variantPrices je klíč = název varianty, doplň si ho do hodnoty.
      for (const [k, v] of Object.entries(byName)) if (!v.name) v.name = k;

      const updates = [];
      for (const variant of fresh.variants.nodes) {
        const key = variant.selectedOptions.map((o) => o.value).join(' / ');
        const want = byName[key] || byName[variant.title];
        if (!want) continue;
        const patch = { id: variant.id, price: want.price };
        // compareAtPrice se posílá vždy — null ho smaže, jinak by na variantě
        // zůstala stará škrtnutá cena po produktu, kterým kdysi byl.
        patch.compareAtPrice = want.compareAtPrice || null;
        if (want.sku) patch.inventoryItem = { sku: want.sku };
        updates.push(patch);
        log('cena varianty', item.handle,
          `${key}: ${want.price}${want.compareAtPrice ? ` (bylo ${want.compareAtPrice})` : ''}${want.sku ? ` sku=${want.sku}` : ''}`);
      }
      if (APPLY && updates.length) {
        const d = await gql(M_VARIANTS_UPDATE, { productId: fresh.id, variants: updates });
        assertNoUserErrors(`productVariantsBulkUpdate ${item.handle}`, d.productVariantsBulkUpdate);
      }
    }

    // ---- 4. sklad u nově založených variant ------------------------------
    // productOptionsCreate zakládá varianty s nulovým skladem. Demo, kde je
    // druhá velikost balení vyprodaná, je horší než demo bez variant — a
    // hlavně nejde na něm testovat výběr varianty. Vyprodaný/netrackovaný
    // produkt je ale ZÁMĚRNÝ fixture, ten se nechává být.
    // Platí pro KAŽDÝ produkt s reálnou osou variant, ne jen pro ty, kterým osu
    // zakládá tenhle skript — Pre-Workout ji měl z dřívějška a dvě ze tří
    // velikostí byly vyprodané, což je na demu ta nejhorší varianta.
    if (wants('stock') && (item.option || item.variantPrices) && !FIXTURE_STOCK.has(item.handle)) {
      const { productByHandle: inv } = await gql(Q_INVENTORY, { handle: item.handle });
      const locId = locationOfProduct(inv.variants.nodes) || (await fallbackLocation());
      const needs = [];
      for (const v of inv.variants.nodes) {
        if (!v.inventoryItem.tracked) continue;
        const levels = v.inventoryItem.inventoryLevels?.nodes || [];
        const here = levels.find((l) => l.location.id === locId);
        const hereQty = here ? (here.quantities.find((q) => q.name === 'available')?.quantity ?? 0) : 0;
        // Rozlišuj: položka na lokaci JE (jen s nulou) → set. Není → activate.
        // inventoryActivate odmítne nastavit množství u už aktivní položky.
        if (hereQty <= 0) needs.push({ variant: v, alreadyActive: Boolean(here) });
        // POZOR: zásobu na jiných lokacích NEUKLÍZET. První verze tohohle skriptu
        // ji "opravovala" a tím rozbila záměrné multi-location fixtures
        // (the-multi-location-snowboard, the-multi-managed-snowboard měly zásobu
        // schválně na dvou lokacích). Skript doplňuje, nikdy neubírá.
      }
      if (needs.length) {
        log('sklad', item.handle, `${needs.map((n) => n.variant.title).join(', ')} → ${STOCK_QTY} ks na obsluhující lokaci`);
      }
      if (APPLY) {
        for (const n of needs) {
          if (n.alreadyActive) {
            const d = await gql(M_INVENTORY_SET, {
              input: {
                name: 'available', reason: 'correction', ignoreCompareQuantity: true,
                quantities: [{ inventoryItemId: n.variant.inventoryItem.id, locationId: locId, quantity: STOCK_QTY }],
              },
            });
            assertNoUserErrors(`inventorySetQuantities ${item.handle} / ${n.variant.title}`, d.inventorySetQuantities);
          } else {
            const d = await gql(M_INVENTORY_ACTIVATE, {
              inventoryItemId: n.variant.inventoryItem.id, locationId: locId, available: STOCK_QTY,
            });
            assertNoUserErrors(`inventoryActivate ${item.handle} / ${n.variant.title}`, d.inventoryActivate);
          }
        }
      }
    }

    // ---- 5. metafieldy, ze kterých žijí won bloky ------------------------
    if (wants('meta')) {
      const { productByHandle: fresh } = await gql(Q_PRODUCT, { handle: item.handle });
      const mf = [];
      const push = (namespace, key, type, value) =>
        mf.push({ ownerId: fresh.id, namespace, key, type, value: String(value) });

      const m = item.metafields || {};
      if (m.rating) push('won', 'rating', 'number_decimal', m.rating);
      if (m.rating_count) push('won', 'rating_count', 'number_integer', m.rating_count);
      if (m.delivery) push('won', 'delivery', 'single_line_text_field', m.delivery);
      if (m.net_weight_g) push('won', 'net_weight_g', 'number_integer', m.net_weight_g);
      if (m.servings) push('won', 'servings', 'number_integer', m.servings);
      if (item.nutrition) push('custom', 'nutrition', 'list.single_line_text_field', JSON.stringify(item.nutrition));

      // Váha/porce se u variantního produktu liší kus od kusu — produktový
      // metafield by lhal, tak ho tam dáváme jen u jednovariantních. U ostatních
      // to řeší per-varianta níž.
      const variantMf = [];
      const perVariant = item.option
        ? Object.fromEntries(item.option.values.map((v) => [v.name, v]))
        : item.variantPrices || null;
      if (perVariant) {
        for (const variant of fresh.variants.nodes) {
          const key = variant.selectedOptions.map((o) => o.value).join(' / ');
          const want = perVariant[key] || perVariant[variant.title];
          if (!want) continue;
          if (want.net_weight_g) variantMf.push({ ownerId: variant.id, namespace: 'won', key: 'net_weight_g', type: 'number_integer', value: String(want.net_weight_g) });
          if (want.servings) variantMf.push({ ownerId: variant.id, namespace: 'won', key: 'servings', type: 'number_integer', value: String(want.servings) });
        }
      }

      log('metafieldy', item.handle, `produkt: ${mf.map((x) => `${x.namespace}.${x.key}`).join(', ') || '—'}${variantMf.length ? ` · varianty: ${variantMf.length} zápisů` : ''}`);
      if (APPLY) {
        for (const batch of [mf, variantMf]) {
          if (!batch.length) continue;
          const d = await gql(M_METAFIELDS, { metafields: batch });
          assertNoUserErrors(`metafieldsSet ${item.handle}`, d.metafieldsSet);
        }
      }
    }
  }

  // ---- report ----------------------------------------------------------
  const byAction = {};
  for (const row of plan) (byAction[row.action] ||= []).push(row);
  for (const [action, rows] of Object.entries(byAction)) {
    console.log(`\n${action}  (${rows.length})`);
    for (const r of rows) console.log(`  ${r.handle.padEnd(38)} ${r.detail}`);
  }
  console.log(APPLY ? '\nZapsáno.\n' : '\nNic se nezapsalo. Spusť znovu s --apply.\n');
}

run().catch((e) => { console.error('\nSELHALO:', e.message, '\n'); process.exit(1); });
