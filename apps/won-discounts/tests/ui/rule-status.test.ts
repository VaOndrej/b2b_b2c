import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiscountRule } from "@won/core/discounts/config";

import { ruleStatus, ruleStatusSummary, statusLabel, statusText } from "../../app/components/model/rule-status.ts";
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

test("not synced to Shopify yet → 'Uloženo, zatím nepropsáno', never green", () => {
  const s = ruleStatus(rule(), ctx("2026-09-28", NOT_WIRED));
  assert.equal(s.kind, "not_synced");
  assert.equal(statusText(s, cs), "Uloženo, zatím nepropsáno do Shopify");
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
  assert.equal(statusText(noCode, cs), "Neběží: sleva s kódem zatím nemá žádný kód");
  assert.equal(
    ruleStatusSummary([noCode, ruleStatus(rule({ targeting: { segments: ["s"] } }), ok)], cs),
    "2 slevy · 2 neběží",
    "without a code and segment-targeted both count as 'neběží'",
  );
});

test("switched off, segment-targeted, unsaved draft", () => {
  assert.equal(ruleStatus(rule({ enabled: false, schedule: blackFriday }), ctx("2026-11-28")).kind, "off");
  const seg = ruleStatus(rule({ targeting: { segments: ["gid://shopify/Segment/1"] } }), ctx("2026-09-28"));
  assert.equal(seg.kind, "unsupported");
  assert.equal(statusText(seg, cs), "Neběží: cílení na segmenty se v pokladně zatím neuplatní");
  assert.equal(ruleStatus(rule(), { ...ctx("2026-09-28"), draft: true }).kind, "draft");
});

test("the section summary counts real states, not `enabled`", () => {
  const statuses = [
    ruleStatus(rule(), ctx("2026-09-28")),
    ruleStatus(rule({ schedule: blackFriday }), ctx("2026-09-28")),
    ruleStatus(rule({ enabled: false }), ctx("2026-09-28")),
    ruleStatus(rule({ targeting: { segments: ["s"] } }), ctx("2026-09-28")),
  ];
  assert.equal(ruleStatusSummary(statuses, cs), "4 slevy · 1 běží · 1 naplánovaná · 1 neběží · 1 vypnutá");
  const unsynced = [rule(), rule(), rule()].map((r) => ruleStatus(r, ctx("2026-09-28", NOT_WIRED)));
  assert.equal(ruleStatusSummary(unsynced, cs), "3 slevy · 3 čekají na propsání");
});
