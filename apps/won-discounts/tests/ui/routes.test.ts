import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import { loadConfig } from "../../app/lib/config.server.ts";
import { createTestDatabase, type TestDatabase } from "../lib/test-db.ts";

// SEC-1 / SEC-2 for the admin routes (app/routes/app*.tsx):
//   - every loader and action authenticates the admin session first; an
//     unauthenticated request is answered by Shopify auth, never by our code;
//   - the shop is ALWAYS the session's — no route reads a shop from the form or
//     the URL — and every write goes through the ui-actions seam, which
//     validates the raw form on the server (tests/ui/ui-actions.test.ts).

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ROUTES_DIR = path.join(APP_ROOT, "app/routes");
const adminRoutes = readdirSync(ROUTES_DIR).filter((f) => /^app[.\w$-]*\.tsx$/.test(f));

test("every admin route authenticates in its loader and action", () => {
  assert.ok(adminRoutes.length >= 8, `found ${adminRoutes.join(", ")}`);
  let checked = 0;
  for (const file of adminRoutes) {
    const source = readFileSync(path.join(ROUTES_DIR, file), "utf8");
    for (const kind of ["loader", "action"] as const) {
      const m = new RegExp(`export const ${kind} = async [\\s\\S]*?=> \\{([\\s\\S]*?)\\n\\};`).exec(source);
      if (!m) continue;
      checked++;
      assert.match(m[1], /await authenticate\.admin\(request\)/, `${file} ${kind} must authenticate first`);
      const firstStatement = m[1]
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line !== "" && !line.startsWith("//"));
      assert.match(firstStatement ?? "", /authenticate\.admin\(request\)/, `${file} ${kind}: authenticate before anything else`);
    }
  }
  // 10 loaders (app, index, discounts, editor, try-cart, onboarding, module, settings, plan, margin) + 5 actions.
  assert.ok(checked >= 15, `checked ${checked} loaders/actions`);
});

test("no admin route takes the shop from the request; the request context is built from the session shop", () => {
  let wired = 0;
  for (const file of adminRoutes) {
    const source = readFileSync(path.join(ROUTES_DIR, file), "utf8");
    assert.doesNotMatch(source, /\.get\(["']shop["']\)/, `${file} reads a shop from the request`);
    // SEC-2: every request context (app/lib/integration/context.server.ts) gets the SESSION shop.
    for (const call of source.matchAll(/\bshopCtx\(([^,]+),\s*([^,)]+)/g)) {
      assert.equal(call[2].trim(), "session.shop", `${file}: shopCtx must get session.shop`);
      wired++;
    }
    // Page handlers get only that context (never a shop of their own).
    for (const call of source.matchAll(/\b(\w+(?:Page|Action))\(([^,)]+)/g)) {
      assert.equal(call[2].trim(), "ctx", `${file}: ${call[1]} must get the session context`);
    }
    // Config writes only through the seam (it validates the form server-side).
    assert.doesNotMatch(source, /\bsaveConfig\(/, `${file} writes config directly instead of through ui-actions`);
  }
  // Přehled (loader + action), Slevy a kódy, editor (loader + action), try-cart (loader + action), onboarding (loader + action),
  // Ochrana marže (loader + action).
  assert.ok(wired >= 11, `${wired} wired contexts`);
});

test("the integration layer never reads a shop from a form or a URL", () => {
  const dir = path.join(APP_ROOT, "app/lib/integration");
  for (const file of readdirSync(dir)) {
    const source = readFileSync(path.join(dir, file), "utf8");
    assert.doesNotMatch(source, /\.get\(["']shop["']\)|searchParams\.get\(["']shop/, `${file} reads a shop from the request`);
  }
});

// --- Runtime: an unauthenticated POST never reaches the seam -----------------------

const SHOP = "victim.myshopify.com";
let db: TestDatabase;

before(() => {
  db = createTestDatabase("ui-routes");
  process.env.DATABASE_URL = db.url;
  process.env.SHOPIFY_API_KEY = "test-api-key";
  process.env.SHOPIFY_API_SECRET = "won-discounts-test-secret";
  process.env.SHOPIFY_APP_URL = "https://won-discounts.test";
  process.env.SCOPES = "write_discounts,read_themes";
});

after(async () => {
  await (globalThis as { prismaGlobal?: { $disconnect(): Promise<void> } }).prismaGlobal?.$disconnect();
  await db.drop();
});

type Action = (args: { request: Request; params: Record<string, string>; context: object }) => Promise<unknown>;

for (const [file, params] of [
  ["app.discounts.$id.tsx", { id: "new" }],
  ["app._index.tsx", {}],
  ["app.onboarding.tsx", {}],
  ["app.try-cart.tsx", {}],
  ["app.margin.tsx", {}],
] as const) {
  test(`${file}: an unauthenticated POST is refused by Shopify auth and writes nothing`, async () => {
    const mod = (await import(`../../app/routes/${file}`)) as { action: Action };
    const body = new URLSearchParams({
      intent: "save",
      shop: SHOP,
      name: "Injected",
      enabled: "on",
      valueKind: "percentage",
      percent: "90",
      target: "order",
      method: "automatic",
    });
    const request = new Request(`https://won-discounts.test/app/discounts/new?shop=${SHOP}`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    let outcome: unknown;
    try {
      outcome = await mod.action({ request, params: { ...params }, context: {} });
    } catch (thrown) {
      outcome = thrown;
    }
    assert.ok(outcome instanceof Response, "Shopify auth answers with a Response");
    assert.ok(outcome.status >= 300, `refused (status ${outcome.status})`);
    const stored = (await loadConfig(db.prisma, SHOP)).config;
    assert.deepEqual(stored.modules.codes.rules, []);
    assert.equal(stored.modules.margin.enabled, false, "margin protection stays off");
  });
}
