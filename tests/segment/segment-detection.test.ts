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

// --- TRIGGER (tag b2b → segment) edge cases ---------------------------------
// The dev store cannot automate a real B2B browser login, so the trigger that
// turns a logged-in customer's `b2b` tag into the B2B segment is covered here
// (pure engine) and at the loader integration tier (mocked Admin tag lookup).

test("trigger: default `b2b` tag present → B2B; absent → B2C", () => {
  const tagged = resolveSegment({ customerTags: ["b2b"] });
  assert.equal(tagged.segment, "B2B");
  assert.equal(tagged.source, "customer_tag");
  assert.equal(tagged.matchedTag, "b2b");

  assert.equal(resolveSegment({ customerTags: ["retail", "vip"] }).segment, "B2C");
  assert.equal(resolveSegment({ customerTags: [] }).segment, "B2C");
  assert.equal(resolveSegment({}).segment, "B2C");
});

test("trigger: custom b2bTag matches case/whitespace-insensitively and excludes the default tag", () => {
  // Custom tag matches regardless of case + surrounding whitespace.
  assert.equal(
    resolveSegment({ customerTags: ["  WholeSale "], b2bTag: "wholesale" }).segment,
    "B2B",
  );
  // When a custom tag is configured, the default `b2b` tag must NOT promote.
  assert.equal(
    resolveSegment({ customerTags: ["b2b"], b2bTag: "wholesale" }).segment,
    "B2C",
  );
});

test("trigger: a purchasing-company role wins over tags (and over the fallback)", () => {
  const company = resolveSegment({
    customerTags: ["retail"],
    b2bTag: "wholesale",
    hasPurchasingCompany: true,
  });
  assert.equal(company.segment, "B2B");
  assert.equal(company.source, "company_role");
});
