import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiscountRule } from "@won/core/discounts/config";

import { needsResync, ruleEditHref, ruleStatus, ruleStatusSummary, statusAnchor, statusLabel, statusText, type RuleStatus } from "../../app/components/model/rule-status.ts";
import type { SyncView } from "../../app/components/model/types.ts";
import { translator } from "../../app/i18n/index.ts";

// §11d / §17c / §12: green "Běží" only for a rule that really runs — switched on,
// evaluable at checkout, inside its schedule on the shop's day, written to
// Shopify. Everything else says what it is instead.

const cs = translator("cs");
const TZ = "Europe/Prague";
const SYNCED: SyncView = { state: "ok", at: "2026-09-28T16:20:00" };
const NOT_WIRED: SyncView = { state: "not_wired" };

const rule = (partial: Partial<DiscountRule> = {}): DiscountRule => ({
  id: "r1",
  enabled: true,
  name: "Test",
  method: "automatic",
  value: { kind: "percentage", percent: 10 },
  target: { kind: "order" },
  ...partial,
});
const blackFriday = { startsAt: "2026-11-27T00:00:00+01:00", endsAt: "2026-12-01T00:00:00+01:00" };
const ctx = (today: string, sync: SyncView = SYNCED) => ({ today, timezone: TZ, sync });

test("a future schedule is 'Naplánováno od …', not 'Běží'", () => {
  const s = ruleStatus(rule({ schedule: blackFriday }), ctx("2026-09-28"));
  assert.deepEqual(s, { kind: "scheduled", date: "2026-11-27" });
  assert.equal(statusLabel(s, cs), "Naplánováno");
  assert.equal(statusText(s, cs), "Naplánováno od 27. 11. 2026");
});

test("a past schedule is 'Skončilo …'; the start and end days themselves run", () => {
  assert.deepEqual(ruleStatus(rule({ schedule: blackFriday }), ctx("2026-12-01")), { kind: "ended", date: "2026-11-30" });
  assert.equal(statusText({ kind: "ended", date: "2026-11-30" }, cs), "Skončilo 30. 11. 2026");
  assert.equal(ruleStatus(rule({ schedule: blackFriday }), ctx("2026-11-27")).kind, "live");
  assert.equal(ruleStatus(rule({ schedule: blackFriday }), ctx("2026-11-30")).kind, "live");
});

test("not synced to Shopify yet → 'Uloženo, zatím nezapsáno', never green", () => {
  const s = ruleStatus(rule(), ctx("2026-09-28", NOT_WIRED));
  assert.equal(s.kind, "not_synced");
  assert.equal(statusText(s, cs), "Uloženo, zatím nezapsáno do Shopify");
  // A failed sync says so (not "waiting").
  const failed = ruleStatus(rule(), ctx("2026-09-28", { state: "error", at: "x" }));
  assert.equal(failed.kind, "sync_failed");
  assert.match(statusText(failed, cs) ?? "", /synchronizace selhala/);
  assert.equal(ruleStatus(rule(), ctx("2026-09-28")).kind, "live");
});

test("per-rule sync facts decide over the shop's sync line (Běží = THIS version is in Shopify)", () => {
  const ok = ctx("2026-09-28");
  const r = rule();
  assert.equal(ruleStatus(r, { ...ok, ruleSync: { [r.id]: "synced" } }).kind, "live");
  assert.equal(ruleStatus(r, { ...ok, ruleSync: { [r.id]: "pending" } }).kind, "not_synced", "the shop synced, but not this version");
  assert.equal(ruleStatus(r, { ...ok, ruleSync: { [r.id]: "failed" } }).kind, "sync_failed");
  assert.equal(ruleStatus(r, { ...ok, ruleSync: {} }).kind, "not_synced", "no fact = not claimed live");
  // A code rule without a code never runs, whatever the sync says.
  const noCode = ruleStatus(rule({ method: "code", codes: [] }), { ...ok, ruleSync: { [r.id]: "synced" } });
  assert.equal(noCode.kind, "no_code");
  assert.equal(statusText(noCode, cs), "Neaktivní: sleva s kódem zatím nemá žádný kód");
  assert.equal(
    ruleStatusSummary([noCode, ruleStatus(rule({ targeting: { segments: ["s"] } }), ok)], cs),
    "2 slevy · 2 neaktivní",
    "without a code and segment-targeted both count as 'neběží'",
  );
});

test("switched off, segment-targeted, unsaved draft", () => {
  assert.equal(ruleStatus(rule({ enabled: false, schedule: blackFriday }), ctx("2026-11-28")).kind, "off");
  const seg = ruleStatus(rule({ targeting: { segments: ["gid://shopify/Segment/1"] } }), ctx("2026-09-28"));
  assert.equal(seg.kind, "unsupported");
  assert.equal(statusText(seg, cs), "Neaktivní: cílení na segmenty se v pokladně zatím neuplatní");
  assert.equal(ruleStatus(rule(), { ...ctx("2026-09-28"), draft: true }).kind, "draft");
});

test("the section summary counts real states, not `enabled`", () => {
  const statuses = [
    ruleStatus(rule(), ctx("2026-09-28")),
    ruleStatus(rule({ schedule: blackFriday }), ctx("2026-09-28")),
    ruleStatus(rule({ enabled: false }), ctx("2026-09-28")),
    ruleStatus(rule({ targeting: { segments: ["s"] } }), ctx("2026-09-28")),
  ];
  assert.equal(ruleStatusSummary(statuses, cs), "4 slevy · 1 aktivní · 1 naplánovaná · 1 neaktivní · 1 vypnutá");
  const unsynced = [rule(), rule(), rule()].map((r) => ruleStatus(r, ctx("2026-09-28", NOT_WIRED)));
  assert.equal(ruleStatusSummary(unsynced, cs), "3 slevy · 3 čekají na zápis");
});

// --- F2 item 5 (audit P2-3 / P3-6) + item 1: not running, and why ------------------------------------

test("P3-6: no products / collections picked, no value in any shop currency, only switched-off markets → 'Neběží' with the reason", () => {
  const live = { ...ctx("2026-09-28"), ruleSync: { r1: "synced" as const }, currencies: ["CZK", "EUR"], enabledMarkets: ["cz"] };
  const noTarget = ruleStatus(rule({ target: { kind: "collections", ids: [] } }), live);
  assert.deepEqual(noTarget, { kind: "no_target" });
  assert.equal(statusLabel(noTarget, cs), "Neaktivní");
  assert.equal(statusText(noTarget, cs), "Neaktivní: nemá vybrané produkty ani kolekce.");

  const noValue = ruleStatus(rule({ value: { kind: "fixed", amount: { HUF: 3000_00 } } }), live);
  assert.deepEqual(noValue, { kind: "no_value" });
  assert.equal(statusText(noValue, cs), "Neaktivní: nemá hodnotu v žádné měně obchodu.");
  assert.equal(ruleStatus(rule({ value: { kind: "fixed", amount: { CZK: 100_00 } } }), live).kind, "live", "one currency is enough");

  const marketOff = ruleStatus(rule({ targeting: { markets: ["sk"] } }), live);
  assert.deepEqual(marketOff, { kind: "market_off" });
  assert.equal(statusText(marketOff, cs), "Neaktivní: cílí jen na trhy, které jsou ve Won vypnuté.");
  assert.equal(ruleStatus(rule({ targeting: { markets: ["sk", "cz"] } }), live).kind, "live");
});

test("BILL-1: a rule the plan switches off is 'Neběží' (pro_off), counted with the ones that do not run", () => {
  const s = ruleStatus(rule({ targeting: { markets: ["sk"] } }), { ...ctx("2026-09-28"), ruleSync: { r1: "synced" }, gateOff: ["r1"] });
  assert.deepEqual(s, { kind: "pro_off" });
  assert.equal(statusText(s, cs), "Neaktivní: používá funkci Pro, kterou váš tarif v pokladně nespouští.");
  assert.equal(ruleStatusSummary([s, { kind: "live" }], cs), "2 slevy · 1 aktivní · 1 neaktivní");
});

test("items 2 + 7: a rule whose product targeting is being written is 'Propisuje se', neither green nor red", () => {
  const s = ruleStatus(rule({ target: { kind: "collections", ids: ["gid://shopify/Collection/1"] } }), {
    ...ctx("2026-09-28"),
    ruleSync: { r1: "refreshing" },
  });
  assert.deepEqual(s, { kind: "refreshing" });
  assert.equal(statusLabel(s, cs), "Propisuje se");
  assert.match(statusText(s, cs) ?? "", /cílení na produkty se právě zapisuje/);
  assert.equal(ruleStatusSummary([s, s, { kind: "live" }], cs), "3 slevy · 1 aktivní · 2 se zapisují");
});

// --- P3: the field that fixes a rule which does not run ---------------------------------------------

test("P3: every 'does not run' status names the editor field that fixes it; the list's edit link lands there", () => {
  const C = ["CZK", "EUR"];
  const anchorOf = (r: DiscountRule, s: RuleStatus) => statusAnchor(s, r, C);
  assert.equal(anchorOf(rule({ method: "code", codes: [] }), { kind: "no_code" }), "codes");
  assert.equal(anchorOf(rule({ target: { kind: "products", productIds: [], variantIds: [] } }), { kind: "no_target" }), "target");
  assert.equal(anchorOf(rule({ value: { kind: "fixed", amount: {} } }), { kind: "no_value" }), "value");
  // A percentage with a minimum in no shop currency: the empty field is the minimum, not the value.
  assert.equal(anchorOf(rule({ minimum: { subtotal: { HUF: 100 } } }), { kind: "no_value" }), "conditions");
  assert.equal(anchorOf(rule({ targeting: { markets: ["hu"] } }), { kind: "market_off" }), "markets");
  assert.equal(anchorOf(rule({ targeting: { markets: ["sk"] } }), { kind: "pro_off" }), "markets");
  assert.equal(anchorOf(rule({ targeting: { segments: ["gid://shopify/Segment/1"] } }), { kind: "pro_off" }), "segments");
  assert.equal(anchorOf(rule({ targeting: { segments: ["gid://shopify/Segment/1"] } }), { kind: "unsupported" }), "segments");
  assert.equal(anchorOf(rule(), { kind: "scheduled", date: "2026-11-27" }), "schedule");
  assert.equal(anchorOf(rule(), { kind: "ended", date: "2026-11-27" }), "schedule");
  // Nothing to fix in a field: switched off, running, a draft, waiting for / failed sync (those get "Synchronizovat znovu").
  for (const kind of ["live", "off", "draft", "refreshing", "not_synced", "sync_failed"] as const) {
    assert.equal(anchorOf(rule(), { kind }), null, kind);
  }
  assert.equal(needsResync({ kind: "sync_failed" }), true);
  assert.equal(needsResync({ kind: "not_synced" }), true);
  assert.equal(needsResync({ kind: "no_code" }), false);

  assert.equal(ruleEditHref(rule({ id: "a b", method: "code", codes: [] }), { kind: "no_code" }, C), "/app/discounts/a%20b#codes");
  assert.equal(ruleEditHref(rule(), { kind: "live" }, C), "/app/discounts/r1");
  // Runs, but not in EUR: the link goes to the empty amount (or the empty minimum).
  assert.equal(ruleEditHref(rule({ value: { kind: "fixed", amount: { CZK: 100 } } }), { kind: "live" }, C), "/app/discounts/r1#value");
  assert.equal(ruleEditHref(rule({ minimum: { subtotal: { CZK: 100 } } }), { kind: "live" }, C), "/app/discounts/r1#conditions");
  // A scheduled rule opens at its dates — unless a currency value is missing, which is the thing to fix.
  assert.equal(ruleEditHref(rule(), { kind: "scheduled", date: "2026-11-27" }, C), "/app/discounts/r1#schedule");
  assert.equal(ruleEditHref(rule({ value: { kind: "fixed", amount: { CZK: 100 } } }), { kind: "scheduled", date: "2026-11-27" }, C), "/app/discounts/r1#value");
  assert.equal(ruleEditHref(rule({ enabled: false, value: { kind: "fixed", amount: { CZK: 100 } } }), { kind: "off" }, C), "/app/discounts/r1");
});
