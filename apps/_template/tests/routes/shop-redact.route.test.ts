import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

// PRIV-2 (audit MVP 0 of won-discounts, P2-4, carried into the template): the
// template's REAL shop/redact route must never swallow a failed deletion. With
// the app-kit default a failing delete still answers 200 and Shopify never
// retries, so the shop's data is silently kept. The template opts into
// `retryOnDeletionError: true`, like apps/won-discounts: the failure is logged
// without PII and answered with 500, so Shopify retries the webhook.
//
// Driven with HMAC-signed requests against a throwaway SQLite file built from
// the committed migrations (`prisma migrate deploy`).
//
// Lives in tests/routes/ on purpose: a test in a subdirectory is exactly what
// an unquoted `tests/**/*.test.ts` glob in package.json silently narrows to
// (sh has no globstar, so it expands to `tests/*/*.test.ts` only).

const SECRET = "won-template-test-secret";
const SHOP = "template-redact.myshopify.com";
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

type Action = (args: { request: Request; params: object; context: object }) => Promise<Response>;
type Db = {
  session: {
    count(args: { where: { shop: string } }): Promise<number>;
    upsert(args: object): Promise<unknown>;
  };
  $executeRawUnsafe(sql: string): Promise<number>;
  $disconnect(): Promise<void>;
};

let dir = "";
let shopRedact: Action;
let db: Db;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "won-template-redact-"));
  const url = `file:${path.join(dir, "test.sqlite")}`;
  execFileSync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
  // app/db.server.ts builds its PrismaClient from DATABASE_URL at import time,
  // and app/shopify.server.ts reads the app credentials at import time.
  process.env.DATABASE_URL = url;
  process.env.SHOPIFY_API_KEY = "test-api-key";
  process.env.SHOPIFY_API_SECRET = SECRET;
  process.env.SHOPIFY_APP_URL = "https://won-template.test";
  process.env.SCOPES = "read_products";
  shopRedact = (await import("../../app/routes/webhooks.shop.redact.tsx")).action as unknown as Action;
  db = (await import("../../app/db.server.ts")).default as unknown as Db;
});

after(async () => {
  await db?.$disconnect();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function redactRequest(id: string) {
  const raw = JSON.stringify({ shop_id: 1, shop_domain: SHOP });
  return new Request("https://won-template.test/webhooks/shop/redact", {
    method: "POST",
    body: raw,
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Hmac-Sha256": createHmac("sha256", SECRET).update(raw).digest("base64"),
      "X-Shopify-Topic": "shop/redact",
      "X-Shopify-API-Version": "2026-04",
      "X-Shopify-Shop-Domain": SHOP,
      "X-Shopify-Webhook-Id": id,
    },
  });
}

async function seedSession() {
  await db.session.upsert({
    where: { id: `offline_${SHOP}` },
    create: { id: `offline_${SHOP}`, shop: SHOP, state: "", isOnline: false, accessToken: "test-token" },
    update: {},
  });
}

test("template shop/redact erases the shop's sessions and answers 200", async () => {
  await seedSession();
  const res = await shopRedact({ request: redactRequest("wh-template-redact-1"), params: {}, context: {} });
  assert.equal(res.status, 200);
  assert.equal(await db.session.count({ where: { shop: SHOP } }), 0);
});

test("template shop/redact answers 5xx when the deletion fails, so Shopify retries (retryOnDeletionError)", async () => {
  // Make the real deletion fail while reads keep working (authenticate.webhook
  // still loads the offline session): a trigger aborts every Session delete.
  await seedSession();
  await db.$executeRawUnsafe(
    `CREATE TRIGGER "test_session_delete_fails" BEFORE DELETE ON "Session" BEGIN SELECT RAISE(ABORT, 'deletion failed for the test'); END`,
  );
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const res = await shopRedact({ request: redactRequest("wh-template-redact-2"), params: {}, context: {} });
    assert.ok(res.status >= 500, `expected a retryable 5xx, got ${res.status}`);
  } finally {
    console.error = original;
  }
  assert.match(JSON.stringify(errors), /template-redact\.myshopify\.com/, "the failure is logged (shop, no PII)");
  assert.equal(await db.session.count({ where: { shop: SHOP } }), 1, "the session stays until a retry succeeds");
});
