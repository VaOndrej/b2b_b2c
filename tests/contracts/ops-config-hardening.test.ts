import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const PRISMA_SCHEMA_PATH = "prisma/schema.prisma";
const DOCKERFILE_PATH = "Dockerfile";
const SHOPIFY_CONFIG_PATH = "shopify.app.toml";

test("prisma datasource uses env DATABASE_URL instead of hardcoded sqlite path", async () => {
  const schema = await readFile(PRISMA_SCHEMA_PATH, "utf8");

  assert.match(
    schema,
    /url\s*=\s*env\("DATABASE_URL"\)/,
    "[OPS CONFIG FAIL] Prisma datasource must use env(\"DATABASE_URL\").",
  );
  assert.doesNotMatch(
    schema,
    /url\s*=\s*"file:dev\.sqlite"/,
    "[OPS CONFIG FAIL] Prisma datasource must not hardcode file:dev.sqlite.",
  );
});

test("dockerfile defines sqlite DATABASE_URL and persistent prisma volume", async () => {
  const dockerfile = await readFile(DOCKERFILE_PATH, "utf8");

  assert.match(
    dockerfile,
    /ENV\s+DATABASE_URL\s*=\s*file:\/app\/prisma\/dev\.sqlite/,
    "[OPS CONFIG FAIL] Dockerfile must define DATABASE_URL for container runtime.",
  );
  assert.match(
    dockerfile,
    /VOLUME\s+\["\/app\/prisma"\]/,
    "[OPS CONFIG FAIL] Dockerfile must expose /app/prisma as persistent volume.",
  );
});

test("shopify app config stays CLI-compatible and free of template artifacts", async () => {
  const config = await readFile(SHOPIFY_CONFIG_PATH, "utf8");

  assert.doesNotMatch(
    config,
    /include_config_on_deploy\s*=/,
    "[OPS CONFIG FAIL] include_config_on_deploy is not supported by the current Shopify CLI config parser.",
  );
  assert.doesNotMatch(
    config,
    /\[product\.metafields\.app\.demo_info\]/,
    "[OPS CONFIG FAIL] Template metafield block must be removed.",
  );
  assert.doesNotMatch(
    config,
    /\[metaobjects\.app\.example\]/,
    "[OPS CONFIG FAIL] Template metaobject block must be removed.",
  );
});
