import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildCatalogSearchUrl,
  normalizeCatalogSearchItems,
} from "../../app/components/admin-catalog-picker.shared.ts";

const PICKER_COMPONENT_PATH = "app/components/admin-catalog-picker.tsx";

test("buildCatalogSearchUrl encodes query and includes type + limit", () => {
  const url = buildCatalogSearchUrl({
    endpoint: "/app/api/catalog-search",
    resourceType: "product",
    query: "winter boots",
    limit: 12,
  });

  assert.equal(
    url,
    "/app/api/catalog-search?type=product&q=winter+boots&limit=12",
  );
});

test("normalizeCatalogSearchItems accepts supported payload shapes and filters invalid rows", () => {
  const payload = {
    data: {
      items: [
        { id: "gid://shopify/Product/1", title: "Alpha", handle: "alpha" },
        { id: "", title: "Missing ID" },
        { id: "gid://shopify/Product/2", title: "" },
      ],
    },
  };

  assert.deepEqual(normalizeCatalogSearchItems(payload), [
    {
      id: "gid://shopify/Product/1",
      title: "Alpha",
      handle: "alpha",
    },
  ]);
});

test("AdminCatalogPicker keeps the original field name on the visible manual GID input", async () => {
  const source = await readFile(PICKER_COMPONENT_PATH, "utf8");

  assert.match(
    source,
    /Selected or manual \{props\.resourceType\} GID/,
    "Picker must keep manual GID fallback visible.",
  );
  assert.match(
    source,
    /name=\{props\.name\}/,
    "Picker must submit through the original productId or collectionId field name.",
  );
  assert.match(
    source,
    /required=\{props\.required\}/,
    "Picker must preserve required validation on the canonical submit field.",
  );
  assert.match(
    source,
    /value=\{manualValue\}/,
    "Picker must bind the canonical submit field to the selected or manual GID value.",
  );
  assert.match(
    source,
    /setManualValue\(option\.id\)/,
    "Picking a catalog search result must populate the canonical GID input.",
  );
});
