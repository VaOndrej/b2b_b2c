import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// MVP_5_3 Phase 2 — the Catalogs admin route delegates writes to
// handleCatalogsSettingsAction (move-not-copy, same pattern as the MVP_5_1
// catalog-rules extraction).
// MVP_5_5 — it split in two: app.catalogs is a layout owning the page shell and
// the persistent CatalogsRail, app.catalogs._index is the create pane. The
// per-catalog settings form now lives only in the editor, not once per card here.

const LAYOUT_PATH = "app/routes/app.catalogs.tsx";
const INDEX_PATH = "app/routes/app.catalogs._index.tsx";
const RAIL_PATH = "app/components/catalogs-rail.tsx";
const VIEW_PATH = "app/components/catalogs-view.tsx";
const SERVER_PATH = "app/services/catalogs-settings.server.ts";
const NAV_PATH = "app/routes/app.tsx";

test("catalogs layout owns the rail and an outlet, and lists catalogs for both children", async () => {
  const source = await readFile(LAYOUT_PATH, "utf8");
  assert.match(source, /export const loader/);
  assert.match(source, /export default function/);
  assert.match(source, /listPriceCatalogs\(\)/, "layout loader must list catalogs for the rail");
  assert.match(source, /<CatalogsRail/, "layout must render the shared CatalogsRail");
  assert.match(source, /<Outlet\s*\/>/, "layout must render its child route");
  assert.doesNotMatch(
    source,
    /export const action/,
    "writes belong to the leaf routes that native form posts target",
  );
});

test("catalogs rail links to the create pane first, then to each catalog editor", async () => {
  const source = await readFile(RAIL_PATH, "utf8");
  assert.match(source, /href="\/app\/catalogs"/, "rail must link to the create pane");
  assert.match(source, /\/app\/catalogs\/\$\{catalog\.id\}/, "rail must link to each catalog editor");
  assert.match(source, /activeCatalogId/, "rail must mark the active catalog");
});

test("catalogs index route is the create pane and delegates the write", async () => {
  const source = await readFile(INDEX_PATH, "utf8");
  assert.match(source, /export const action/);
  assert.match(source, /export default function/);
  assert.match(source, /<CatalogCreateView/, "index must render the shared CatalogCreateView");
  assert.match(
    source,
    /handleCatalogsSettingsAction\(\{\s*formData\s*\}\)/,
    "index action must delegate writes to the catalogs settings module",
  );
  assert.doesNotMatch(source, /<s-page/, "the page shell comes from the layout");
});

test("catalogs create view exposes the save-catalog form with all catalog fields", async () => {
  const source = await readFile(VIEW_PATH, "utf8");
  assert.match(source, /name="intent" value="save-catalog"/, "view must expose the save-catalog form");
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
  ]) {
    assert.match(source, new RegExp(field.replace(/[/\\^$*+?.()|[\]{}]/g, "\\$&")), `view must render field ${field}`);
  }
  assert.doesNotMatch(
    source,
    /value="delete-catalog"/,
    "delete moved to the catalog editor; the create pane must not carry it",
  );
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
