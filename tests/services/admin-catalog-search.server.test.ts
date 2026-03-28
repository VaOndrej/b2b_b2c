import test from "node:test";
import assert from "node:assert/strict";
import { searchAdminCatalog } from "../../app/services/admin-catalog-search.server.ts";

test("searchAdminCatalog uses imported product catalog search for product lookups", async () => {
  const productSearchCalls: Array<{ query: string; limit: number }> = [];
  const items = await searchAdminCatalog(
    {
      admin: {
        graphql: async () => ({
          async json() {
            return {};
          },
        }),
      },
      type: "product",
      query: "drill",
      limit: 7,
    },
    {
      searchImportedProducts: async (query, limit) => {
        productSearchCalls.push({ query, limit });
        return [
          {
            id: "gid://shopify/Product/101",
            type: "product",
            title: "Alpha Drill",
            handle: "alpha-drill",
            secondaryLabel: "Status: ACTIVE",
          },
        ];
      },
    },
  );

  assert.deepEqual(productSearchCalls, [{ query: "drill", limit: 7 }]);
  assert.deepEqual(items, [
    {
      id: "gid://shopify/Product/101",
      type: "product",
      title: "Alpha Drill",
      handle: "alpha-drill",
      secondaryLabel: "Status: ACTIVE",
    },
  ]);
});

test("searchAdminCatalog allows empty-query product browse for dropdown pickers", async () => {
  const productSearchCalls: Array<{ query: string; limit: number }> = [];

  const items = await searchAdminCatalog(
    {
      admin: {
        graphql: async () => ({
          async json() {
            return {};
          },
        }),
      },
      type: "product",
      query: "",
      limit: 8,
    },
    {
      searchImportedProducts: async (query, limit) => {
        productSearchCalls.push({ query, limit });
        return [
          {
            id: "gid://shopify/Product/201",
            type: "product",
            title: "Snowboard",
            handle: "snowboard",
            secondaryLabel: "Status: ACTIVE",
          },
        ];
      },
    },
  );

  assert.deepEqual(productSearchCalls, [{ query: "", limit: 8 }]);
  assert.equal(items[0]?.title, "Snowboard");
});

test("searchAdminCatalog uses imported variant catalog search for variant lookups", async () => {
  const variantSearchCalls: Array<{ query: string; limit: number }> = [];
  const items = await searchAdminCatalog(
    {
      admin: {
        graphql: async () => ({
          async json() {
            return {};
          },
        }),
      },
      type: "variant",
      query: "carton",
      limit: 6,
    },
    {
      searchImportedVariants: async (query, limit) => {
        variantSearchCalls.push({ query, limit });
        return [
          {
            id: "gid://shopify/ProductVariant/401",
            type: "variant",
            title: "Alpha Drill - Carton",
            handle: "alpha-drill",
            secondaryLabel: "SKU: CARTON-12",
          },
        ];
      },
    },
  );

  assert.deepEqual(variantSearchCalls, [{ query: "carton", limit: 6 }]);
  assert.deepEqual(items, [
    {
      id: "gid://shopify/ProductVariant/401",
      type: "variant",
      title: "Alpha Drill - Carton",
      handle: "alpha-drill",
      secondaryLabel: "SKU: CARTON-12",
    },
  ]);
});

test("searchAdminCatalog uses imported collection catalog search for collection lookups", async () => {
  let graphqlCallCount = 0;
  const admin = {
    async graphql(
      query: string,
      _options?: { variables?: Record<string, unknown> },
    ) {
      void query;
      void _options;
      graphqlCallCount += 1;
      return { async json() { return { data: {} }; } };
    },
  };

  const mockSearchCollections = async (query: string, limit: number) => {
    if (!query.trim()) {
      return [
        {
          id: "gid://shopify/Collection/201",
          type: "collection" as const,
          title: "Spring Deals",
          handle: "spring-deals",
          secondaryLabel: "Handle: spring-deals",
        },
      ];
    }
    return [
      {
        id: "gid://shopify/Collection/201",
        type: "collection" as const,
        title: "Spring Deals",
        handle: "spring-deals",
        secondaryLabel: "Handle: spring-deals",
      },
    ].filter((item) =>
      item.title.toLowerCase().includes(query.toLowerCase()),
    ).slice(0, limit);
  };

  const browseResult = await searchAdminCatalog(
    { admin, type: "collection", query: "", limit: 10 },
    { searchImportedCollections: mockSearchCollections },
  );
  assert.equal(browseResult.length, 1);
  assert.equal(graphqlCallCount, 0);

  const searchResult = await searchAdminCatalog(
    { admin, type: "collection", query: "spring", limit: 5 },
    { searchImportedCollections: mockSearchCollections },
  );
  assert.equal(graphqlCallCount, 0);
  assert.deepEqual(searchResult, [
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
