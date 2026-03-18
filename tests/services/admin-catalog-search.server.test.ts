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
