import assert from "node:assert/strict";
import { test } from "node:test";

import { describeConfigDiff, recommendGating } from "../../src/toasts/config-diff.ts";

test("no changes → empty diff", () => {
  const cfg = { enabled: true, global: { durationMs: 5000 } };
  assert.deepEqual(describeConfigDiff(cfg, cfg), []);
});

test("a changed scalar yields one human-readable change", () => {
  const changes = describeConfigDiff(
    { global: { durationMs: 5000 } },
    { global: { durationMs: 3000 } },
  );
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, "global.durationMs");
  assert.match(changes[0].summary, /5000/);
  assert.match(changes[0].summary, /3000/);
});

test("toggling enabled reads in plain language", () => {
  const off = describeConfigDiff({ enabled: true }, { enabled: false });
  assert.equal(off.length, 1);
  assert.match(off[0].summary.toLowerCase(), /off|disabled|turned/);
});

test("adding a notification rule is reported as an add, not a deep index diff", () => {
  const before = { notifications: [{ id: "a", type: "countdown" }] };
  const after = {
    notifications: [
      { id: "a", type: "countdown" },
      { id: "b", type: "announcement" },
    ],
  };
  const changes = describeConfigDiff(before, after);
  const added = changes.find((c) => c.path === "notifications" && /add/i.test(c.summary));
  assert.ok(added, "expected an 'added' summary for notifications");
  assert.match(added!.summary, /announcement/);
});

test("removing an array item is reported as a removal", () => {
  const before = { milestones: [{ id: "fs", kind: "free_shipping" }, { id: "g", kind: "gift" }] };
  const after = { milestones: [{ id: "fs", kind: "free_shipping" }] };
  const changes = describeConfigDiff(before, after);
  const removed = changes.find((c) => c.path === "milestones" && /remov/i.test(c.summary));
  assert.ok(removed);
});

test("recommendGating: impactful change (timing) defaults to Test first", () => {
  const changes = describeConfigDiff({ global: { durationMs: 5000 } }, { global: { durationMs: 2000 } });
  assert.equal(recommendGating(changes), "test_first");
});

test("recommendGating: cosmetic change (colour/copy) defaults to Apply now", () => {
  const changes = describeConfigDiff(
    { theme: { colorBg: "#fff" }, messages: { added: { en: "Added" } } },
    { theme: { colorBg: "#000" }, messages: { added: { en: "In your cart" } } },
  );
  assert.equal(recommendGating(changes), "apply_now");
});

test("recommendGating: any impactful change forces Test first even amid cosmetics", () => {
  const changes = describeConfigDiff(
    { theme: { colorBg: "#fff" }, notifications: [] },
    { theme: { colorBg: "#000" }, notifications: [{ id: "n", type: "countdown" }] },
  );
  assert.equal(recommendGating(changes), "test_first");
});

test("recommendGating: no changes → Apply now", () => {
  assert.equal(recommendGating([]), "apply_now");
});

test("diff is deterministic (stable order by path)", () => {
  const a = describeConfigDiff(
    { global: { durationMs: 1 }, enabled: true },
    { global: { durationMs: 2 }, enabled: false },
  );
  const paths = a.map((c) => c.path);
  assert.deepEqual(paths, [...paths].sort());
});
