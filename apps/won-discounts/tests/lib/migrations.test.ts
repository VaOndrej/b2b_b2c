import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { APP_ROOT, createTestDatabase, prismaCli, type TestDatabase } from "./test-db.ts";

// Audit P3-8: production runs `prisma migrate deploy`, so the committed
// migrations — not schema.prisma — are what exists in the production DB.
//   1. Every test DB is built from those migrations (tests/lib/test-db.ts).
//   2. The migrations and schema.prisma never drift apart: a model or column
//      added to the schema without a migration fails here, not in production.

const MIGRATIONS_DIR = path.join(APP_ROOT, "prisma/migrations");
const committedMigrations = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

let db: TestDatabase;
let scratch = "";

before(() => {
  db = createTestDatabase("migrations");
  scratch = mkdtempSync(path.join(tmpdir(), "won-discounts-drift-"));
});

after(async () => {
  await db.drop();
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

test("the test database is built by `prisma migrate deploy` from every committed migration", async () => {
  assert.ok(committedMigrations.length >= 2, `migrations: ${committedMigrations.join(", ")}`);
  const applied = await db.prisma.$queryRawUnsafe<Array<{ migration_name: string; finished_at: unknown }>>(
    'SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY migration_name',
  );
  assert.deepEqual(
    applied.map((row) => row.migration_name),
    committedMigrations,
  );
  assert.ok(applied.every((row) => row.finished_at !== null), "every migration finished");
});

/**
 * Exit code of `prisma migrate diff --from-migrations … --to-schema-datamodel …
 * --exit-code`: 0 = no difference, 2 = drift (1 = the command itself failed).
 * The shadow database is a throwaway SQLite file.
 */
function migrationDiffExitCode(schemaPath: string, label: string): { code: number; output: string } {
  const shadow = `file:${path.join(scratch, `${label}-shadow.sqlite`)}`;
  try {
    const output = prismaCli(
      [
        "migrate",
        "diff",
        "--from-migrations",
        MIGRATIONS_DIR,
        "--to-schema-datamodel",
        schemaPath,
        "--shadow-database-url",
        shadow,
        "--exit-code",
      ],
      { DATABASE_URL: shadow },
    );
    return { code: 0, output };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("prisma/migrations and schema.prisma do not drift (migrate diff --exit-code)", () => {
  const result = migrationDiffExitCode(path.join(APP_ROOT, "prisma/schema.prisma"), "current");
  assert.equal(result.code, 0, `schema.prisma differs from the migrations — add a migration:\n${result.output}`);
});

test("the drift check is not vacuous: a model without a migration is reported (exit code 2)", () => {
  const drifted = path.join(scratch, "schema.prisma");
  writeFileSync(
    drifted,
    `${readFileSync(path.join(APP_ROOT, "prisma/schema.prisma"), "utf8")}\nmodel DriftProbe {\n  id String @id\n}\n`,
  );
  const result = migrationDiffExitCode(drifted, "drifted");
  assert.equal(result.code, 2, `expected drift to be detected:\n${result.output}`);
  assert.match(result.output, /DriftProbe/);
});
