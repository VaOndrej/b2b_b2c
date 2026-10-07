// The admin preview (MVP 3) imports the storefront CSS / locales with Vite `?raw`: node needs the hook first.
import "./support/raw-import.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiscountRule } from "@won/core/discounts/config";

import { collectWarnings } from "../../app/components/model/describe.ts";
import { nativeAdminUrl, nativeNeedsSection, nativeOutsideCount, NOT_WIRED_SIGNALS, statusAllGood, statusSummary } from "../../app/components/model/signals.ts";
import type { AdminSignals, NativeView, TryCartLineView } from "../../app/components/model/types.ts";
import { onboardingHasNative, onboardingProgress, onboardingStep, onboardingSteps } from "../../app/components/screens/OnboardingScreen.tsx";
import { ruleFix } from "../../app/components/screens/OverviewScreen.tsx";
import { cartSnapshot, lineLabel, reconcileLines, ruleBlockedReason, type TryCartRuleView } from "../../app/components/screens/TryCartScreen.tsx";
import { translator } from "../../app/i18n/index.ts";

// Plan 6 Oct 2026, batch 7 (Přehled, onboarding, Vyzkoušet košík): the pure decisions behind the screens.

const tr = translator("cs");

const NATIVE = { id: "gid://shopify/DiscountCodeNode/1001", title: "LETO15", method: "code" as const, movable: true, losses: [] };
const MOVED = { backupId: "b1", title: "JARO10", movedAt: "2026-09-20T10:00:00" };

test("P2: 'Slevy vytvořené přímo v Shopify' exists only when there is something to act on", () => {
  assert.equal(nativeNeedsSection(undefined), false);
  assert.equal(nativeNeedsSection({ state: "not_wired" }), false);
  assert.equal(nativeNeedsSection({ state: "loading" }), false, "still loading: nothing to do yet");
  assert.equal(nativeNeedsSection({ state: "ok", discounts: [], moved: [], conflicts: [] }), false, "nothing outside Won");
  assert.equal(nativeNeedsSection({ state: "ok", discounts: [NATIVE], moved: [] }), true);
  assert.equal(nativeNeedsSection({ state: "ok", discounts: [], moved: [MOVED] }), true, "a move can be undone");
  assert.equal(nativeNeedsSection({ state: "loading", moved: [MOVED] }), true, "a slow Shopify never hides the undo");
  assert.equal(nativeNeedsSection({ state: "ok", discounts: [], moved: [], conflicts: [{ nativeTitle: "A", ruleName: "B", message: "…" }] }), true);
  assert.equal(nativeNeedsSection({ state: "error" }), true, "a failed detection is shown with its retry");
  assert.equal(nativeOutsideCount({ state: "ok", discounts: [NATIVE], moved: [] }), 1);
  assert.equal(nativeOutsideCount({ state: "error" }), 0);
  assert.equal(nativeAdminUrl("gid://shopify/DiscountAutomaticNode/1003"), "shopify://admin/discounts/1003");
  assert.equal(nativeAdminUrl("nonsense"), null);
});

test("B10: the store status reaches 'all good' — checkout verification is not counted", () => {
  const good: AdminSignals = { ...NOT_WIRED_SIGNALS, embed: { state: "on", activateUrl: null }, sync: { state: "ok", at: "2026-09-28T16:20:00" } };
  assert.equal(good.checkout.state, "not_wired");
  assert.equal(statusSummary(good, tr), "Slevy platí na webu i v pokladně (poslední krok objednávky)");
  assert.equal(statusSummary({ ...good, sync: { state: "pending" } }, tr), "1 ze 2 zatím neověřeno");
  // Feedback 2, bod 1: the section carries the green "Aktivní" pill exactly when both hold.
  assert.equal(statusAllGood(good), true);
  assert.equal(statusAllGood({ ...good, sync: { state: "pending" } }), false);
  assert.equal(statusAllGood({ ...good, embed: { state: "off", activateUrl: null } }), false);
  assert.equal(statusSummary({ ...good, embed: { state: "unknown", activateUrl: null }, sync: { state: "pending" } }, tr), "2 ze 2 zatím neověřeno");
  assert.equal(statusSummary({ ...good, embed: { state: "off", activateUrl: null } }, tr), "Na webu se slevy zatím neukazují");
});

test("B16: one step count for the guide and Přehled; step 2 only with something outside Won; step 4 opens once step 3 is skipped", () => {
  const none: NativeView = { state: "ok", discounts: [], moved: [], conflicts: [] };
  assert.equal(onboardingHasNative(none), false);
  assert.equal(onboardingHasNative({ state: "ok", discounts: [NATIVE], moved: [] }), true);
  assert.equal(onboardingHasNative({ state: "loading" }), true, "not known yet: the step stays");
  assert.deepEqual(onboardingSteps(true), [1, 2, 3, 4, 5]);
  assert.deepEqual(onboardingSteps(false), [1, 3, 4, 5]);

  // Step 2 is skipped without native discounts.
  assert.equal(onboardingStep(2, { embedOn: false, rules: 0, hasNative: false }), 3);
  assert.equal(onboardingStep(2, { embedOn: false, rules: 0, hasNative: true }), 2);
  assert.equal(onboardingStep(2, { embedOn: true, rules: 0, hasNative: false }), 4, "skipped step 2, the embed is already on");
  // Step 3: waits for the embed — unless the merchant skipped it (stored 4).
  assert.equal(onboardingStep(3, { embedOn: false, rules: 0 }), 3);
  assert.equal(onboardingStep(4, { embedOn: false, rules: 0 }), 4, "the first discount does not need the website on");
  assert.equal(onboardingStep(4, { embedOn: false, rules: 2 }), 5);

  assert.deepEqual(onboardingProgress(1, { embedOn: false, rules: 0, hasNative: true }), { step: 1, position: 1, total: 5 });
  assert.deepEqual(onboardingProgress(3, { embedOn: false, rules: 0, hasNative: true }), { step: 3, position: 3, total: 5 });
  assert.deepEqual(onboardingProgress(3, { embedOn: false, rules: 0, hasNative: false }), { step: 3, position: 2, total: 4 });
  assert.deepEqual(onboardingProgress(4, { embedOn: false, rules: 0, hasNative: false }), { step: 4, position: 3, total: 4 });
});

const rule = (over: Partial<DiscountRule>): DiscountRule => ({
  id: "r1",
  enabled: true,
  name: "Sleva",
  method: "automatic",
  value: { kind: "percentage", percent: 10 },
  target: { kind: "order" },
  ...over,
});

test("P3: 'Neaktivní: …' in Aktivní slevy links to the field that fixes it, built from the warning's own anchor", () => {
  const noCode = rule({ id: "c1", method: "code", codes: [] });
  const noTarget = rule({ id: "t1", target: { kind: "products", productIds: [], variantIds: [] } });
  const warnings = collectWarnings([noCode, noTarget], ["CZK"]);
  const codeField = warnings.find((w) => w.ruleId === "c1")!.field;
  const targetField = warnings.find((w) => w.ruleId === "t1")!.field;
  assert.deepEqual(ruleFix("c1", { kind: "no_code" }, warnings, tr), { href: `/app/discounts/c1#${codeField}`, label: "Přidat kód" });
  assert.deepEqual(ruleFix("t1", { kind: "no_target" }, warnings, tr), { href: `/app/discounts/t1#${targetField}`, label: "Vybrat" });
  assert.deepEqual(ruleFix("p1", { kind: "pro_off" }, warnings, tr), { href: "/app/discounts/p1#pro", label: "Opravit" });
  assert.deepEqual(ruleFix("m 1", { kind: "market_off" }, [], tr)?.href, "/app/discounts/m%201#pro");
  // Nothing to fix in the editor: running, scheduled, or a failed sync (its retry is on the sync row).
  for (const kind of ["live", "scheduled", "off", "not_synced", "sync_failed"] as const) assert.equal(ruleFix("c1", { kind }, warnings, tr), null, kind);
});

const view = (over: Partial<TryCartRuleView>): TryCartRuleView => ({ id: "r", name: "VIP", method: "code", codes: ["VIP10"], enabled: true, markets: [], marketNames: [], ...over });

test("Vyzkoušet košík: a discount that cannot apply for the chosen market or day is disabled with its reason", () => {
  const ctx = { market: "cz", date: "2026-10-06" };
  assert.equal(ruleBlockedReason(view({}), ctx, tr), null);
  assert.equal(ruleBlockedReason(view({ enabled: false }), ctx, tr), "Sleva je vypnutá.");
  assert.equal(ruleBlockedReason(view({ codes: [] }), ctx, tr), "Sleva zatím nemá kód.");
  assert.equal(ruleBlockedReason(view({ startsOn: "2026-11-27" }), ctx, tr), "Platí až od 27. 11. 2026.");
  assert.equal(ruleBlockedReason(view({ startsOn: "2026-11-27" }), { market: "cz", date: "2026-11-27" }, tr), null, "the first day counts");
  assert.equal(ruleBlockedReason(view({ endsOn: "2026-09-30" }), ctx, tr), "Skončila 30. 9. 2026.");
  assert.equal(ruleBlockedReason(view({ markets: ["sk"], marketNames: ["Slovensko"] }), ctx, tr), "Platí jen pro: Slovensko.");
  assert.equal(ruleBlockedReason(view({ markets: ["sk", "cz"], marketNames: ["Slovensko", "Česko"] }), ctx, tr), null);
  assert.equal(ruleBlockedReason(view({ markets: ["sk"] }), { market: null, date: "2026-10-06" }, tr), null, "a currency without a market: the engine decides");
  assert.ok(ruleBlockedReason(view({ unsupported: true }), ctx, tr));
});

test("B13: one FormData snapshot feeds both summaries; the picker's answer is the cart", () => {
  const fd = new FormData();
  for (const [k, v] of [
    ["variantId", "v1"], ["quantity", "3"],
    ["variantId", "v2"], ["quantity", ""],
    ["currency", "EUR:sk"], ["when", "custom"], ["date", "2026-11-27"], ["time", "09:30"], ["ruleId", "vip"],
  ] as [string, string][]) fd.append(k, v);
  assert.deepEqual(cartSnapshot(fd), { currency: "EUR:sk", when: "custom", date: "2026-11-27", time: "09:30", ruleIds: ["vip"], quantities: { v1: 3, v2: 0 } });
  assert.equal(cartSnapshot(new FormData()).when, "now", "no choice = now");
  assert.equal(lineLabel({ title: "Mikina Won", variantTitle: "M / černá" }, 3), "Mikina Won (M / černá) × 3");
  assert.equal(lineLabel({ title: "Čepice" }, 1), "Čepice × 1");

  const lines: TryCartLineView[] = [
    { variantId: "v1", productId: "p1", title: "Mikina", variantTitle: "M", quantity: 3, unitPrice: { CZK: 100 } },
    { variantId: "v9", productId: "p9", title: "Čepice", quantity: 2, unitPrice: {} },
  ];
  const next = reconcileLines(lines, [
    { id: "p1", title: "Mikina", variants: [{ id: "v1", title: "M" }, { id: "v2", title: "L" }] },
    { id: "p3", title: "Ponožky", variants: [{ id: "v3", title: "Default Title" }] },
  ]);
  assert.deepEqual(next.map((l) => [l.variantId, l.quantity, l.variantTitle]), [["v1", 3, "M"], ["v2", 1, "L"], ["v3", 1, undefined]], "kept lines keep their quantity, unticked ones leave");
  assert.deepEqual(next[0]!.unitPrice, { CZK: 100 }, "a kept line keeps what Shopify priced");
  assert.deepEqual(reconcileLines(lines, []), [], "everything unticked: an empty cart");
  assert.equal(reconcileLines([], [{ id: "p", title: "P", variants: Array.from({ length: 80 }, (_, i) => ({ id: `v${i}`, title: `${i}` })) }]).length, 50);
});
