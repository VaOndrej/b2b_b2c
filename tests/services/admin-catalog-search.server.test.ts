import test from "node:test";
import assert from "node:assert/strict";
import { searchAdminCatalog } from "../../app/services/admin-catalog-search.server.ts";

test("searchAdminCatalog maps product nodes and forwards normalized query/limit", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const admin = {
    async graphql(
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) {
      calls.push({
        query,
        variables: options?.variables ?? {},
      });
      return {
        async json() {
          return {
            data: {
              products: {
                nodes: [
                  {
                    id: "gid://shopify/Product/101",
                    title: "Alpha Drill",
                    handle: "alpha-drill",
                    status: "ACTIVE",
                  },
                  {
                    id: "gid://shopify/Product/102",
                    title: "Bravo Saw",
                    handle: "",
                    status: "DRAFT",
                  },
                  {
                    id: "",
                    title: "Broken",
                    handle: "broken",
                  },
                ],
              },
            },
          };
        },
      };
    },
  };

  const items = await searchAdminCatalog({
    admin,
    type: "product",
    query: "drill",
    limit: 7,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.query.includes("query AdminCatalogSearchProducts"), true);
  assert.equal(calls[0]?.variables.first, 7);
  assert.equal(calls[0]?.variables.query, "title:*drill* OR handle:*drill*");
  assert.deepEqual(items, [
    {
      id: "gid://shopify/Product/101",
      type: "product",
      title: "Alpha Drill",
      handle: "alpha-drill",
      secondaryLabel: "Handle: alpha-drill",
    },
    {
      id: "gid://shopify/Product/102",
      type: "product",
      title: "Bravo Saw",
      handle: null,
      secondaryLabel: "DRAFT",
    },
  ]);
});

test("searchAdminCatalog maps collection nodes and skips graphql for empty query", async () => {
  let graphqlCallCount = 0;
  const admin = {
    async graphql(
      query: string,
      _options?: { variables?: Record<string, unknown> },
    ) {
      void query;
      void _options;
      graphqlCallCount += 1;
      return {
        async json() {
          return {
            data: {
              collections: {
                nodes: [
                  {
                    id: "gid://shopify/Collection/201",
                    title: "Spring Deals",
                    handle: "spring-deals",
                  },
                ],
              },
            },
          };
        },
      };
    },
  };

  const emptyResult = await searchAdminCatalog({
    admin,
    type: "collection",
    query: "  ",
    limit: 10,
  });
  assert.deepEqual(emptyResult, []);
  assert.equal(graphqlCallCount, 0);

  const collectionResult = await searchAdminCatalog({
    admin,
    type: "collection",
    query: "spring",
    limit: 5,
  });
  assert.equal(graphqlCallCount, 1);
  assert.deepEqual(collectionResult, [
    {
      id: "gid://shopify/Collection/201",
      type: "collection",
      title: "Spring Deals",
      handle: "spring-deals",
      secondaryLabel: "Handle: spring-deals",
    },
  ]);
});

test("searchAdminCatalog maps customer nodes with email secondary label", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const admin = {
    async graphql(
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) {
      calls.push({
        query,
        variables: options?.variables ?? {},
      });
      return {
        async json() {
          return {
            data: {
              customers: {
                nodes: [
                  {
                    id: "gid://shopify/Customer/301",
                    displayName: "Alice Alpha",
                    firstName: "Alice",
                    lastName: "Alpha",
                    email: "alice@example.com",
                  },
                  {
                    id: "gid://shopify/Customer/302",
                    displayName: "",
                    firstName: "",
                    lastName: "",
                    email: "fallback@example.com",
                  },
                ],
              },
            },
          };
        },
      };
    },
  };

  const items = await searchAdminCatalog({
    admin,
    type: "customer",
    query: "alice",
    limit: 4,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.query.includes("query AdminCatalogSearchCustomers"), true);
  assert.equal(
    calls[0]?.variables.query,
    "email:*alice* OR first_name:*alice* OR last_name:*alice*",
  );
  assert.deepEqual(items, [
    {
      id: "gid://shopify/Customer/301",
      type: "customer",
      title: "Alice Alpha",
      handle: null,
      secondaryLabel: "alice@example.com",
    },
    {
      id: "gid://shopify/Customer/302",
      type: "customer",
      title: "fallback@example.com",
      handle: null,
      secondaryLabel: null,
    },
  ]);
});

test("searchAdminCatalog maps variant nodes with product context and SKU label", async () => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = [];
  const admin = {
    async graphql(
      query: string,
      options?: { variables?: Record<string, unknown> },
    ) {
      calls.push({
        query,
        variables: options?.variables ?? {},
      });
      return {
        async json() {
          return {
            data: {
              productVariants: {
                nodes: [
                  {
                    id: "gid://shopify/ProductVariant/401",
                    title: "Carton",
                    sku: "CARTON-12",
                    product: {
                      title: "Alpha Drill",
                      handle: "alpha-drill",
                    },
                    selectedOptions: [
                      { name: "Pack", value: "Carton" },
                    ],
                  },
                  {
                    id: "gid://shopify/ProductVariant/402",
                    title: "Default Title",
                    sku: "",
                    product: {
                      title: "Bravo Saw",
                      handle: "",
                    },
                    selectedOptions: [
                      { name: "Title", value: "Default Title" },
                    ],
                  },
                  {
                    id: "",
                    title: "Broken",
                    sku: "BROKEN-1",
                    product: {
                      title: "Broken Product",
                      handle: "broken-product",
                    },
                    selectedOptions: [],
                  },
                ],
              },
            },
          };
        },
      };
    },
  };

  const items = await searchAdminCatalog({
    admin,
    type: "variant",
    query: "carton",
    limit: 6,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.query.includes("query AdminCatalogSearchVariants"), true);
  assert.equal(calls[0]?.variables.first, 6);
  assert.equal(
    calls[0]?.variables.query,
    "sku:*carton* OR title:*carton* OR product_title:*carton*",
  );
  assert.deepEqual(items, [
    {
      id: "gid://shopify/ProductVariant/401",
      type: "variant",
      title: "Alpha Drill - Carton",
      handle: "alpha-drill",
      secondaryLabel: "SKU: CARTON-12",
    },
    {
      id: "gid://shopify/ProductVariant/402",
      type: "variant",
      title: "Bravo Saw",
      handle: null,
      secondaryLabel: "Title: Default Title",
    },
  ]);
});
