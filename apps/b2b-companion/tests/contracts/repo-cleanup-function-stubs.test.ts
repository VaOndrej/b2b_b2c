import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants } from "node:fs";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test("repo cleanup removes non-functional function extension stubs", async () => {
  const cartTomlExists = await exists("functions/cart-validation/shopify.extension.toml");
  const discountTomlExists = await exists(
    "functions/discount-function/shopify.extension.toml",
  );

  assert.equal(
    cartTomlExists,
    false,
    "[CLEANUP FAIL] functions/cart-validation/shopify.extension.toml nema byt v repu.",
  );
  assert.equal(
    discountTomlExists,
    false,
    "[CLEANUP FAIL] functions/discount-function/shopify.extension.toml nema byt v repu.",
  );
});

test("global types file no longer exports misleading unused AuditLogEntry", async () => {
  const path = "types/global.types.ts";
  const hasFile = await exists(path);
  if (!hasFile) {
    assert.equal(hasFile, false);
    return;
  }

  const content = await readFile(path, "utf8");
  assert.equal(
    /AuditLogEntry/.test(content),
    false,
    "[CLEANUP FAIL] AuditLogEntry nema byt deklarovan jako nepouzivany artifact.",
  );
});
