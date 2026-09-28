import assert from "node:assert/strict";
import { test } from "node:test";

import { Kind, parse, type FieldNode, type SelectionSetNode } from "graphql";

import { GQL } from "../../../app/lib/sync/graphql.ts";
import { NODES_BATCH } from "../../../app/lib/sync/util.ts";

// I1: Shopify refuses a query whose REQUESTED cost exceeds 1 000 points,
// before executing it (https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits).
// Defaults from that page: scalar/enum 0, object 1, interface/union = max of
// the possible selections, connection "sized by first and last" (2 + first ×
// node cost; example products(first: 1){edges{node{title}}} = 3), mutation 10.
// `nodes(ids:)` is sized conservatively by the batch the sync sends (NODES_BATCH).

const CAP = 1000;

function intArg(field: FieldNode, name: string): number | null {
  const arg = field.arguments?.find((a) => a.name.value === name);
  return arg && arg.value.kind === Kind.INT ? Number(arg.value.value) : null;
}

function selectionCost(set: SelectionSetNode | undefined): number {
  if (!set) return 0;
  let fields = 0;
  let fragments = 0;
  for (const selection of set.selections) {
    if (selection.kind === Kind.FIELD) fields += fieldCost(selection);
    else if (selection.kind === Kind.INLINE_FRAGMENT) fragments = Math.max(fragments, selectionCost(selection.selectionSet));
  }
  return fields + fragments;
}

function fieldCost(field: FieldNode): number {
  if (!field.selectionSet) return 0; // scalar / enum / __typename
  const size = intArg(field, "first") ?? intArg(field, "last");
  if (size !== null) {
    let perNode = 0;
    let once = 0;
    for (const s of field.selectionSet.selections) {
      if (s.kind !== Kind.FIELD) continue;
      if (s.name.value === "pageInfo") once += 1;
      else if (s.name.value === "nodes") perNode += 1 + selectionCost(s.selectionSet);
      else if (s.name.value === "edges") perNode += selectionCost(s.selectionSet); // edges { node { … } }: node counts 1
      else perNode += fieldCost(s);
    }
    return 2 + size * perNode + once;
  }
  const list = field.arguments?.some((a) => a.name.value === "ids") ? NODES_BATCH : 1;
  return list * (1 + selectionCost(field.selectionSet));
}

export function requestedCost(document: string): number {
  const ast = parse(document);
  let total = 0;
  for (const def of ast.definitions) {
    if (def.kind !== Kind.OPERATION_DEFINITION) continue;
    for (const s of def.selectionSet.selections) {
      if (s.kind !== Kind.FIELD) continue;
      total += def.operation === "mutation" ? 10 + selectionCost(s.selectionSet) : fieldCost(s);
    }
  }
  return total;
}

test("the estimator reproduces Shopify's documented example (products(first: 1){edges{node{title}}} = 3)", () => {
  assert.equal(requestedCost("query { products(first: 1) { edges { node { title } } } }"), 3);
});

test("every document the sync sends requests ≤ 1 000 points", () => {
  const costs = Object.entries(GQL).map(([name, doc]) => [name, requestedCost(doc)] as const);
  const over = costs.filter(([, cost]) => cost > CAP);
  assert.deepEqual(over, [], JSON.stringify(costs));
  const byName = Object.fromEntries(costs);
  assert.ok(byName.markets! <= 50, `markets page ${byName.markets}`);
  assert.ok(byName.marketRegions! <= 100, `market regions page ${byName.marketRegions}`);
});

test("negative control: the old markets(first: 50) × regions(first: 250) shape is ~12 800 points", () => {
  const old = `query WonSyncMarketsOld($after: String) {
  markets(first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      handle name status
      currencySettings { baseCurrency { currencyCode } }
      conditions { regionsCondition { regions(first: 250) { nodes { __typename ... on MarketRegionCountry { code } } } } }
    }
  }
}`;
  const cost = requestedCost(old);
  assert.ok(cost > 12_000, `old markets cost ${cost}`);
});
