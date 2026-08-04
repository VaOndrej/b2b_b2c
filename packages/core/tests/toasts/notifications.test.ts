import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGGREGATE_TYPES,
  DEFAULT_NOTIFICATIONS,
  NOTIFICATION_TYPES,
  notificationMessage,
  notificationPlanFor,
  notificationOnPage,
  sanitizeNotifications,
} from "../../src/toasts/notifications.ts";

test("defaults: no notifications are configured out of the box", () => {
  assert.deepEqual(DEFAULT_NOTIFICATIONS, []);
});

test("sanitize: a valid countdown rule survives with clamped/typed fields", () => {
  const [rule] = sanitizeNotifications([
    {
      id: "sale",
      type: "countdown",
      enabled: true,
      surface: "banner",
      pages: ["product", "cart", "bogus"],
      endsAt: "2026-12-31T23:59:59.000Z",
      message: "Sale ends in {countdown}",
    },
  ]);
  assert.equal(rule.type, "countdown");
  assert.equal(rule.enabled, true);
  assert.equal(rule.surface, "banner");
  // unknown page dropped, valid ones kept
  assert.deepEqual(rule.pages, ["product", "cart"]);
  assert.equal((rule as { endsAt?: string }).endsAt, "2026-12-31T23:59:59.000Z");
});

test("sanitize: countdown accepts evergreenMs and drops a bad endsAt", () => {
  const [rule] = sanitizeNotifications([
    {
      id: "evergreen",
      type: "countdown",
      enabled: true,
      surface: "toast",
      evergreenMs: 3_600_000,
      endsAt: "not-a-date",
      message: "Hurry! {countdown}",
    },
  ]);
  assert.equal((rule as { evergreenMs?: number }).evergreenMs, 3_600_000);
  assert.equal((rule as { endsAt?: string }).endsAt, undefined);
});

test("sanitize: low-stock rule keeps threshold, clamps to >=1", () => {
  const [rule] = sanitizeNotifications([
    { id: "s", type: "stock.low", enabled: true, surface: "toast", threshold: 0, message: "Only {count} left" },
  ]);
  assert.equal(rule.type, "stock.low");
  assert.equal((rule as { threshold: number }).threshold, 1);
});

test("sanitize: cart-activity keeps a sane window", () => {
  const [rule] = sanitizeNotifications([
    { id: "ca", type: "cart.activity", enabled: false, surface: "toast", windowHours: 999, message: "{count} people added this" },
  ]);
  assert.equal(rule.type, "cart.activity");
  assert.equal(rule.enabled, false);
  // clamped to a sane max (<= 168h / 7 days)
  assert.ok((rule as { windowHours: number }).windowHours <= 168);
});

test("sanitize: unknown types and malformed entries are dropped", () => {
  const rules = sanitizeNotifications([
    { id: "x", type: "wat", enabled: true, surface: "toast", message: "" },
    "not an object",
    null,
    { type: "countdown" }, // no id/message → still gets defaults but must be an object
  ]);
  // only the last (an object with a known type) may survive
  assert.ok(rules.every((r) => NOTIFICATION_TYPES.includes(r.type)));
  assert.ok(rules.length <= 1);
});

test("sanitize: a non-array input yields an empty list; hard cap enforced", () => {
  assert.deepEqual(sanitizeNotifications(null), []);
  assert.deepEqual(sanitizeNotifications({}), []);
  const many = Array.from({ length: 100 }, (_, i) => ({
    id: `r${i}`,
    type: "countdown",
    enabled: true,
    surface: "toast",
    evergreenMs: 1000,
    message: "x",
  }));
  assert.ok(sanitizeNotifications(many).length <= 20);
});

test("plan: countdown + announcement Free; the rest Pro", () => {
  assert.equal(notificationPlanFor("countdown"), "free");
  assert.equal(notificationPlanFor("announcement"), "free");
  assert.equal(notificationPlanFor("stock.low"), "pro");
  assert.equal(notificationPlanFor("cart.activity"), "pro");
  assert.equal(notificationPlanFor("order.summary"), "pro");
});

test("MVP11: announcement carries i18n messages; base message is the fallback", () => {
  const [rule] = sanitizeNotifications([
    {
      id: "promo",
      type: "announcement",
      enabled: true,
      surface: "banner",
      message: "Spring sale is live",
      messages: { cs: "Jarní výprodej běží", sk: "", bogus: "x" },
    },
  ]);
  assert.equal(rule.type, "announcement");
  assert.equal(notificationMessage(rule, "cs"), "Jarní výprodej běží");
  assert.equal(notificationMessage(rule, "en"), "Spring sale is live"); // fallback
  assert.equal(notificationMessage(rule, "sk"), "Spring sale is live"); // blank dropped
});

test("MVP11: order.summary keeps a window up to 30 days; aggregates flagged", () => {
  const [rule] = sanitizeNotifications([
    {
      id: "os",
      type: "order.summary",
      enabled: true,
      surface: "toast",
      message: "{count} orders this week",
      windowHours: 10_000,
    },
  ]);
  assert.equal(rule.type, "order.summary");
  assert.ok((rule as { windowHours: number }).windowHours <= 720);
  assert.ok(AGGREGATE_TYPES.includes("order.summary"));
  assert.ok(AGGREGATE_TYPES.includes("cart.activity"));
  assert.ok(!AGGREGATE_TYPES.includes("countdown"));
});

test("page scope: empty pages = all; explicit list gates by page + 'all'", () => {
  const all = { id: "a", type: "countdown", enabled: true, surface: "toast", pages: [], evergreenMs: 1, message: "x" } as const;
  assert.equal(notificationOnPage(all, "product"), true);
  assert.equal(notificationOnPage(all, "home"), true);

  const scoped = { id: "b", type: "countdown", enabled: true, surface: "toast", pages: ["product"], evergreenMs: 1, message: "x" } as const;
  assert.equal(notificationOnPage(scoped, "product"), true);
  assert.equal(notificationOnPage(scoped, "cart"), false);

  const anyPage = { id: "c", type: "countdown", enabled: true, surface: "toast", pages: ["all"], evergreenMs: 1, message: "x" } as const;
  assert.equal(notificationOnPage(anyPage, "search"), true);
});
