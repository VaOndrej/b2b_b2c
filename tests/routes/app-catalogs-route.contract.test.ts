import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MVP_5_3 Phase 2 — the Catalogs admin route is a standalone module that renders
// the shared CatalogsView and delegates writes to handleCatalogsSettingsAction
// (move-not-copy, same pattern as the MVP_5_1 catalog-rules extraction).

const ROUTE_PATH = "app/routes/app.catalogs.tsx";
const VIEW_PATH = "app/components/catalogs-view.tsx";
const SERVER_PATH = "app/services/catalogs-settings.server.ts";
const NAV_PATH = "app/routes/app.tsx";

test("catalogs route is standalone (own loader/action/component)", async () => {
  const source = await readFile(ROUTE_PATH, "utf8");
  assert.match(source, /export const loader/);
  assert.match(source, /export const action/);
  assert.match(source, /export default function/);
  assert.match(source, /<CatalogsView/, "route must render the shared CatalogsView");
  assert.match(
    source,
    /handleCatalogsSettingsAction\(\{\s*formData\s*\}\)/,
    "route action must delegate writes to the catalogs settings module",
  );
  assert.match(source, /listPriceCatalogs\(\)/, "route loader must list catalogs");
});

test("catalogs view exposes create/edit/delete forms with all catalog fields", async () => {
  const source = await readFile(VIEW_PATH, "utf8");
  assert.match(source, /name="intent" value="save-catalog"/, "view must expose the save-catalog form");
  assert.match(source, /name="intent" value="delete-catalog"/, "view must expose the delete-catalog form");
  for (const field of [
    'name="name"',
    'name="priority"',
    'name="status"',
    'name="membershipMode"',
    'name="matchCompany"',
    'name="audienceTags"',
    'name="marketCountry"',
    'name="marketCurrency"',
    'name="marketLanguage"',
    'name="catalogId"',
  ]) {
    assert.match(source, new RegExp(field.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")), `view must render field ${field}`);
  }
});

test("catalogs settings server dispatches save (create/update) and delete intents", async () => {
  const source = await readFile(SERVER_PATH, "utf8");
  assert.match(source, /"save-catalog"/);
  assert.match(source, /"delete-catalog"/);
  assert.match(source, /createPriceCatalog/);
  assert.match(source, /updatePriceCatalog/);
  assert.match(source, /deletePriceCatalog/);
});

test("admin nav links to the Catalogs route", async () => {
  const source = await readFile(NAV_PATH, "utf8");
  assert.match(source, /href="\/app\/catalogs"/, "nav must link to /app/catalogs");
});
