import assert from "node:assert/strict";
import { test } from "node:test";

import { translator } from "../../app/i18n/index.ts";
import { moduleBadge, placementBadge, ruleBadge, switchBadge } from "../../app/components/model/status-badge.ts";
import type { RuleStatus } from "../../app/components/model/rule-status.ts";

// The one status badge: what each state says and in which tone (model/status-badge.ts).

const cs = translator("cs");

test("a module: Aktivní green, Vyžaduje pozornost red, Neaktivní grey; locked has no badge (the Pro marker says it)", () => {
  assert.deepEqual(moduleBadge("active", cs), { tone: "live", label: "Aktivní" });
  assert.deepEqual(moduleBadge("attention", cs), { tone: "attention", label: "Vyžaduje pozornost" });
  assert.deepEqual(moduleBadge("inactive", cs), { tone: "neutral", label: "Neaktivní" });
  assert.equal(moduleBadge("locked", cs), null);
});

test("a discount: Aktivní green, Neuplatní se red, Naplánováno light orange, Vypnuto grey", () => {
  const badge = (status: RuleStatus) => ruleBadge(status, cs);
  assert.deepEqual(badge({ kind: "live" } as RuleStatus), { tone: "live", label: "Aktivní" });
  assert.deepEqual(badge({ kind: "no_target" } as RuleStatus), { tone: "attention", label: "Neuplatní se" });
  assert.deepEqual(badge({ kind: "scheduled", from: "2026-11-27" } as unknown as RuleStatus), { tone: "scheduled", label: "Naplánováno" });
  assert.deepEqual(badge({ kind: "off" } as RuleStatus), { tone: "neutral", label: "Vypnuto" });
});

test("a switch and a piece in the theme", () => {
  assert.deepEqual(switchBadge(true, cs), { tone: "live", label: "Aktivní" });
  assert.equal(switchBadge(false, cs).tone, "neutral");
  assert.equal(placementBadge("in_theme", false, cs).tone, "live");
  assert.deepEqual([placementBadge("in_theme", true, cs).tone, placementBadge("in_theme", true, cs).marker], ["warning", "misplaced"]);
  assert.equal(placementBadge("missing", false, cs).tone, "attention");
  assert.equal(placementBadge("unknown", false, cs).tone, "neutral");
});
