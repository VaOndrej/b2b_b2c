// Create/refresh the SHARED E2E product catalog in the dev store. Idempotent:
// `productSet` upserts by handle, so re-running enhances existing products
// instead of duplicating them. Reads the Admin token from the environment only
// (never printed, never written to disk).
//
//   SHOPIFY_ADMIN_API_TOKEN=<shpat_…> \
//   SHOPIFY_E2E_SHOP_DOMAIN=<shop>.myshopify.com \
//   node packages/testing/scripts/seed-e2e-products.mjs
//
// The token needs write_products (+ publish to the Online Store).

import process from "node:process";

import { WON_E2E_PRODUCT_LIST } from "../src/e2e-products.js";

const API_VERSION = "2026-04";
const shop = String(
  process.env.SHOPIFY_E2E_SHOP_DOMAIN ||
    "b2b-b2c-store-development.myshopify.com",
).trim();
const token = String(process.env.SHOPIFY_ADMIN_API_TOKEN || "").trim();

if (!token) {
  console.error(
    "SHOPIFY_ADMIN_API_TOKEN is required (Admin token with write_products).",
  );
  process.exit(1);
}

const endpoint = `https://${shop}/admin/api/${API_VERSION}/graphql.json`;

async function gql(query, variables) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from Admin API.`);
  }
  const json = await response.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

function toProductSetInput(product) {
  const input = {
    title: product.title,
    handle: product.handle,
    status: "ACTIVE",
  };
  if (product.options.length > 0) {
    input.productOptions = product.options.map((option) => ({
      name: option.name,
      values: option.values.map((value) => ({ name: value })),
    }));
    input.variants = product.variants.map((variant) => ({
      price: variant.price,
      optionValues: Object.entries(variant.options ?? {}).map(
        ([optionName, name]) => ({ optionName, name }),
      ),
    }));
  } else {
    // No explicit options → Shopify's default "Title / Default Title" option.
    input.productOptions = [
      { name: "Title", values: [{ name: "Default Title" }] },
    ];
    input.variants = product.variants.map((variant) => ({
      price: variant.price,
      optionValues: [{ optionName: "Title", name: "Default Title" }],
    }));
  }
  return input;
}

const PRODUCT_SET = `
  mutation SeedProduct($input: ProductSetInput!, $identifier: ProductSetIdentifiers!) {
    productSet(input: $input, identifier: $identifier, synchronous: true) {
      product {
        id
        handle
        status
        variants(first: 20) { nodes { id } }
      }
      userErrors { field message }
    }
  }
`;

const PUBLICATIONS = `
  query Publications {
    publications(first: 25) { nodes { id name } }
  }
`;

const PUBLISH = `
  mutation Publish($id: ID!, $input: [PublicationInput!]!) {
    publishablePublish(id: $id, input: $input) {
      userErrors { field message }
    }
  }
`;

async function main() {
  const pubs = await gql(PUBLICATIONS);
  const onlineStore = pubs.publications.nodes.find(
    (node) => node.name === "Online Store",
  );
  if (!onlineStore) {
    throw new Error("Online Store publication not found on this shop.");
  }

  for (const product of WON_E2E_PRODUCT_LIST) {
    const data = await gql(PRODUCT_SET, {
      input: toProductSetInput(product),
      identifier: { handle: product.handle },
    });
    const setErrors = data.productSet.userErrors;
    if (setErrors.length > 0) {
      throw new Error(
        `productSet ${product.handle}: ${JSON.stringify(setErrors)}`,
      );
    }
    const created = data.productSet.product;

    const published = await gql(PUBLISH, {
      id: created.id,
      input: [{ publicationId: onlineStore.id }],
    });
    const publishErrors = published.publishablePublish.userErrors;
    if (publishErrors.length > 0) {
      throw new Error(
        `publish ${product.handle}: ${JSON.stringify(publishErrors)}`,
      );
    }

    console.log(
      `✓ ${product.handle}  (${created.variants.nodes.length} variant(s))`,
    );
  }

  console.log(
    `\nSeeded ${WON_E2E_PRODUCT_LIST.length} shared E2E products on ${shop}.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
