import assert from "node:assert/strict";
import { test } from "node:test";

import { groupAttention, ruleWarningCause, type AttentionItem } from "../../app/components/model/attention.ts";

// Přehled, "Vyžaduje pozornost": one row per cause.

const item = (key: string, cause: string): AttentionItem => ({ key, cause, text: key, name: key, href: `/app/discounts/${key}` });

test("the same cause is one row with every thing in it; different causes are different rows, in order", () => {
  const groups = groupAttention([item("a", "missingCurrency:EUR"), item("b", "noCode"), item("c", "missingCurrency:EUR"), item("ship", "ship")]);
  assert.deepEqual(
    groups.map((g) => [g.cause, g.items.map((i) => i.key)]),
    [
      ["missingCurrency:EUR", ["a", "c"]],
      ["noCode", ["b"]],
      ["ship", ["ship"]],
    ],
  );
  assert.deepEqual(groupAttention([]), []);
});

test("a missing amount is one cause per set of currencies, whatever their order; other warnings by kind", () => {
  assert.equal(ruleWarningCause("missingCurrency", ["HUF", "EUR"]), ruleWarningCause("missingCurrency", ["EUR", "HUF"]));
  assert.notEqual(ruleWarningCause("missingCurrency", ["EUR"]), ruleWarningCause("missingCurrency", ["EUR", "HUF"]));
  assert.equal(ruleWarningCause("noCode", ["EUR"]), "noCode");
});
