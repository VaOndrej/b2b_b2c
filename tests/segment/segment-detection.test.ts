import test from "node:test";
import assert from "node:assert/strict";
import { resolveSegment } from "../../core/segment/segment.engine.ts";

test("segment detection for known shop customers", () => {
  const customers = [
    { customerName: "Karine Ruby", customerTags: ["b2b"], expected: "B2B" },
    { customerName: "Ayumu Hirano", customerTags: ["retail"], expected: "B2C" },
    { customerName: "Russel Winfield", customerTags: [], expected: "B2C" },
  ] as const;

  for (const customer of customers) {
    const result = resolveSegment({ customerTags: [...customer.customerTags] });

    assert.equal(
      result.segment,
      customer.expected,
      `[SEGMENT TEST FAIL] ${customer.customerName}: expected ${customer.expected}, got ${result.segment}. Zkontroluj v admin.shopify -> Zákazníci.`,
    );
  }

  console.log("[SEGMENT TEST PASS] Segment detection pro Karine Ruby, Ayumu Hirano a Russel Winfield prošel.");
});
