// Isolated SQLite test database (DATA-3: the fixture is DERIVED from
// schema.prisma via `prisma db push`, never hand-written DDL — see
// apps/won-toasts/tests/lib/test-db.ts for the Postgres sibling of this
// pattern; won-discounts uses SQLite, so each test file gets its own
// throwaway *file* instead of its own Postgres schema).

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "../../app/generated/prisma/client.ts";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface TestDatabase {
  prisma: PrismaClient;
  /** Delete the throwaway SQLite file and disconnect. Call from `after()`. */
  drop: () => Promise<void>;
}

/**
 * Create an isolated SQLite file containing every model in schema.prisma.
 *
 * @param label short name of the suite, used in the temp dir name for debugging.
 */
export function createTestDatabase(label: string): TestDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), `won-discounts-${label}-`));
  const dbPath = path.join(dir, "test.sqlite");
  const url = `file:${dbPath}`;

  // `db push` creates the file and applies every model straight from the
  // single source of truth (schema.prisma) — no hand-written CREATE TABLE.
  execFileSync(
    "npx",
    ["prisma", "db", "push", "--schema", "prisma/schema.prisma", "--skip-generate", "--accept-data-loss"],
    { cwd: APP_ROOT, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
  );

  const prisma = new PrismaClient({ datasourceUrl: url });
  return {
    prisma,
    async drop() {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
