import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const templateRoot = path.join(repoRoot, "apps/_template");

function readTemplateFile(relativePath: string): string {
  return readFileSync(path.join(templateRoot, relativePath), "utf8");
}

test("standalone app template isolates its generated Prisma client", () => {
  const schema = readTemplateFile("prisma/schema.prisma");
  const dbServer = readTemplateFile("app/db.server.ts");
  const viteConfig = readTemplateFile("vite.config.ts");

  assert.match(schema, /output\s*=\s*"\.\.\/app\/generated\/prisma"/u);
  assert.match(dbServer, /from\s+"\.\/generated\/prisma"/u);
  assert.match(viteConfig, /app\W+generated\W+prisma/u);
  assert.doesNotMatch(dbServer, /from\s+"@prisma\/client"/u);
});

test("standalone app template exposes shared test hooks without fake E2E coverage", () => {
  const packageJson = JSON.parse(readTemplateFile("package.json")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
  };

  assert.equal(packageJson.dependencies?.["@won/testing"], "*");
  for (const script of ["test:unit", "test:e2e", "test:e2e:local:all"]) {
    assert.ok(
      packageJson.scripts?.[script],
      `Missing template script: ${script}`,
    );
  }
  assert.match(
    packageJson.scripts?.["test:e2e"] ?? "",
    /require-e2e-contract/u,
  );
});

test("standalone app template is unlinked and contains no Margin Guard coupling", () => {
  const shopifyConfig = readTemplateFile("shopify.app.toml");
  const packageJson = readTemplateFile("package.json");
  const e2eConfig = readTemplateFile("e2e.app.config.mjs");

  assert.match(shopifyConfig, /^client_id\s*=\s*""$/mu);
  assert.doesNotMatch(
    `${shopifyConfig}\n${packageJson}\n${e2eConfig}`,
    /margin.?guard|MARGIN_GUARD/iu,
  );
});
