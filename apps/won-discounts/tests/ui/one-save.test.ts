import assert from "node:assert/strict";
import { test } from "node:test";

import { partField, planSave, sameEntries, splitSave } from "../../app/components/model/one-save.ts";

// One save per page: the page's form is split into the page's own fields and each part's (Sčítá se s), and only what
// changed is posted.

const form = (combine: string[], level = "10"): [string, string][] => [
  ["intent", "save"],
  ["configVersion", "v1"],
  ["tiers.g.row", level],
  [partField("combine", "combinePosted"), "1"],
  ...combine.map((type): [string, string] => [partField("combine", "combineTypes"), type]),
];

test("the form splits into the page's fields and the part's, names without the prefix, files dropped", () => {
  const split = splitSave([...form(["code", "shipping"]), ["file", new Blob(["x"]) as unknown as File]]);
  assert.deepEqual(split.page, [
    ["intent", "save"],
    ["configVersion", "v1"],
    ["tiers.g.row", "10"],
  ]);
  assert.deepEqual(split.parts.get("combine"), [
    ["combinePosted", "1"],
    ["combineTypes", "code"],
    ["combineTypes", "shipping"],
  ]);
  // A malformed prefix stays the page's.
  assert.deepEqual(splitSave([["part:nokey", "1"]]).page, [["part:nokey", "1"]]);
});

test("the same fields in another order are the same", () => {
  assert.ok(sameEntries([["a", "1"], ["b", "2"]], [["b", "2"], ["a", "1"]]));
  assert.ok(!sameEntries([["a", "1"]], [["a", "1"], ["a", "1"]]));
});

test("a save posts what changed: the level alone, Sčítá se s alone, or both — the page first", () => {
  const base = splitSave(form(["code"]));
  assert.deepEqual(planSave(splitSave(form(["code"], "15")), base, ["combine"]), { page: true, parts: [] });
  assert.deepEqual(planSave(splitSave(form(["code", "shipping"])), base, ["combine"]), { page: false, parts: ["combine"] });
  assert.deepEqual(planSave(splitSave(form([], "15")), base, ["combine"]), { page: true, parts: ["combine"] });
  // Nothing changed: the page alone, as a save always did.
  assert.deepEqual(planSave(splitSave(form(["code"])), base, ["combine"]), { page: true, parts: [] });
});

test("without a baseline everything in the form is posted; a part not in the form never is", () => {
  assert.deepEqual(planSave(splitSave(form(["code"])), null, ["combine", "look"]), { page: true, parts: ["combine"] });
});
