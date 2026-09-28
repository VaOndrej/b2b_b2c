import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { AdminTransportError, isThrottled } from "../../app/lib/admin-client.server.ts";
import { createCliAdminClient, DEV_STORE, parseCliGraphqlErrors, type CliExec } from "../../app/lib/admin-client-cli.server.ts";

// The CLI client runs `shopify app execute` as the app (no admin token) for
// scripts and live tests. Mutations are allowed ONLY on the dev store.

const dir = mkdtempSync(path.join(tmpdir(), "won-cli-client-"));
after(() => rmSync(dir, { recursive: true, force: true }));

function argValue(args: readonly string[], flag: string): string {
  const index = args.indexOf(flag);
  assert.notEqual(index, -1, `missing ${flag}`);
  return args[index + 1]!;
}

test("cli client: spawns `shopify app execute` with the dev store, version, query and variable files", async () => {
  const calls: { command: string; args: readonly string[]; query: string; variables: unknown }[] = [];
  const exec: CliExec = async (command, args) => {
    calls.push({
      command,
      args,
      query: readFileSync(argValue(args, "--query-file"), "utf8"),
      variables: JSON.parse(readFileSync(argValue(args, "--variable-file"), "utf8")),
    });
    writeFileSync(argValue(args, "--output-file"), JSON.stringify({ shop: { id: "gid://shopify/Shop/1" } }));
    return { stdout: "", stderr: "" };
  };
  const client = createCliAdminClient({ appDir: "/repo/apps/won-discounts", tmpDir: dir, exec });
  const result = await client.graphql("query WonX { shop { id } }", { a: 1 });

  assert.deepEqual(result, { data: { shop: { id: "gid://shopify/Shop/1" } } });
  assert.equal(calls.length, 1);
  const [call] = calls;
  assert.equal(call!.command, "npx");
  assert.deepEqual(call!.args.slice(0, 3), ["shopify", "app", "execute"]);
  assert.equal(argValue(call!.args, "--path"), "/repo/apps/won-discounts");
  assert.equal(argValue(call!.args, "--store"), DEV_STORE);
  assert.equal(argValue(call!.args, "--version"), "2026-04");
  assert.equal(call!.query, "query WonX { shop { id } }");
  assert.deepEqual(call!.variables, { a: 1 });
});

test("cli client: refuses a mutation on any store other than the dev store (nothing spawned)", async () => {
  let spawned = 0;
  const exec: CliExec = async () => {
    spawned += 1;
    return { stdout: "", stderr: "" };
  };
  const client = createCliAdminClient({ appDir: "/x", tmpDir: dir, exec, store: "someone-else.myshopify.com" });
  await assert.rejects(client.graphql("mutation WonM { metafieldsSet(metafields: []) { userErrors { message } } }"), /dev store/);
  assert.equal(spawned, 0);
  // Queries are fine on another store.
  const reader = createCliAdminClient({
    appDir: "/x",
    tmpDir: dir,
    store: "someone-else.myshopify.com",
    exec: async (_command, args) => {
      writeFileSync(argValue(args, "--output-file"), JSON.stringify({ ok: true }));
      return { stdout: "", stderr: "" };
    },
  });
  assert.deepEqual(await reader.graphql("  # comment\nquery WonQ { shop { id } }"), { data: { ok: true } });
});

test("cli client: maps CLI failures to THROTTLED errors, transport errors or GraphQL errors", async () => {
  const failing = (stderr: string): CliExec =>
    async () => {
      throw Object.assign(new Error("Command failed"), { stdout: "", stderr });
    };

  const throttled = createCliAdminClient({ appDir: "/x", tmpDir: dir, exec: failing("Error: Throttled (THROTTLED)") });
  assert.equal(isThrottled(await throttled.graphql("query A { shop { id } }")), true);

  const transport = createCliAdminClient({ appDir: "/x", tmpDir: dir, exec: failing("request failed: 503 Service Unavailable") });
  await assert.rejects(transport.graphql("query A { shop { id } }"), (error: unknown) => {
    assert.ok(error instanceof AdminTransportError);
    assert.equal(error.status, 503);
    return true;
  });

  const network = createCliAdminClient({ appDir: "/x", tmpDir: dir, exec: failing("getaddrinfo ENOTFOUND x") });
  await assert.rejects(network.graphql("query A { shop { id } }"), (error: unknown) => {
    assert.ok(error instanceof AdminTransportError);
    assert.equal(error.status, null);
    return true;
  });

  const graphql = createCliAdminClient({ appDir: "/x", tmpDir: dir, exec: failing("Field 'nope' doesn't exist on type 'Shop'") });
  const result = await graphql.graphql("query A { shop { nope } }");
  assert.equal(isThrottled(result), false);
  assert.match(result.errors?.[0]?.message ?? "", /doesn't exist/);
});

// Real output of `shopify app execute` (CLI 3.92.1, 2026-09-28) for a query with
// an unknown field, spinner lines removed: exit code 0, NO output file, errors
// in a box. (M8: the box contains `"line": 3` — a bare number must never be
// read as an HTTP status.)
const REAL_GRAPHQL_ERROR = `╭─ error ──────────────────────────────────────────────────────────────────────╮
│                                                                              │
│  GraphQL operation failed.                                                   │
│                                                                              │
│  {                                                                           │
│    "errors": [                                                               │
│      {                                                                       │
│        "message": "Field 'idd' doesn't exist on type 'Shop'",                │
│        "locations": [                                                        │
│          {                                                                   │
│            "line": 3,                                                        │
│            "column": 5                                                       │
│          }                                                                   │
│        ],                                                                    │
│        "path": [                                                             │
│          "query WonCliErr",                                                  │
│          "shop",                                                             │
│          "idd"                                                               │
│        ],                                                                    │
│        "extensions": {                                                       │
│          "code": "undefinedField",                                           │
│          "typeName": "Shop",                                                 │
│          "fieldName": "idd"                                                  │
│        }                                                                     │
│      }                                                                       │
│    ]                                                                         │
│  }                                                                           │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
`;

const exitZeroNoFile = (stdout: string): CliExec => async () => ({ stdout, stderr: "" });

test("cli client: exit 0 without an output file + an error box = a GraphQL error result (real CLI output)", async () => {
  const client = createCliAdminClient({ appDir: "/x", tmpDir: dir, exec: exitZeroNoFile(REAL_GRAPHQL_ERROR) });
  const result = await client.graphql("query A { shop { idd } }");
  assert.equal(result.data, null);
  assert.equal(result.errors?.[0]?.message, "Field 'idd' doesn't exist on type 'Shop'");
  assert.equal(result.errors?.[0]?.extensions?.code, "undefinedField");
  assert.equal(isThrottled(result), false);
});

test("cli client M8: numbers like `\"line\": 512` inside a GraphQL error are not HTTP statuses; a THROTTLED box is retryable", async () => {
  const line512 = REAL_GRAPHQL_ERROR.replace('"line": 3', '"line": 512').replace('"column": 5', '"column": 503');
  assert.ok(line512.includes('"line": 512'));
  const failing: CliExec = async () => {
    throw Object.assign(new Error("Command failed"), { stdout: line512, stderr: "" });
  };
  const result = await createCliAdminClient({ appDir: "/x", tmpDir: dir, exec: failing }).graphql("query A { shop { idd } }");
  assert.equal(result.errors?.[0]?.message, "Field 'idd' doesn't exist on type 'Shop'", "a GraphQL error, not a transport error");

  const throttledBox = REAL_GRAPHQL_ERROR.replace("Field 'idd' doesn't exist on type 'Shop'", "Throttled").replace('"undefinedField"', '"THROTTLED"');
  const throttled = await createCliAdminClient({ appDir: "/x", tmpDir: dir, exec: exitZeroNoFile(throttledBox) }).graphql("query A { shop { id } }");
  assert.equal(isThrottled(throttled), true);

  // A box whose JSON was wrapped mid-string still yields the messages.
  const wrapped = "GraphQL operation failed.\n│  {\"errors\": [{\"message\": \"Something went     │\n│  wrong\"}]}  │";
  assert.ok((parseCliGraphqlErrors(wrapped) ?? []).length >= 1);
  assert.equal(parseCliGraphqlErrors("no box here"), null);
});

test("cli client M8: only real HTTP status phrases are transport errors", async () => {
  const cases: [string, number | null][] = [
    ["Error: request to https://x failed: 503 Service Unavailable", 503],
    ["HTTP/1.1 502 Bad Gateway", 502],
    ["status code 429", 429],
    ["read ECONNRESET", null],
  ];
  for (const [stderr, status] of cases) {
    const client = createCliAdminClient({
      appDir: "/x",
      tmpDir: dir,
      exec: async () => {
        throw Object.assign(new Error("Command failed"), { stdout: "", stderr });
      },
    });
    await assert.rejects(client.graphql("query A { shop { id } }"), (error: unknown) => {
      assert.ok(error instanceof AdminTransportError, stderr);
      assert.equal(error.status, status, stderr);
      return true;
    });
  }
  const plain = createCliAdminClient({
    appDir: "/x",
    tmpDir: dir,
    exec: async () => {
      throw Object.assign(new Error("Command failed"), { stdout: "", stderr: "Something on line 512 went wrong" });
    },
  });
  const result = await plain.graphql("query A { shop { id } }");
  assert.match(result.errors?.[0]?.message ?? "", /line 512/, "not a transport error");
});
