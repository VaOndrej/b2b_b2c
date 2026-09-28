// Input query limits (shopify.dev/docs/api/functions/2026-04, "Input query
// limits"): calculated cost ≤ 30 and ≤ 3000 bytes excluding comments. The cost
// is computed from the query document with the published cost table — the same
// arithmetic as the "Cost: N of 30" line in each query's header comment, which
// this test keeps honest.
//
//   field returning a Metafield            3   (fields on Metafield: 0)
//   hasAnyTag / hasTags / inAnyCollection /
//   inCollections                          3
//   __typename                             0
//   any other leaf (scalar / enum)         1
//   container (object) fields              0

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema, getNamedType, isLeafType, parse, TypeInfo, visit, visitWithTypeInfo } from "graphql";
import { describe, expect, test } from "vitest";

const EXT_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = buildSchema(readFileSync(path.join(EXT_DIR, "schema.graphql"), "utf8"));

const COST_3_FIELDS = new Set(["hasAnyTag", "hasTags", "inAnyCollection", "inCollections"]);

/** @param {string} source */
export function inputQueryCost(source) {
  const typeInfo = new TypeInfo(schema);
  /** @type {{ path: string, cost: number }[]} */
  const items = [];
  /** @type {string[]} */
  const stack = [];
  visit(
    parse(source),
    visitWithTypeInfo(typeInfo, {
      Field: {
        enter(node) {
          const name = node.alias ? `${node.alias.value}:${node.name.value}` : node.name.value;
          stack.push(name);
          if (node.name.value === "__typename") return;
          const parent = typeInfo.getParentType();
          const def = typeInfo.getFieldDef();
          if (!def) throw new Error(`unknown field ${stack.join(".")}`);
          const type = getNamedType(def.type);
          let cost = 0;
          if (parent?.name === "Metafield") cost = 0;
          else if (type.name === "Metafield" || COST_3_FIELDS.has(node.name.value)) cost = 3;
          else if (isLeafType(type)) cost = 1;
          if (cost > 0) items.push({ path: stack.join("."), cost });
        },
        leave() {
          stack.pop();
        },
      },
    }),
  );
  return { cost: items.reduce((sum, item) => sum + item.cost, 0), items };
}

const QUERIES = [
  { file: "src/cart_lines_discounts_generate_run.graphql", expected: 22 },
  { file: "src/cart_delivery_options_discounts_generate_run.graphql", expected: 23 },
];

describe("input query limits", () => {
  for (const { file, expected } of QUERIES) {
    const source = readFileSync(path.join(EXT_DIR, file), "utf8");

    test(`${file}: cost ${expected} ≤ 30, and the header comment states it`, () => {
      const { cost } = inputQueryCost(source);
      expect(cost).toBe(expected);
      expect(cost).toBeLessThanOrEqual(30);
      expect(source).toContain(`Cost (shopify.dev input query cost table): ${cost} of 30.`);
    });

    test(`${file}: ≤ 3000 bytes without comments`, () => {
      const withoutComments = source.replace(/^\s*#.*$/gm, "");
      expect(new TextEncoder().encode(withoutComments).length).toBeLessThanOrEqual(3000);
    });
  }

  test("the cost table: metafield 3, fields on it 0, __typename 0, leaves 1, containers 0", () => {
    const { cost, items } = inputQueryCost(`query Q {
      cart { lines { id merchandise { __typename ... on ProductVariant { product { m: metafield(key: "k") { jsonValue } } } } } }
    }`);
    expect(items).toEqual([
      { path: "cart.lines.id", cost: 1 },
      { path: "cart.lines.merchandise.product.m:metafield", cost: 3 },
    ]);
    expect(cost).toBe(4);
  });
});
