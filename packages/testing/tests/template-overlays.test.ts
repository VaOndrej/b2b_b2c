import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  MAIN_PRODUCT_SECTION_TYPES,
  applyTemplateOverlay,
  applyTemplateOverlays,
  planTemplateOverlay,
  planTemplateOverlays,
  validateTemplateOverlay,
} from "../src/template-overlays.js";

const QUANTITY_TIERS_BLOCK = {
  id: "won_discounts_quantity_tiers",
  type: "shopify://apps/won-discounts/blocks/quantity_tiers/11111111-1111-1111-1111-111111111111",
};

function horizonProductTemplate() {
  return {
    sections: {
      main: {
        type: "product-information",
        blocks: {
          "media-gallery": { type: "_product-media-gallery", static: true, settings: {}, blocks: {} },
          "product-details": { type: "_product-details", static: true, settings: {}, blocks: {}, block_order: [] },
        },
        block_order: [],
      },
    },
  };
}

function dawnProductTemplate() {
  return {
    sections: {
      main: {
        type: "main-product",
        blocks: {
          vendor: { type: "vendor", settings: {} },
          title: { type: "title", settings: {} },
          price: { type: "price", settings: {} },
          variant_picker: { type: "variant_picker", settings: {} },
          buy_buttons: { type: "buy_buttons", settings: {} },
        },
        block_order: ["vendor", "title", "price", "variant_picker", "buy_buttons"],
        settings: {},
      },
      "related-products": { type: "related-products", blocks: {}, block_order: [] },
    },
  };
}

test("MAIN_PRODUCT_SECTION_TYPES covers both Horizon and Dawn's main product section type", () => {
  assert.deepEqual(
    [...MAIN_PRODUCT_SECTION_TYPES].sort(),
    ["main-product", "product-information"],
  );
});

test("validateTemplateOverlay defaults sectionTypes and position, rejects malformed input", () => {
  const normalized = validateTemplateOverlay({
    template: "templates/product.json",
    block: QUANTITY_TIERS_BLOCK,
  });
  assert.deepEqual(normalized.sectionTypes, MAIN_PRODUCT_SECTION_TYPES);
  assert.equal(normalized.position, "end");
  assert.deepEqual(normalized.block.settings, {});

  assert.throws(() => validateTemplateOverlay(null), /must be an object/u);
  assert.throws(
    () => validateTemplateOverlay({ block: QUANTITY_TIERS_BLOCK }),
    /template must be a non-empty string/u,
  );
  assert.throws(
    () =>
      validateTemplateOverlay({
        template: "/etc/passwd",
        block: QUANTITY_TIERS_BLOCK,
      }),
    /relative to the theme workspace/u,
  );
  assert.throws(
    () => validateTemplateOverlay({ template: "templates/product.json" }),
    /block must be an object/u,
  );
  assert.throws(
    () =>
      validateTemplateOverlay({
        template: "templates/product.json",
        block: QUANTITY_TIERS_BLOCK,
        position: { nonsense: true },
      }),
    /position must be/u,
  );
});

test("planTemplateOverlay finds Dawn's main-product section by type and computes insert position", () => {
  const plan = planTemplateOverlay(dawnProductTemplate(), {
    template: "templates/product.json",
    block: QUANTITY_TIERS_BLOCK,
    position: { before: "buy_buttons" },
  });
  assert.equal(plan.sectionKey, "main");
  assert.equal(plan.sectionType, "main-product");
  assert.equal(plan.action, "insert");
  assert.equal(plan.index, 4);
});

test("planTemplateOverlay finds Horizon's product-information section by type generically", () => {
  const plan = planTemplateOverlay(horizonProductTemplate(), {
    template: "templates/product.json",
    block: QUANTITY_TIERS_BLOCK,
  });
  assert.equal(plan.sectionKey, "main");
  assert.equal(plan.sectionType, "product-information");
  assert.equal(plan.action, "insert");
  assert.equal(plan.index, 0);
});

test("planTemplateOverlay fails loudly when no section matches the expected type", () => {
  const template = { sections: { main: { type: "not-a-product-section", blocks: {}, block_order: [] } } };
  assert.throws(
    () =>
      planTemplateOverlay(template, {
        template: "templates/product.json",
        block: QUANTITY_TIERS_BLOCK,
      }),
    /No section with type in/u,
  );
});

test("planTemplateOverlay fails loudly when the section type is ambiguous", () => {
  const template = {
    sections: {
      a: { type: "main-product", blocks: {}, block_order: [] },
      b: { type: "product-information", blocks: {}, block_order: [] },
    },
  };
  assert.throws(
    () =>
      planTemplateOverlay(template, {
        template: "templates/product.json",
        block: QUANTITY_TIERS_BLOCK,
      }),
    /Ambiguous main product section/u,
  );
});

test("applyTemplateOverlay inserts the block at the requested position without mutating the input", () => {
  const original = dawnProductTemplate();
  const before = JSON.stringify(original);
  const updated = applyTemplateOverlay(original, {
    template: "templates/product.json",
    block: QUANTITY_TIERS_BLOCK,
    position: { after: "variant_picker" },
  });

  assert.equal(JSON.stringify(original), before, "input template must not be mutated");
  const section = updated.sections.main;
  assert.deepEqual(section.block_order, [
    "vendor",
    "title",
    "price",
    "variant_picker",
    "won_discounts_quantity_tiers",
    "buy_buttons",
  ]);
  assert.equal(section.blocks.won_discounts_quantity_tiers.type, QUANTITY_TIERS_BLOCK.type);
});

test("applyTemplateOverlay is idempotent", () => {
  const once = applyTemplateOverlay(dawnProductTemplate(), {
    template: "templates/product.json",
    block: QUANTITY_TIERS_BLOCK,
  });
  const twice = applyTemplateOverlay(once, {
    template: "templates/product.json",
    block: QUANTITY_TIERS_BLOCK,
  });
  assert.deepEqual(twice, once);
  assert.equal(
    once.sections.main.block_order.filter((id: string) => id === QUANTITY_TIERS_BLOCK.id).length,
    1,
  );
});

test("applyTemplateOverlay fails loudly on a block id collision with a different type", () => {
  const template = dawnProductTemplate();
  template.sections.main.blocks.won_discounts_quantity_tiers = { type: "some-other-type", settings: {} };
  template.sections.main.block_order.push("won_discounts_quantity_tiers");
  assert.throws(
    () =>
      applyTemplateOverlay(template, {
        template: "templates/product.json",
        block: QUANTITY_TIERS_BLOCK,
      }),
    /already exists .* with a different type/u,
  );
});

test("planTemplateOverlays / applyTemplateOverlays operate on real theme checkout files and are idempotent", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "won-template-overlays-"),
  );
  try {
    const workspaceDirectory = path.join(temporaryRoot, "workspace");
    await mkdir(path.join(workspaceDirectory, "templates"), { recursive: true });
    await writeFile(
      path.join(workspaceDirectory, "templates/product.json"),
      `/* Shopify generated file. */\n${JSON.stringify(dawnProductTemplate())}`,
    );

    const overlays = [
      {
        template: "templates/product.json",
        block: QUANTITY_TIERS_BLOCK,
        position: { before: "buy_buttons" },
      },
    ];

    const plans = await planTemplateOverlays({
      workspaceDirectory,
      templateOverlays: overlays,
    });
    assert.equal(plans.length, 1);
    assert.equal(plans[0].action, "insert");

    // --check must not write anything.
    const untouched = await readFile(
      path.join(workspaceDirectory, "templates/product.json"),
      "utf8",
    );
    assert.doesNotMatch(untouched, /won_discounts_quantity_tiers/u);

    const applied = await applyTemplateOverlays({
      workspaceDirectory,
      templateOverlays: overlays,
    });
    assert.equal(applied[0].action, "insert");
    const writtenContent = await readFile(
      path.join(workspaceDirectory, "templates/product.json"),
      "utf8",
    );
    assert.match(writtenContent, /won_discounts_quantity_tiers/u);
    assert.match(writtenContent, /won-discounts\/blocks\/quantity_tiers/u);

    const secondPlan = await planTemplateOverlays({
      workspaceDirectory,
      templateOverlays: overlays,
    });
    assert.equal(secondPlan[0].action, "noop");

    const reapplied = await applyTemplateOverlays({
      workspaceDirectory,
      templateOverlays: overlays,
    });
    assert.equal(reapplied[0].action, "noop");
    const finalContent = await readFile(
      path.join(workspaceDirectory, "templates/product.json"),
      "utf8",
    );
    assert.equal(
      (finalContent.match(/won_discounts_quantity_tiers/gu) ?? []).length,
      2,
      "block id should appear exactly once in blocks and once in block_order, not duplicated",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("applyTemplateOverlays fails loudly and safely rejects paths escaping the workspace", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(os.tmpdir(), "won-template-overlays-safety-"),
  );
  try {
    const workspaceDirectory = path.join(temporaryRoot, "workspace");
    await mkdir(workspaceDirectory, { recursive: true });

    await assert.rejects(
      () =>
        applyTemplateOverlays({
          workspaceDirectory,
          templateOverlays: [
            {
              template: "../outside.json",
              block: QUANTITY_TIERS_BLOCK,
            },
          ],
        }),
      /escapes the theme workspace/u,
    );

    await assert.rejects(
      () =>
        applyTemplateOverlays({
          workspaceDirectory,
          templateOverlays: [
            {
              template: "templates/product.json",
              block: QUANTITY_TIERS_BLOCK,
            },
          ],
        }),
      /Cannot read template/u,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

// Horizon renders a section-level @app block of product-information AFTER the
// whole product grid (additional_blocks); its static `_product-details` block
// accepts nested @app blocks in the buy box. parentBlockTypes targets it.
function horizonDetailsTemplate() {
  return {
    sections: {
      main: {
        type: "product-information",
        blocks: {
          "media-gallery": { type: "_product-media-gallery", static: true, settings: {}, blocks: {} },
          "product-details": {
            type: "_product-details",
            static: true,
            settings: {},
            blocks: {
              group_header: { type: "group", settings: {}, blocks: {}, block_order: [] },
              variant_picker_R3rGDr: { type: "variant-picker", settings: {}, blocks: {} },
              buy_buttons_eYQEYi: { type: "buy-buttons", settings: {}, blocks: {}, block_order: [] },
              text_desc: { type: "text", settings: {}, blocks: {} },
            },
            block_order: ["group_header", "variant_picker_R3rGDr", "buy_buttons_eYQEYi", "text_desc"],
          },
        },
        block_order: [],
      },
    },
  };
}

test("parentBlockTypes inserts into Horizon's _product-details before the buy buttons, by block type", () => {
  const original = horizonDetailsTemplate();
  const before = JSON.stringify(original);
  const overlay = {
    template: "templates/product.json",
    parentBlockTypes: ["_product-details"],
    block: QUANTITY_TIERS_BLOCK,
    position: { beforeType: "buy-buttons" },
  };
  const plan = planTemplateOverlay(original, overlay);
  assert.equal(plan.sectionKey, "main");
  assert.equal(plan.parentBlockKey, "product-details");
  assert.equal(plan.action, "insert");
  assert.equal(plan.index, 2);

  const updated = applyTemplateOverlay(original, overlay);
  assert.equal(JSON.stringify(original), before, "input template must not be mutated");
  const details = updated.sections.main.blocks["product-details"];
  assert.deepEqual(details.block_order, [
    "group_header",
    "variant_picker_R3rGDr",
    "won_discounts_quantity_tiers",
    "buy_buttons_eYQEYi",
    "text_desc",
  ]);
  assert.deepEqual(details.blocks.won_discounts_quantity_tiers, {
    type: QUANTITY_TIERS_BLOCK.type,
    settings: {},
    blocks: {},
  });
  assert.deepEqual(updated.sections.main.block_order, [], "the section's own block list is untouched");

  const again = applyTemplateOverlay(updated, overlay);
  assert.deepEqual(again, updated, "idempotent");
  assert.equal(planTemplateOverlay(updated, overlay).action, "noop");
});

test("afterType positions after the first block of that type (Dawn: after the quantity selector)", () => {
  const template = dawnProductTemplate();
  template.sections.main.blocks.quantity_selector = { type: "quantity_selector", settings: {} };
  template.sections.main.block_order.splice(4, 0, "quantity_selector");
  const updated = applyTemplateOverlay(template, {
    template: "templates/product.json",
    block: QUANTITY_TIERS_BLOCK,
    position: { afterType: "quantity_selector" },
  });
  assert.deepEqual(updated.sections.main.block_order, [
    "vendor",
    "title",
    "price",
    "variant_picker",
    "quantity_selector",
    "won_discounts_quantity_tiers",
    "buy_buttons",
  ]);
  assert.equal("blocks" in updated.sections.main.blocks.won_discounts_quantity_tiers, false, "a section-level app block has no child map");
  assert.throws(
    () =>
      planTemplateOverlay(dawnProductTemplate(), {
        template: "templates/product.json",
        block: QUANTITY_TIERS_BLOCK,
        position: { beforeType: "no-such-type" },
      }),
    /references no block of type "no-such-type"/u,
  );
});

test("parentBlockTypes fails loudly on a missing or ambiguous parent block and validates its shape", () => {
  assert.throws(
    () =>
      planTemplateOverlay(dawnProductTemplate(), {
        template: "templates/product.json",
        parentBlockTypes: ["_product-details"],
        block: QUANTITY_TIERS_BLOCK,
      }),
    /No block with type in \[_product-details\] found in section main/u,
  );
  const ambiguous = horizonDetailsTemplate();
  ambiguous.sections.main.blocks["product-details-2"] = { type: "_product-details", static: true, settings: {}, blocks: {}, block_order: [] } as never;
  assert.throws(
    () =>
      planTemplateOverlay(ambiguous, {
        template: "templates/product.json",
        parentBlockTypes: ["_product-details"],
        block: QUANTITY_TIERS_BLOCK,
      }),
    /Ambiguous parent block in section main/u,
  );
  for (const bad of [[], [""], "._product-details", [1]]) {
    assert.throws(
      () =>
        validateTemplateOverlay({
          template: "templates/product.json",
          parentBlockTypes: bad as never,
          block: QUANTITY_TIERS_BLOCK,
        }),
      /parentBlockTypes must be a non-empty array of strings/u,
    );
  }
  assert.equal(
    validateTemplateOverlay({ template: "templates/product.json", block: QUANTITY_TIERS_BLOCK }).parentBlockTypes,
    null,
  );
});
