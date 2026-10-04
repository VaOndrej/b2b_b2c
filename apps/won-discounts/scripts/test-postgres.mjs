#!/usr/bin/env node
/* eslint-env node */
// The Postgres port's own gate (MVP 7, contract M10): `npm run test:postgres -w won-discounts`. Needs Docker.
//   1. starts the local Postgres (docker-compose.yml, port 5433) and waits until it answers;
//   2. a throwaway schema (`won_test_<time>`): `prisma migrate deploy` of prisma/postgres/migrations — what
//      fly.toml's release_command runs;
//   3. `prisma migrate diff` database ↔ prisma/postgres/schema.prisma: no drift (the partial index is ignored by
//      Prisma, the test below pins it);
//   4. a Prisma client generated for Postgres into a temp folder (app/generated/prisma, the SQLite client of dev
//      and the unit tests, is NOT touched) and tests/postgres/*.pgtest.ts run against it;
//   5. drops the schema and the temp folder. The container keeps running (stop: `docker compose … down`).
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPOSE = path.join(APP, "docker-compose.yml");
const schemaName = `won_test_${Date.now()}`;
const BASE = "postgresql://won:won@localhost:5433/won_discounts";
const URL = `${BASE}?schema=${schemaName}`;
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: APP, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });

run("docker", ["compose", "-f", COMPOSE, "up", "-d", "db"]);
let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  ready = spawnSync("docker", ["compose", "-f", COMPOSE, "exec", "-T", "db", "pg_isready", "-U", "won", "-d", "won_discounts"], { cwd: APP }).status === 0;
  if (!ready) await new Promise((r) => setTimeout(r, 1000));
}
if (!ready) throw new Error("the local Postgres did not become ready (docker compose logs db)");

const tmp = fs.mkdtempSync(path.join(APP, "prisma/.pgtest-"));
let code = 1;
try {
  const schema = fs
    .readFileSync(path.join(APP, "prisma/postgres/schema.prisma"), "utf8")
    .replace('output       = "../../app/generated/prisma"', 'output       = "./client"');
  if (!schema.includes('"./client"')) throw new Error("prisma/postgres/schema.prisma: the generator output line changed");
  const schemaFile = path.join(tmp, "schema.prisma");
  fs.writeFileSync(schemaFile, schema);
  fs.cpSync(path.join(APP, "prisma/postgres/migrations"), path.join(tmp, "migrations"), { recursive: true });
  const env = { ...process.env, DATABASE_URL: URL };
  console.log(run("npx", ["prisma", "migrate", "deploy", "--schema", schemaFile], { env }).split("\n").filter((l) => /migration|applied/i.test(l)).join("\n"));
  const drift = spawnSync("npx", ["prisma", "migrate", "diff", "--from-url", URL, "--to-schema-datamodel", schemaFile, "--exit-code"], { cwd: APP, env, encoding: "utf8" });
  if (drift.status !== 0) throw new Error(`the migrated database differs from prisma/postgres/schema.prisma:\n${drift.stdout}${drift.stderr}`);
  console.log("✓ no drift between the migrated database and the Postgres schema");
  run("npx", ["prisma", "generate", "--schema", schemaFile], { env });
  const test = spawnSync("npx", ["tsx", "--test", "tests/postgres/postgres.pgtest.ts"], { cwd: APP, env: { ...env, WON_PG_CLIENT: path.join(tmp, "client/client.ts"), NODE_ENV: "test" }, stdio: "inherit" });
  code = test.status ?? 1;
} finally {
  try {
    run("docker", ["compose", "-f", COMPOSE, "exec", "-T", "db", "psql", "-U", "won", "-d", "won_discounts", "-c", `DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`]);
  } catch (error) {
    console.error(`could not drop ${schemaName}: ${error instanceof Error ? error.message : error}`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(code);
