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
        {
          id: "gid://shopify/Product/1",
          title: "Alpha",
          handle: "alpha",
          secondaryLabel: "Handle: alpha",
        },
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
      secondaryLabel: "Handle: alpha",
    },
  ]);
});

test("AdminCatalogPicker submits the canonical field through a hidden input without manual GID fallback UI", async () => {
  const source = await readFile(PICKER_COMPONENT_PATH, "utf8");

  assert.match(
    source,
    /type="hidden"/,
    "Picker must submit the selected catalog id through a hidden input.",
  );
  assert.match(
    source,
    /name=\{props\.name\}/,
    "Picker must keep the original form field name for productId, collectionId, customerId, or variantId.",
  );
  assert.match(
    source,
    /value=\{selectedId\}/,
    "Picker must bind the canonical submit field to the selected catalog item id.",
  );
  assert.match(
    source,
    /setSelectedId\(option\.id\)/,
    "Picking a catalog result must populate the canonical submit field.",
  );
  assert.doesNotMatch(
    source,
    /Selected or manual \{props\.resourceType\} GID/,
    "Picker must no longer expose a manual GID fallback in the admin UI.",
  );
  assert.doesNotMatch(
    source,
    /manualValue/,
    "Picker must not keep parallel manual GID state once imported catalog selection is the only path.",
  );
  assert.match(
    source,
    /supportsBrowseDropdown/,
    "Picker must support browse-style dropdown mode for imported products and variants.",
  );
  assert.match(
    source,
    /onFocus=\{\(\) => \{\s*setIsOpen\(true\)/,
    "Picker must open its dropdown when the field receives focus.",
  );
  assert.match(
    source,
    /onMouseDown=\{\(event\) => \{/,
    "Picker option selection must be handled before blur so dropdown picks remain reliable.",
  );
  assert.match(
    source,
    /color:\s*"#101828"/,
    "Picker dropdown options must force readable text color instead of inheriting the primary form button theme.",
  );
  assert.match(
    source,
    /!isLoading && !errorMessage && isOpen && options.length > 0/,
    "Picker must render the dropdown list while focused, even before a search term is entered.",
  );
  assert.match(
    source,
    /maxHeight:\s*"280px"/,
    "Picker dropdown must cap its height so long result sets stay scrollable.",
  );
  assert.match(
    source,
    /overflowY:\s*"auto"/,
    "Picker dropdown must allow vertical scrolling for long result sets.",
  );
});

test("customer and variant picker placeholders are available in shared helpers", async () => {
  const source = await readFile(PICKER_COMPONENT_PATH, "utf8");

  assert.match(
    source,
    /resourceType: CatalogResourceType/,
    "Picker must support typed resource variants.",
  );
  assert.match(
    source,
    /Selected \{props\.resourceType\}/,
    "Picker should render the selected resource label generically, including customer and variant.",
  );
});
