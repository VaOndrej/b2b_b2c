import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isFreshMilestone,
  milestoneState,
} from "../../src/toasts/milestones.ts";

const T = 1500;

test("crossing up once fires just_reached, staying above is reached", () => {
  assert.equal(milestoneState(1400, 1500, T).state, "just_reached");
  assert.equal(milestoneState(1500, 1600, T).state, "reached");
});

test("dropping below after being above fires just_lost", () => {
  assert.equal(milestoneState(1600, 1400, T).state, "just_lost");
});

test("re-crossing after a loss fires just_reached again", () => {
  assert.equal(milestoneState(1400, 1550, T).state, "just_reached");
});

test("approaching begins at the approach ratio, else unreached", () => {
  assert.equal(milestoneState(0, 1200, T).state, "approaching"); // 0.8 * 1500
  assert.equal(milestoneState(0, 900, T).state, "unreached");
});

test("remaining and progress are reported", () => {
  const r = milestoneState(0, 1000, T);
  assert.equal(r.remaining, 500);
  assert.ok(Math.abs(r.progress - 1000 / 1500) < 1e-9);
  assert.equal(milestoneState(0, 2000, T).remaining, 0);
  assert.equal(milestoneState(0, 2000, T).progress, 1);
});

test("threshold <= 0 is treated as 1 (no division by zero)", () => {
  // safe threshold becomes 1, so value 0 is unreached and value >= 1 reaches it
  assert.equal(milestoneState(0, 0, 0).state, "unreached");
  assert.equal(milestoneState(0, 1, 0).state, "just_reached");
  assert.equal(milestoneState(0, 1, 0).progress, 1);
});

test("only just_reached is a fresh milestone", () => {
  assert.equal(isFreshMilestone("just_reached"), true);
  assert.equal(isFreshMilestone("reached"), false);
  assert.equal(isFreshMilestone("approaching"), false);
});
