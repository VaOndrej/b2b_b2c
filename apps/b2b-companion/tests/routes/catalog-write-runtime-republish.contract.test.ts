import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

/**
 * Contract: every catalog write republishes the runtime, create/update/delete land on
 * the right URL, and the system catalogs (default / b2b) stay protected. These are
 * wiring facts checked against the route/service source — matching the existing
 * app-catalog*-route.contract test style (readFile + regex, no route execution).
 */

const CREATE_ROUTE = "app/routes/app.catalogs._index.tsx";
const EDITOR_ROUTE = "app/routes/app.catalogs.$catalogId.tsx";
const CATALOG_SERVICE = "app/services/price-catalog.server.ts";

test("create route republishes the runtime AFTER persisting, then redirects into the new editor", async () => {
  const source = await readFile(CREATE_ROUTE, "utf8");
  assert.match(source, /handleCatalogsSettingsAction\(/, "must persist the write");
  assert.match(source, /republishCatalogRuntime\(admin\)/, "must republish the runtime");
  // Republish must come AFTER the persist, or the runtime would publish stale state.
  assert.ok(
    source.indexOf("handleCatalogsSettingsAction(") <
      source.indexOf("republishCatalogRuntime(admin)"),
    "republish must run after the write",
  );
  assert.match(
    source,
    /redirect\(createdId \? `\/app\/catalogs\/\$\{createdId\}` : "\/app\/catalogs"\)/,
    "create → redirect into the new catalog's editor (fallback to the list)",
  );
});

test("editor route republishes on every write and redirects off a deleted catalog", async () => {
  const source = await readFile(EDITOR_ROUTE, "utf8");
  assert.match(source, /handleCatalogsSettingsAction\(/);
  assert.match(source, /republishCatalogRuntime\(admin\)/);
  assert.ok(
    source.indexOf("handleCatalogsSettingsAction(") <
      source.indexOf("republishCatalogRuntime(admin)"),
    "republish must run after the write",
  );
  assert.match(
    source,
    /intent === "delete-catalog"[\s\S]*?redirect\("\/app\/catalogs"\)/,
    "delete-catalog must redirect off the now-dead editor URL",
  );
});

test("system catalogs (default / b2b) cannot be deleted", async () => {
  const source = await readFile(CATALOG_SERVICE, "utf8");
  assert.match(
    source,
    /if \(existing\.isSystem\) \{\s*throw new Error\("System catalogs/,
    "deletePriceCatalog must refuse system catalogs",
  );
});

test("system catalogs keep their priority/identity on update (only editable surface changes)", async () => {
  const source = await readFile(CATALOG_SERVICE, "utf8");
  // The update payload branches on isSystem and, for system catalogs, omits priority
  // (and matchCompany) so their seeded identity/priority is immutable.
  assert.match(source, /const data = existing\.isSystem/);
  assert.match(
    source,
    /existing\.isSystem[\s\S]*?\?\s*\{[^}]*name[^}]*status[^}]*membershipMode[^}]*\}/,
    "system-catalog update must not write priority/matchCompany",
  );
});
