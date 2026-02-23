import test from "node:test";
import assert from "node:assert/strict";
import { resolveSegment } from "../../core/segment/segment.engine.ts";

test("segment detection uses company-role -> tag -> fallback precedence", () => {
  const byCompany = resolveSegment({
    customerTags: [],
    b2bTag: "wholesale",
    hasPurchasingCompany: true,
  });
  assert.equal(byCompany.segment, "B2B");
  assert.equal(byCompany.source, "company_role");

  const byTag = resolveSegment({
    customerTags: ["Wholesale", "vip"],
    b2bTag: "wholesale",
  });
  assert.equal(byTag.segment, "B2B");
  assert.equal(byTag.source, "customer_tag");

  const byFallback = resolveSegment({
    customerTags: ["retail"],
    b2bTag: "wholesale",
  });
  assert.equal(byFallback.segment, "B2C");
  assert.equal(byFallback.source, "fallback");
});
