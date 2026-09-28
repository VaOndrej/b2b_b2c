import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { AdminTransportError, isThrottled } from "../../app/lib/admin-client.server.ts";
import { createCliAdminClient, DEV_STORE, type CliExec } from "../../app/lib/admin-client-cli.server.ts";

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
