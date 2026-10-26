import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

// Audit 2026-10-26, finding SEC-01: the shared Shopify app instance
// (@won/app-kit/shopify.server createShopifyApp) is built with
// `logger: { level: Debug, httpRequests: true }` ("TEMP debug") in EVERY
// environment, production included. This test drives the real production path —
// createShopifyApp → authenticate.admin with a signed session token → the token
// exchange → admin.graphql — with `fetch` faked and every log line captured, and
// checks that no credential reaches the logs:
//   - the app's client secret and the shopper's session token (the token
//     exchange POST body, logged by shopify-api fetchRequestFactory),
//   - the shop's offline/online access token (X-Shopify-Access-Token, logged in
//     `requestParams` by the GraphQL client's HTTP-Response event).
// The assertions state the SAFE behaviour. Until the production fix is approved
// they are marked `todo` (reported, never failing the unit gate); drop `todo`
// together with the fix so the test guards it from then on.
const TODO = "SEC-01: production fix (logger level / httpRequests) pending approval";

const SECRET = `secret-${randomUUID()}`;
const API_KEY = "audit-api-key";
const SHOP = "audit-shop.myshopify.com";
const ACCESS_TOKEN = `shpat_${randomUUID().replaceAll("-", "")}`;

const ENV_KEYS = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "SCOPES", "SHOP_CUSTOM_DOMAIN"] as const;
const savedEnv = new Map<string, string | undefined>();
const realFetch = globalThis.fetch;
const logged: string[] = [];
const fetched: string[] = [];
const originals = { log: console.log, info: console.info, debug: console.debug, warn: console.warn, error: console.error };
let sessionToken = "";

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

function signSessionToken(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: `https://${SHOP}/admin`,
      dest: `https://${SHOP}`,
      aud: API_KEY,
      sub: "42",
      exp: now + 60,
      nbf: now - 5,
      iat: now - 5,
      jti: randomUUID(),
      sid: randomUUID(),
    }),
  );
  const signature = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

/** A Prisma stand-in with just what PrismaSessionStorage touches: no stored session, writes accepted. */
function fakePrisma() {
  const rows = new Map<string, unknown>();
  return {
    session: {
      count: async () => rows.size,
      findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      findMany: async () => [...rows.values()],
      upsert: async ({ where, create }: { where: { id: string }; create: unknown }) => {
        rows.set(where.id, create);
        return create;
      },
      delete: async () => ({}),
      deleteMany: async () => ({ count: 0 }),
    },
  };
}

before(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env.SHOPIFY_API_KEY = API_KEY;
  process.env.SHOPIFY_API_SECRET = SECRET;
  process.env.SHOPIFY_APP_URL = "https://audit-app.example.com";
  process.env.SCOPES = "read_products";
  delete process.env.SHOP_CUSTOM_DOMAIN;
  for (const level of Object.keys(originals) as (keyof typeof originals)[]) {
    console[level] = (...args: unknown[]) => {
      logged.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
  }
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    fetched.push(url);
    if (url.endsWith("/admin/oauth/access_token")) {
      return Response.json({ access_token: ACCESS_TOKEN, scope: "read_products", expires_in: 86400, associated_user_scope: "read_products", associated_user: { id: 42 } });
    }
    return Response.json({ data: { shop: { name: "Audit" } } });
  }) as typeof fetch;
  sessionToken = signSessionToken();
});

after(() => {
  Object.assign(console, originals);
  globalThis.fetch = realFetch;
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function runAdminRequest(): Promise<void> {
  const { createShopifyApp } = await import("@won/app-kit/shopify.server");
  const shopify = createShopifyApp(fakePrisma());
  const request = new Request(`https://audit-app.example.com/app?shop=${SHOP}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const { admin } = await shopify.authenticate.admin(request);
  await admin.graphql(`{ shop { name } }`);
}

test("the admin path really ran: the token exchange and one Admin GraphQL call were made", async () => {
  await runAdminRequest();
  // Sanity: the scenario exercised the code paths the next tests look at (otherwise they would pass vacuously).
  // Read from the faked fetch, not from the logs: with the fix nothing is logged, and this test must keep passing.
  assert.ok(fetched.some((url) => url === `https://${SHOP}/admin/oauth/access_token`), "the token exchange request was made");
  assert.ok(fetched.some((url) => url.startsWith(`https://${SHOP}/admin/api/`) && url.endsWith("/graphql.json")), "the Admin GraphQL request was made");
});

test("SEC-01: the app's client secret never reaches the logs", { todo: TODO }, () => {
  assert.equal(logged.filter((line) => line.includes(SECRET)).length, 0);
});

test("SEC-01: the merchant's session token (id token) never reaches the logs", { todo: TODO }, () => {
  assert.equal(logged.filter((line) => line.includes(sessionToken)).length, 0);
});

test("SEC-01: the shop's Admin API access token never reaches the logs", { todo: TODO }, () => {
  assert.equal(logged.filter((line) => line.includes(ACCESS_TOKEN)).length, 0);
});
