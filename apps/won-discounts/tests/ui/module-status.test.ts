import assert from "node:assert/strict";
import { test } from "node:test";

import {
  campaignsStatus,
  codesStatus,
  marginStatus,
  moduleState,
  moduleStateLabel,
  moduleStatuses,
  outletStatus,
  rewardsGiftStatus,
  rewardsShippingStatus,
  rewardsStatus,
  storeStatuses,
  tiersGlobalStatus,
  tiersSetsStatus,
  tiersStatus,
  writtenOf,
} from "../../app/components/model/module-status.ts";
import type {
  AdminSignals,
  CampaignsOverviewView,
  MarginOverviewView,
  OutletOverviewView,
  RewardsOverviewView,
  SyncView,
  TiersOverviewView,
} from "../../app/components/model/types.ts";
import { NOT_WIRED_SIGNALS } from "../../app/components/model/signals.ts";
import { translator } from "../../app/i18n/index.ts";

// Feedback 3, body 1 a 8: ONE function says whether a module runs — saved, written to Shopify and run by the
// plan → "Aktivní". The home tile and the module page read the same function, so they cannot disagree.

const OK: SyncView = { state: "ok", at: "2026-09-28T16:20:00" };
const FAILED: SyncView = { state: "error", at: "2026-09-28T16:20:00", problems: [] };
const PENDING: SyncView = { state: "pending" };

const GLOBAL_SET = { id: "g", scope: { kind: "global" as const }, countAcross: "product" as const, breaks: [{ id: "b", minQty: 3, value: { type: "percentage" as const, percent: 10 } }] };
const tiers = (over: Partial<TiersOverviewView> = {}): TiersOverviewView => ({ sets: 0, global: GLOBAL_SET as unknown as TiersOverviewView["global"], block: { state: "on", themeName: "Horizon" }, ...over });
const rewards = (over: Partial<RewardsOverviewView> = {}): RewardsOverviewView => ({ shipping: 150000, gifts: [200000], currency: "CZK", ...over });
const outlet = (over: Partial<OutletOverviewView> = {}): OutletOverviewView => ({ running: 1, pendingReturns: [], oversold: 0, problems: 0, ordersCounted: true, ...over });
const campaigns = (over: Partial<CampaignsOverviewView> = {}): CampaignsOverviewView => ({ running: { name: "BF", endText: "30. 11." }, next: null, finishing: false, ...over });
const margin = (over: Partial<MarginOverviewView> = {}): MarginOverviewView => ({ enabled: true, minMarginPercent: 20, maxDiscountPercent: 30, productsWithoutCost: 0, mirror: { state: "fresh", at: "2026-09-28T06:10:00" }, ...over });

test("writtenOf: only a settled sync counts as written; a failed or blocked one is a problem, anything else waits", () => {
  assert.equal(writtenOf(OK), "yes");
  assert.equal(writtenOf({ ...OK, attention: [{ key: "overview.sync.pending" }] } as SyncView), "failed");
  assert.equal(writtenOf(FAILED), "failed");
  assert.equal(writtenOf({ state: "blocked", reason: "unreadable_config" }), "failed");
  assert.equal(writtenOf(PENDING), "waiting");
  assert.equal(writtenOf({ state: "running" }), "waiting");
  assert.equal(writtenOf({ state: "not_wired" }), "waiting");
});

test("moduleState: active = saved + written + run by the plan", () => {
  assert.deepEqual(moduleState({ on: true }), { state: "active", issues: 0 });
  assert.deepEqual(moduleState({ on: false }), { state: "inactive", issues: 0 });
  // Saved but not in Shopify yet: not active (§12), and not an alarm either.
  assert.deepEqual(moduleState({ on: true, written: "waiting" }), { state: "inactive", issues: 0 });
  assert.deepEqual(moduleState({ on: true, written: "failed" }), { state: "attention", issues: 1 });
  assert.deepEqual(moduleState({ on: true, broken: true, issues: 2 }), { state: "attention", issues: 2 });
  // The plan does not run it: locked, whatever is stored.
  assert.deepEqual(moduleState({ on: true, planRuns: false, issues: 3 }), { state: "locked", issues: 0 });
  // Something to resolve does not take the green label away while the module runs.
  assert.deepEqual(moduleState({ on: true, issues: 1 }), { state: "active", issues: 1 });
});

test("Množstevní slevy: on / off / exceptions only / failed write; a missing table is something to resolve, not 'inactive'", () => {
  assert.equal(tiersStatus(tiers(), OK).state, "active");
  assert.equal(tiersStatus(tiers({ global: null }), OK).state, "inactive");
  assert.equal(tiersStatus(tiers({ global: null, sets: 2 }), OK).state, "active");
  assert.equal(tiersStatus(tiers(), FAILED).state, "attention");
  assert.equal(tiersStatus(tiers(), PENDING).state, "inactive");
  assert.deepEqual(tiersStatus(tiers({ block: { state: "off", addUrl: null } }), OK), { state: "active", issues: 1 });
  // The two sections of the page.
  assert.equal(tiersGlobalStatus(tiers({ global: null, sets: 2 }), OK).state, "inactive");
  assert.equal(tiersSetsStatus(tiers({ sets: 2 }), OK, "pro").state, "active");
  assert.equal(tiersSetsStatus(tiers({ sets: 0 }), OK, "pro").state, "inactive");
  assert.equal(tiersSetsStatus(tiers({ sets: 0 }), OK, "free").state, "locked");
});

test("Odměny (bod 8): free shipping and the gift each say 'Aktivní' when they run", () => {
  assert.equal(rewardsShippingStatus(rewards(), OK).state, "active");
  assert.equal(rewardsShippingStatus(rewards({ shipping: null }), OK).state, "inactive");
  assert.equal(rewardsGiftStatus(rewards(), OK).state, "active");
  assert.equal(rewardsGiftStatus(rewards({ gifts: [] }), OK).state, "inactive");
  // A gift threshold without an amount in the shop currency: runs elsewhere, one thing to resolve.
  assert.deepEqual(rewardsGiftStatus(rewards({ gifts: [200000, null] }), OK), { state: "active", issues: 1 });
  assert.equal(rewardsStatus(rewards({ shipping: null }), OK).state, "active");
  assert.equal(rewardsStatus(rewards({ shipping: null, gifts: [] }), OK).state, "inactive");
  assert.equal(rewardsStatus(rewards(), FAILED).state, "attention");
});

test("Výprodej and Kampaně are Pro: locked on Free unless something still runs", () => {
  assert.equal(outletStatus(outlet(), "pro").state, "active");
  assert.equal(outletStatus(outlet({ running: 0 }), "pro").state, "inactive");
  assert.equal(outletStatus(outlet({ running: 0 }), "free").state, "locked");
  // A sale that still runs after a downgrade is said as it is.
  assert.equal(outletStatus(outlet(), "free").state, "active");
  assert.deepEqual(outletStatus(outlet({ problems: 1, oversold: 1, pendingReturns: [{ runId: "r", title: "T", qty: 2 }] }), "pro"), { state: "attention", issues: 3 });

  assert.equal(campaignsStatus(campaigns(), "pro").state, "active");
  assert.equal(campaignsStatus(campaigns({ running: null, next: { name: "BF", startText: "27. 11." } }), "pro").state, "inactive");
  assert.equal(campaignsStatus(campaigns({ running: null }), "free").state, "locked");
  assert.deepEqual(campaignsStatus(campaigns({ finishing: true }), "free"), { state: "active", issues: 1 });
});

test("Ochrana marže (bod 1): switched on and written = 'Aktivní', also before the costs are read; a failed read needs attention", () => {
  assert.equal(marginStatus(margin(), OK).state, "active");
  assert.equal(marginStatus(margin({ enabled: false }), OK).state, "inactive");
  // The ceiling applies from the first moment: the label is not hidden while the costs are being read.
  assert.equal(marginStatus(margin({ productsWithoutCost: null, mirror: { state: "running", done: 0, total: null, since: "2026-09-28T06:10:00" } }), OK).state, "active");
  assert.equal(marginStatus(margin({ mirror: { state: "failed", at: "2026-09-28T06:10:00", problems: [] } }), OK).state, "attention");
  assert.equal(marginStatus(margin(), FAILED).state, "attention");
  assert.deepEqual(marginStatus(margin({ tooLarge: [{ collectionId: "c", title: "Vše", count: 9000 }] }), OK), { state: "active", issues: 1 });
});

test("Slevy a kódy: active when a discount runs; the count is what needs attention", () => {
  assert.deepEqual(codesStatus([{ kind: "live" }, { kind: "no_code" }, { kind: "off" }]), { state: "active", issues: 1 });
  assert.deepEqual(codesStatus([{ kind: "no_code" }, { kind: "off" }]), { state: "attention", issues: 1 });
  assert.deepEqual(codesStatus([{ kind: "off" }, { kind: "scheduled" }]), { state: "inactive", issues: 0 });
  assert.deepEqual(codesStatus([]), { state: "inactive", issues: 0 });
});

test("moduleStatuses: every module the signals know, from the same functions", () => {
  const signals: AdminSignals = { ...NOT_WIRED_SIGNALS, sync: OK, tiers: tiers(), rewards: rewards({ shipping: null, gifts: [] }), outlet: outlet({ running: 0 }), campaigns: campaigns(), margin: margin() };
  const all = moduleStatuses(signals, { plan: "free", rules: [{ kind: "live" }] });
  assert.deepEqual(
    Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v?.state])),
    { codes: "active", tiers: "active", rewards: "inactive", outlet: "locked", campaigns: "active", margin: "active" },
  );
  // A module the signals do not know has no status (never a guess, §12).
  assert.equal(moduleStatuses({ ...NOT_WIRED_SIGNALS, sync: OK }, { plan: "pro", rules: [] }).tiers, undefined);
});

test("storeStatuses: the rules' states, their warnings and the modules' states from one set of facts", () => {
  const signals: AdminSignals = { ...NOT_WIRED_SIGNALS, sync: OK, tiers: tiers() };
  const runs = { id: "a", enabled: true, name: "Podzim", method: "automatic" as const, value: { kind: "percentage" as const, percent: 10 }, target: { kind: "order" as const } };
  const noCode = { ...runs, id: "b", name: "VIP", method: "code" as const };
  const facts = { rules: [runs, noCode], today: "2026-09-28", timezone: "Europe/Prague", signals, plan: "free" as const };
  const all = storeStatuses(facts);
  assert.deepEqual(all.rules.map((r) => r.kind), ["live", "no_code"]);
  assert.deepEqual(all.warnings.map((w) => [w.ruleId, w.kind]), [["b", "noCode"]]);
  // The same answer as moduleStatuses gets from those states: one computation, not a second one beside it.
  assert.deepEqual(all.modules, moduleStatuses(signals, { plan: "free", rules: all.rules, warned: [0, 1] }));
  assert.deepEqual(all.modules.codes, { state: "active", issues: 1 });
  // Nothing runs and one discount cannot: the module needs attention. No rules at all: inactive.
  assert.equal(storeStatuses({ ...facts, rules: [noCode] }).modules.codes?.state, "attention");
  assert.deepEqual(storeStatuses({ signals }).modules.codes, { state: "inactive", issues: 0 });
  // A write that failed stops the discount and the modules that travel with it.
  const failed = storeStatuses({ ...facts, rules: [runs], signals: { ...signals, sync: FAILED } }).modules;
  assert.equal(failed.codes?.state, "attention");
  assert.equal(failed.tiers?.state, "attention");
  // The plan is not known: nothing is said to be locked.
  assert.equal(storeStatuses({ signals: { ...signals, outlet: outlet({ running: 0 }) } }).modules.outlet?.state, "inactive");
});

test("labels: 'Aktivní' / 'Active' (not 'Live'), 'Neaktivní' / 'Inactive', 'Vyžaduje pozornost' / 'Needs attention'", () => {
  const cs = translator("cs");
  const en = translator("en");
  assert.equal(moduleStateLabel("active", cs), "Aktivní");
  assert.equal(moduleStateLabel("active", en), "Active");
  assert.equal(moduleStateLabel("inactive", cs), "Neaktivní");
  assert.equal(moduleStateLabel("inactive", en), "Inactive");
  assert.equal(moduleStateLabel("attention", cs), "Vyžaduje pozornost");
  assert.equal(moduleStateLabel("attention", en), "Needs attention");
  assert.equal(en.t("common.live"), "Active");
  assert.equal(en.t("status.live"), "Active");
});
