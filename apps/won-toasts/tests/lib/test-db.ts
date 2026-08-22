// Isolated Postgres test database (DATA-3: the fixture is DERIVED from
// schema.prisma, never hand-written).
//
// History: these service tests used to spin up a throwaway SQLite file
// (`datasourceUrl: file:…`) with hand-typed `CREATE TABLE` DDL. When the app
// moved to Postgres (schema.prisma `provider = "postgresql"`), every one of them
// started failing with "the URL must start with the protocol postgresql://" —
// and the hand-written DDL had silently drifted from the real schema anyway
// (ToastAppConfig.global was declared TEXT in the fixture, Json in the schema).
//
// So: each test file gets its OWN Postgres schema inside the dev database, built
// by `prisma db push` from the single source of truth, and dropped afterwards.
// Unique schema names keep parallel test files from colliding.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "../../app/generated/prisma/client.ts";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Local dev default — matches apps/won-toasts/docker-compose.yml. */
const FALLBACK_URL = "postgresql://won:won@localhost:5432/won_toasts";

/**
 * The base connection string. `tsx --test` doesn't load .env, so fall back to
 * reading it before the hard-coded docker default.
 */
function baseUrl(): string {
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv && /^postgres(ql)?:\/\//.test(fromEnv)) return fromEnv;
  try {
    const dotenv = readFileSync(path.join(APP_ROOT, ".env"), "utf8");
    const match = dotenv.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (match && /^postgres(ql)?:\/\//.test(match[1])) return match[1];
  } catch {
    // no .env — fall through to the docker default
  }
  return FALLBACK_URL;
}

function withSchema(url: string, schema: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("schema", schema);
  return parsed.toString();
}

let counter = 0;

export interface TestDatabase {
  prisma: PrismaClient;
  /** Drop the throwaway schema and disconnect. Call from `after()`. */
  drop: () => Promise<void>;
}

/**
 * Create an isolated Postgres schema containing every model in schema.prisma.
 *
 * @param label short name of the suite, used in the schema name for debugging.
 */
export function createTestDatabase(label: string): TestDatabase {
  const schema = `test_${label}_${process.pid}_${++counter}`;
  const url = withSchema(baseUrl(), schema);

  // `db push` creates the schema if it doesn't exist and applies every model.
  execFileSync(
    "npx",
    ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"],
    { cwd: APP_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );

  const prisma = new PrismaClient({ datasourceUrl: url });
  return {
    prisma,
    async drop() {
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await prisma.$disconnect();
    },
  };
}
