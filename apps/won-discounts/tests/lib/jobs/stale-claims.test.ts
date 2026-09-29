// Periodic in-process stale-claim sweep (native move audit follow-up):
// app/lib/jobs/stale-claims.server.ts. Without it, a `moving` / `undoing`
// NativeDiscountBackup a dead process left (a double discount, native + Won
// rule both live) is only settled when a merchant opens Přehled — unbounded.
// This exercises runStaleClaimSweepOnce with fakes (no real Shopify wiring;
// the fake-shopify / fake-sync harness the native move tests already use),
// and the startStaleClaimJob guard against a process starting the timer twice.

import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";

import { createDefaultConfig, type WonDiscountsConfig } from "@won/core/discounts/config";

import { loadConfig } from "../../../app/lib/config.server.ts";
import { configLockIdle, isConfigLocked, tryWithConfigLock, withConfigLock } from "../../../app/lib/integration/lock.server.ts";
import {
  runStaleClaimSweepOnce,
  staleClaimJobStarted,
  startStaleClaimJob,
  stopStaleClaimJob,
  STALE_SWEEP_FIRST_DELAY_MS,
  STALE_SWEEP_INTERVAL_MS,
} from "../../../app/lib/jobs/stale-claims.server.ts";
import { CLAIM_STALE_MS } from "../../../app/lib/native/move.server.ts";
import { planMove } from "../../../app/lib/native/map.server.ts";
import { makeSnapshot } from "../../../app/lib/native/restore.server.ts";
import { normalizeNode } from "../../../app/lib/native/normalize.ts";
import type { NativeDiscount } from "../../../app/lib/native/types.ts";
import { createTestDatabase, type TestDatabase } from "../test-db.ts";
import { basicNode, FakeShopify } from "../native/fake-shopify.ts";
import { createFakeSync } from "../native/fake-sync.ts";

let db: TestDatabase;
let shopCounter = 0;

before(() => {
  db = createTestDatabase("stale-claims-job");
});

after(async () => {
  await db.drop();
});

// Every test's clientFor is scoped to its own shop(s); a stale row left
// "moving" on purpose by one test (the lock / no-session cases) must not be
// picked up by the next test's global (distinct-shop, cross-shop) query.
beforeEach(async () => {
  await db.prisma.nativeDiscountBackup.deleteMany({});
  await db.prisma.shopConfig.deleteMany({});
});

const NOW = new Date("2026-09-28T12:00:00Z");
const SHOP_CONTEXT = { currencyCode: "CZK", ianaTimezone: "Europe/Prague" };
const rows = (shop: string) => db.prisma.nativeDiscountBackup.findMany({ where: { shop }, orderBy: { createdAt: "asc" } });

function native(raw: { id: string; discount: unknown }): NativeDiscount {
  const node = normalizeNode(raw, SHOP_CONTEXT);
  assert.ok(node && node.movableType);
  return node.native;
}

function setup() {
  shopCounter += 1;
  const shop = `stale-job-${shopCounter}.myshopify.com`;
  const shopify = new FakeShopify();
  shopify.now = () => NOW;
  const sync = createFakeSync(db.prisma, shopify);
  return { shop, shopify, sync };
}

/** A create-first move whose process died: the Won rule saved AND live, the native still live, the claim stale. */
async function deadCreateFirst(env: ReturnType<typeof setup>, title: string) {
  const raw = basicNode({ method: "automatic", title });
  const nativeId = env.shopify.add(raw);
  const config: WonDiscountsConfig = createDefaultConfig();
  const rule = planMove(native(raw), config, { now: NOW }).rule;
  config.modules.codes.rules.push(rule);
  assert.deepEqual(await env.sync.saveAndSync({ shop: env.shop, config }), { ok: true });
  const row = await db.prisma.nativeDiscountBackup.create({
    data: {
      shop: env.shop,
      nativeId,
      kind: "automatic_basic",
      title,
      snapshot: JSON.stringify(makeSnapshot(raw, env.shopify.shop)),
      wonRuleId: rule.id,
      status: "moving",
    },
  });
  await db.prisma.nativeDiscountBackup.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - CLAIM_STALE_MS - 60_000) } });
  return { nativeId, ruleId: rule.id, rowId: row.id };
}

// --- tryWithConfigLock (lock.server.ts): the non-blocking primitive the sweep is built on ------

test("tryWithConfigLock: the shop's lock is free → it runs, same as withConfigLock", async () => {
  const shop = "stale-job-lock-free.myshopify.com";
  const attempt = tryWithConfigLock(shop, async () => "ran");
  assert.equal(attempt.skipped, false);
  assert.ok(!attempt.skipped);
  assert.equal(await attempt.result, "ran");
});

test("tryWithConfigLock: the shop's lock is held → skipped, without waiting for it", async () => {
  const shop = "stale-job-lock-held.myshopify.com";
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holder = withConfigLock(shop, () => held);
  try {
    let secondRan = false;
    const attempt = tryWithConfigLock(shop, async () => {
      secondRan = true;
    });
    assert.equal(attempt.skipped, true, "skipped synchronously — never queued behind the holder");
    assert.equal(secondRan, false);
  } finally {
    release();
    await holder;
  }
});

test("tryWithConfigLock: the lock is released even when `run` throws (so the next attempt is free again)", async () => {
  const shop = "stale-job-lock-throws.myshopify.com";
  const attempt = tryWithConfigLock(shop, async () => {
    throw new Error("boom");
  });
  assert.equal(attempt.skipped, false);
  assert.ok(!attempt.skipped);
  await assert.rejects(attempt.result, /boom/);
  await configLockIdle(shop);
  assert.equal(isConfigLocked(shop), false, "released, not left held after the failure");
  const again = tryWithConfigLock(shop, async () => "free again");
  assert.equal(again.skipped, false);
});

// --- The sweep job itself -----------------------------------------------------------------------

test("stale claim + live double (native + Won rule both live) → the sweep rolls the rule back", async () => {
  const env = setup();
  const { nativeId, ruleId, rowId } = await deadCreateFirst(env, "Pád po vytvoření (job)");
  assert.match(env.shopify.shopFunctionConfig ?? "", new RegExp(ruleId), "both apply right now");

  const result = await runStaleClaimSweepOnce({
    db: db.prisma,
    clientFor: async (shop) => (shop === env.shop ? env.shopify : null),
    buildSaveAndSync: () => env.sync.saveAndSync,
  });

  assert.equal(result.shopsSwept, 1);
  assert.equal(result.rowsResolved, 1);
  assert.equal(result.shopsSkippedLocked, 0);
  assert.equal(result.shopsSkippedNoSession, 0);

  assert.equal((await loadConfig(db.prisma, env.shop)).config.modules.codes.rules.length, 0, "the Won rule is rolled back");
  assert.doesNotMatch(env.shopify.shopFunctionConfig ?? "", new RegExp(ruleId), "Shopify no longer runs it");
  assert.ok(env.shopify.nodes.has(nativeId), "the native discount is untouched, still live");
  const [row] = await rows(env.shop);
  assert.equal(row.id, rowId);
  assert.equal(row.status, "failed", "settled: nothing of Won runs next to it any more");
});

test("no stale claims: the sweep is a no-op (no shop touched)", async () => {
  const env = setup();
  const result = await runStaleClaimSweepOnce({
    db: db.prisma,
    clientFor: async () => env.shopify,
  });
  assert.deepEqual(result, { shopsSwept: 0, shopsSkippedLocked: 0, shopsSkippedNoSession: 0, rowsResolved: 0 });
});

test("a shop whose config lock is currently held is skipped, non-blocking (never queued)", async () => {
  const env = setup();
  await deadCreateFirst(env, "Zamčeno (job)");

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  // Occupy the shop's real config lock, exactly like a move / save in progress would.
  const locked = withConfigLock(env.shop, () => held);
  assert.equal(isConfigLocked(env.shop), true);

  try {
    const result = await runStaleClaimSweepOnce({
      db: db.prisma,
      clientFor: async () => env.shopify,
      buildSaveAndSync: () => env.sync.saveAndSync,
    });
    assert.equal(result.shopsSwept, 0);
    assert.equal(result.shopsSkippedLocked, 1);
    assert.equal(result.rowsResolved, 0);
    const [row] = await rows(env.shop);
    assert.equal(row.status, "moving", "not touched while the lock is held");
  } finally {
    release();
    await locked;
  }
});

test("a shop with no offline Admin API session (uninstalled, or never installed under this key) is skipped", async () => {
  const env = setup();
  await deadCreateFirst(env, "Bez session (job)");

  const result = await runStaleClaimSweepOnce({
    db: db.prisma,
    clientFor: async () => null,
  });
  assert.equal(result.shopsSwept, 0);
  assert.equal(result.shopsSkippedNoSession, 1);
  const [row] = await rows(env.shop);
  assert.equal(row.status, "moving", "left claimed; retried next pass once a session exists");
});

test("a failure sweeping one shop is logged and never thrown; other shops still swept", async () => {
  const a = setup();
  const b = setup();
  await deadCreateFirst(a, "A selže (job)");
  const { ruleId: ruleB } = await deadCreateFirst(b, "B jede (job)");
  const errors: string[] = [];

  const result = await runStaleClaimSweepOnce({
    db: db.prisma,
    clientFor: async (shop) => {
      if (shop === a.shop) throw new Error("boom");
      if (shop === b.shop) return b.shopify;
      return null;
    },
    buildSaveAndSync: (opts) => (opts.shop === a.shop ? a.sync.saveAndSync : b.sync.saveAndSync),
    logger: { info() {}, warn() {}, error: (message) => errors.push(message) },
  });

  assert.equal(result.shopsSwept, 1, "b still swept despite a's failure");
  assert.ok(errors.some((message) => message.includes(a.shop)), "a's failure is logged");
  const bRules = (await loadConfig(db.prisma, b.shop)).config.modules.codes.rules.map((r) => r.id);
  assert.ok(!bRules.includes(ruleB), "b's rule was rolled back despite a's failure");
});

test("lock taken in the gap between the client resolve and the lock attempt (TOCTOU) → skipped, not queued; the next shop is still processed", async () => {
  const a = setup();
  const b = setup();
  await deadCreateFirst(a, "A - lock grabbed while resolving the client (job)");
  const { ruleId: ruleB } = await deadCreateFirst(b, "B jede (job)");

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let holder: Promise<void> | null = null;

  const result = await runStaleClaimSweepOnce({
    db: db.prisma,
    clientFor: async (shop) => {
      if (shop === a.shop) {
        // Simulate another writer (a save, a move) acquiring the shop's real
        // config lock in the window this await opens up — AFTER the sweep
        // resolved a's client but BEFORE it gets to try the lock.
        holder = withConfigLock(a.shop, () => held);
        return a.shopify;
      }
      if (shop === b.shop) return b.shopify;
      return null;
    },
    buildSaveAndSync: (opts) => (opts.shop === a.shop ? a.sync.saveAndSync : b.sync.saveAndSync),
  });

  try {
    // a is skipped — tryWithConfigLock sees the lock the "clientFor" call just
    // grabbed and does not queue behind it — while b, unaffected, is swept.
    assert.equal(result.shopsSkippedLocked, 1);
    assert.equal(result.shopsSwept, 1);
    assert.equal(result.rowsResolved, 1);
    const [rowA] = await rows(a.shop);
    assert.equal(rowA.status, "moving", "a untouched: its lock was held when tried");
    const bRules = (await loadConfig(db.prisma, b.shop)).config.modules.codes.rules.map((r) => r.id);
    assert.ok(!bRules.includes(ruleB), "b was swept and rolled back despite a's lock race");
  } finally {
    release();
    if (holder) await holder;
  }
});

// --- startStaleClaimJob: idempotent per process ------------------------------------------------

test("startStaleClaimJob: a second call is a no-op; stopStaleClaimJob clears the guard", () => {
  stopStaleClaimJob();
  assert.equal(staleClaimJobStarted(), false);

  startStaleClaimJob({ force: true, deps: { db: db.prisma, clientFor: async () => null }, firstDelayMs: 10 ** 9, intervalMs: 10 ** 9 });
  assert.equal(staleClaimJobStarted(), true);

  // A second start (even with different config) must not create a second timer.
  let secondCalled = false;
  startStaleClaimJob({
    force: true,
    firstDelayMs: 1,
    deps: {
      db: db.prisma,
      clientFor: async () => {
        secondCalled = true;
        return null;
      },
    },
  });
  assert.equal(staleClaimJobStarted(), true);

  stopStaleClaimJob();
  assert.equal(staleClaimJobStarted(), false);
  assert.equal(secondCalled, false, "the second call's deps were never used: it was a no-op");
});

test("startStaleClaimJob: disabled under NODE_ENV=test unless forced", () => {
  stopStaleClaimJob();
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  try {
    startStaleClaimJob({ db: db.prisma });
    assert.equal(staleClaimJobStarted(), false, "not started: no force under NODE_ENV=test");
  } finally {
    process.env.NODE_ENV = original;
    stopStaleClaimJob();
  }
});

test("startStaleClaimJob: default timing — first run at STALE_SWEEP_FIRST_DELAY_MS, then every STALE_SWEEP_INTERVAL_MS, both timers unref'd", (t) => {
  stopStaleClaimJob();
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });

  // Wrap the (already mocked) global timer functions so we can see the job's
  // own handles call .unref() — not just that calling it is harmless.
  const realSetTimeout = globalThis.setTimeout;
  const realSetInterval = globalThis.setInterval;
  const unrefed = new Set<object>();
  // @ts-expect-error test instrumentation over the mocked global
  globalThis.setTimeout = (...args: Parameters<typeof setTimeout>) => {
    const handle = realSetTimeout(...args);
    const originalUnref = handle.unref.bind(handle);
    handle.unref = () => {
      unrefed.add(handle);
      return originalUnref();
    };
    return handle;
  };
  // @ts-expect-error test instrumentation over the mocked global
  globalThis.setInterval = (...args: Parameters<typeof setInterval>) => {
    const handle = realSetInterval(...args);
    const originalUnref = handle.unref.bind(handle);
    handle.unref = () => {
      unrefed.add(handle);
      return originalUnref();
    };
    return handle;
  };

  try {
    // A minimal fake db: runStaleClaimSweepOnce always queries it first, even
    // with nothing stale, so this counts a run without needing real rows / a
    // real clientFor to be reached.
    let runs = 0;
    const countingDb = {
      nativeDiscountBackup: {
        findMany: async () => {
          runs += 1;
          return [];
        },
      },
    } as unknown as typeof db.prisma;
    startStaleClaimJob({
      force: true,
      deps: { db: countingDb, clientFor: async () => null },
    });
    assert.equal(runs, 0, "nothing runs synchronously on start");

    // Just under the delay: still nothing.
    t.mock.timers.tick(STALE_SWEEP_FIRST_DELAY_MS - 1);
    assert.equal(runs, 0, "not yet at STALE_SWEEP_FIRST_DELAY_MS");

    // The remaining millisecond fires the first run, which also schedules the interval.
    t.mock.timers.tick(1);
    assert.equal(runs, 1, "fires exactly at STALE_SWEEP_FIRST_DELAY_MS, once");

    // No interval tick yet: a second, unrelated firing must not happen early.
    t.mock.timers.tick(STALE_SWEEP_INTERVAL_MS - 1);
    assert.equal(runs, 1, "not yet at STALE_SWEEP_INTERVAL_MS since the first run");

    t.mock.timers.tick(1);
    assert.equal(runs, 2, "the interval fires exactly at STALE_SWEEP_INTERVAL_MS");

    t.mock.timers.tick(STALE_SWEEP_INTERVAL_MS);
    assert.equal(runs, 3, "…and keeps firing every STALE_SWEEP_INTERVAL_MS after that");

    assert.equal(unrefed.size, 2, "both the first-run timeout and the interval called .unref()");
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.setInterval = realSetInterval;
    stopStaleClaimJob();
    t.mock.timers.reset();
  }
});
