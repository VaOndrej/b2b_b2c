import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogSearchLoader } from "../../app/services/admin-catalog-search.server.ts";

function buildRequest(url: string, method = "GET") {
  return new Request(url, { method });
}

test("catalog search route rejects non-GET methods", async () => {
  const loader = createCatalogSearchLoader({
    authenticateAdmin: async () => ({
      admin: {
        graphql: async () => ({
          async json() {
            return {};
          },
        }),
      },
    }),
    searchCatalog: (async () => []) as any,
  });

  const response = await loader({
    request: buildRequest("https://example.test/app/api/catalog-search?type=product&q=drill", "POST"),
  });
  assert.equal(response.status, 405);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.contract, "INTERNAL_ADMIN_ENDPOINT");
});

test("catalog search route validates query params and returns mapped success payload", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const loader = createCatalogSearchLoader({
    authenticateAdmin: async () => ({
      admin: {
        graphql: async () => ({
          async json() {
            return {};
          },
        }),
      },
    }),
    searchCatalog: (async (input: Record<string, unknown>) => {
      calls.push(input);
      return [
        {
          id: "gid://shopify/Product/300",
          type: "product",
          title: "Turbo Cutter",
          handle: "turbo-cutter",
          secondaryLabel: "Handle: turbo-cutter",
        },
      ];
    }) as any,
  });

  const response = await loader({
    request: buildRequest(
      "https://example.test/app/api/catalog-search?type=product&q=turbo&limit=8",
    ),
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.type, "product");
  assert.equal(calls[0]?.query, "turbo");
  assert.equal(calls[0]?.limit, 8);

  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.contract, "INTERNAL_ADMIN_ENDPOINT");
  assert.equal(payload.type, "product");
  assert.equal(payload.limit, 8);
  assert.equal(Array.isArray(payload.items), true);
  assert.equal(payload.items[0]?.id, "gid://shopify/Product/300");
});

test("catalog search route accepts customer type and returns 400 for other invalid types", async () => {
  const loader = createCatalogSearchLoader({
    authenticateAdmin: async () => ({
      admin: {
        graphql: async () => ({
          async json() {
            return {};
          },
        }),
      },
    }),
    searchCatalog: (async (input: Record<string, unknown>) => {
      return [
        {
          id: "gid://shopify/Customer/500",
          type: input.type,
          title: "Customer Result",
          handle: null,
          secondaryLabel: "customer@example.com",
        },
      ];
    }) as any,
  });

  const customerResponse = await loader({
    request: buildRequest(
      "https://example.test/app/api/catalog-search?type=customer&q=alpha",
    ),
  });
  assert.equal(customerResponse.status, 200);
  const customerPayload = await customerResponse.json();
  assert.equal(customerPayload.type, "customer");
  assert.equal(customerPayload.items[0]?.id, "gid://shopify/Customer/500");

  const badTypeResponse = await loader({
    request: buildRequest(
      "https://example.test/app/api/catalog-search?type=order&q=alpha",
    ),
  });
  assert.equal(badTypeResponse.status, 400);
  const badTypePayload = await badTypeResponse.json();
  assert.equal(badTypePayload.ok, false);
  assert.equal(badTypePayload.contract, "INTERNAL_ADMIN_ENDPOINT");

  const badLimitResponse = await loader({
    request: buildRequest(
      "https://example.test/app/api/catalog-search?type=collection&q=alpha&limit=999",
    ),
  });
  assert.equal(badLimitResponse.status, 400);
  const badLimitPayload = await badLimitResponse.json();
  assert.equal(badLimitPayload.ok, false);
  assert.equal(badLimitPayload.contract, "INTERNAL_ADMIN_ENDPOINT");
});
