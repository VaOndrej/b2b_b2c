// Isolated SQLite test database, built from the COMMITTED MIGRATIONS with
// `prisma migrate deploy` — exactly what production runs (package.json
// `prisma:migrate:deploy`). Audit P3-8: `db push` built the tables straight
// from schema.prisma, so a model added without a migration passed every test
// and then did not exist in production. Drift between the migrations and
// schema.prisma is caught separately by tests/lib/migrations.test.ts.
// (apps/won-toasts/tests/lib/test-db.ts is the Postgres sibling of this
// pattern; won-discounts uses SQLite, so each test file gets its own throwaway
// *file* instead of its own Postgres schema.)

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "../../app/generated/prisma/client.ts";

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface TestDatabase {
  prisma: PrismaClient;
  /** `file:` DATABASE_URL of the throwaway SQLite file (for code that builds its own client). */
  url: string;
  /** A NEW PrismaClient on the same file (its own connection, e.g. a second app instance). Disconnect it yourself. */
  connect: () => PrismaClient;
  /** Delete the throwaway SQLite file and disconnect. Call from `after()`. */
  drop: () => Promise<void>;
}

/** Run the Prisma CLI of this app (stdio captured; throws with the output on a non-zero exit). */
export function prismaCli(args: string[], env: Record<string, string> = {}): string {
  return execFileSync("npx", ["prisma", ...args], {
    cwd: APP_ROOT,
    env: { ...process.env, ...env },
    stdio: "pipe",
    encoding: "utf8",
  });
}

/**
 * Create an isolated SQLite file with every committed migration applied.
 *
 * @param label short name of the suite, used in the temp dir name for debugging.
 */
export function createTestDatabase(label: string): TestDatabase {
  const dir = mkdtempSync(path.join(tmpdir(), `won-discounts-${label}-`));
  const dbPath = path.join(dir, "test.sqlite");
  const url = `file:${dbPath}`;

  // `migrate deploy` creates the file and applies prisma/migrations/* in order,
  // recording each one in _prisma_migrations — no schema shortcut.
  prismaCli(["migrate", "deploy", "--schema", "prisma/schema.prisma"], { DATABASE_URL: url });

  const prisma = new PrismaClient({ datasourceUrl: url });
  return {
    prisma,
    url,
    connect: () => new PrismaClient({ datasourceUrl: url }),
    async drop() {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
