// dump-products.mjs — READ-ONLY snapshot of the dev store's catalogue.
// Doubles as the backup taken before any write (CLAUDE.md: záloha před dávkovou změnou).
//   SHOPIFY_ADMIN_TOKEN=… node themes/demo/tools/dump-products.mjs > backup.json
const SHOP = process.env.SHOP || 'b2b-b2c-store-development.myshopify.com';
const TOKEN = process.env.SHOPIFY_ADMIN_TOKEN;
if (!TOKEN) { console.error('Missing SHOPIFY_ADMIN_TOKEN'); process.exit(1); }
const API = `https://${SHOP}/admin/api/2025-01/graphql.json`;

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

const Q = `query($cursor: String) {
  products(first: 50, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id handle title status productType vendor tags
      descriptionHtml
      options { id name position optionValues { id name } }
      metafields(first: 30) { nodes { namespace key type value } }
      variants(first: 50) { nodes {
        id title sku price compareAtPrice
        selectedOptions { name value }
        inventoryPolicy inventoryQuantity
        inventoryItem { id tracked measurement { weight { value unit } } }
      } }
      media(first: 10) { nodes { ... on MediaImage { id image { url altText } } } }
    }
  }
}`;

const out = [];
let cursor = null;
for (;;) {
  const d = await gql(Q, { cursor });
  out.push(...d.products.nodes);
  if (!d.products.pageInfo.hasNextPage) break;
  cursor = d.products.pageInfo.endCursor;
}
console.log(JSON.stringify({ shop: SHOP, takenAt: new Date().toISOString(), products: out }, null, 2));
