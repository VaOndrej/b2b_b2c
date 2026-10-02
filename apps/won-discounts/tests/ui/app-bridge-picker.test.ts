import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { pickProducts } from "../../app/components/model/app-bridge.ts";

// MVP 5 audit A2: Výprodej runs on ONE variant, so its picker takes one product (`multiple: false`); every
// other picker keeps picking several. The App Bridge global is stubbed (inside the admin iframe: top ≠ window).

const g = globalThis as unknown as { window?: unknown };
afterEach(() => {
  delete g.window;
});

function stubPicker(): { calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  g.window = {
    top: {},
    shopify: {
      resourcePicker: async (options: Record<string, unknown>) => {
        calls.push(options);
        return [{ id: "gid://shopify/Product/1", title: "P", variants: [{ id: "gid://shopify/ProductVariant/11", title: "Large" }] }];
      },
    },
  };
  return { calls };
}

test("pickProducts: several products by default, one with { multiple: false } (Výprodej)", async () => {
  const stub = stubPicker();
  await pickProducts([]);
  const single = await pickProducts([], { multiple: false });
  assert.equal(stub.calls[0]!.multiple, true);
  assert.equal(stub.calls[1]!.multiple, false);
  assert.ok(single.ok);
  assert.equal(single.ok && single.items[0]!.variants[0]!.id, "gid://shopify/ProductVariant/11");
});
