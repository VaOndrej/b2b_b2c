import assert from "node:assert/strict";
import { test } from "node:test";

import { ruleNeedsFixing, ruleTabCounts, ruleTabOf, visibleRules, type RuleTableRow, type RuleTableView } from "../../app/components/model/rule-table.ts";

// "Vaše slevy": the tabs, the search, the filter and the sort over the rows of the page.

const row = (name: string, kind: RuleTableRow["status"]["kind"], over: Partial<RuleTableRow> = {}): RuleTableRow => ({
  id: name,
  name,
  what: "10 % z objednávky",
  how: "Automaticky",
  code: false,
  valid: "Bez konce",
  until: null,
  status: { kind },
  href: `/app/discounts/${name}`,
  ...over,
});

const ROWS = [
  row("Vypnutá", "off"),
  row("Běží", "live", { until: "2026-11-30" }),
  row("Čeká", "scheduled", { until: "2026-11-02" }),
  row("Kód", "live", { code: true, how: "Kód VIP10" }),
  row("Chybí euro", "live", { attention: "Nemá hodnotu pro Slovensko." }),
  row("Skončila", "ended"),
  row("Zapisuje se", "not_synced"),
];
const VIEW: RuleTableView = { tab: "all", query: "", method: "all", sort: "state", dir: 1 };
const names = (view: Partial<RuleTableView>) => visibleRules(ROWS, { ...VIEW, ...view }, "cs").map((r) => r.name);

test("a rule with something to fix is under Vyžaduje pozornost and still under the state its label says", () => {
  assert.deepEqual(names({ tab: "attention" }), ["Chybí euro"]);
  assert.deepEqual(names({ tab: "live" }), ["Chybí euro", "Běží", "Kód"]);
  const planned = [row("Pátek", "scheduled", { attention: "Nemá hodnotu pro Slovensko." })];
  assert.deepEqual(ruleTabCounts(planned), { all: 1, attention: 1, live: 0, scheduled: 1, off: 0, ended: 0 });
  assert.ok(ruleNeedsFixing(row("x", "no_code")));
});

test("a rule on its way to Shopify is only under Vše: no tab claims it runs or is off", () => {
  assert.equal(ruleTabOf(row("x", "not_synced")), null);
  assert.deepEqual(ruleTabCounts(ROWS), { all: 7, attention: 1, live: 3, scheduled: 1, off: 1, ended: 1 });
});

test("the state sort puts what needs attention first, then what runs", () => {
  assert.deepEqual(names({}), ["Chybí euro", "Běží", "Kód", "Čeká", "Vypnutá", "Skončila", "Zapisuje se"]);
  assert.equal(names({ dir: -1 })[0], "Zapisuje se");
});

test("the tab, the filter and the search narrow together", () => {
  assert.deepEqual(names({ tab: "live", method: "code" }), ["Kód"]);
  assert.deepEqual(names({ query: " vip10 " }), ["Kód"]);
  assert.deepEqual(names({ tab: "off", query: "vip" }), []);
});

test("sorting by the end date leaves the rules without an end last", () => {
  assert.deepEqual(names({ sort: "until" }).slice(0, 2), ["Čeká", "Běží"]);
});
