import assert from "node:assert/strict";
import { test } from "node:test";

import {
  anonymizeOrder,
  coldStartReady,
  formatSaleMessage,
  redactSales,
} from "../../src/toasts/social-proof.ts";

const ORDER = {
  created_at: "2026-08-04T10:00:00.000Z",
  customer: { id: 12345, first_name: "Anna", last_name: "Nováková", email: "anna@example.com" },
  shipping_address: { first_name: "Anna", city: "Praha", address1: "Nádražní 5", zip: "11000" },
  line_items: [{ title: "Blue Mug", quantity: 1 }, { title: "Spoon" }],
};

test("anonymizeOrder keeps ONLY first name + city + product (+ ids/time)", () => {
  const s = anonymizeOrder(ORDER, 1_700_000_000_000);
  assert.ok(s);
  assert.equal(s.firstName, "Anna");
  assert.equal(s.city, "Praha");
  assert.equal(s.productTitle, "Blue Mug");
  assert.equal(s.customerId, "12345");
  assert.equal(s.at, Date.parse("2026-08-04T10:00:00.000Z"));
  // No PII leaks: the object must not carry last name, email, address, zip.
  const serialized = JSON.stringify(s);
  assert.ok(!serialized.includes("Nováková"));
  assert.ok(!serialized.includes("example.com"));
  assert.ok(!serialized.includes("Nádražní"));
  assert.ok(!serialized.includes("11000"));
});

test("anonymizeOrder falls back to the provided time and tolerates gaps", () => {
  const s = anonymizeOrder({ line_items: [] }, 42);
  assert.ok(s);
  assert.equal(s.firstName, null);
  assert.equal(s.city, null);
  assert.equal(s.productTitle, null);
  assert.equal(s.customerId, null);
  assert.equal(s.at, 42);
});

test("anonymizeOrder honours a per-order opt-out note attribute", () => {
  const opted = {
    ...ORDER,
    note_attributes: [{ name: "won_social_optout", value: "true" }],
  };
  assert.equal(anonymizeOrder(opted, 1), null);
});

test("coldStartReady: only when real orders reach the threshold", () => {
  assert.equal(coldStartReady(4, 5), false);
  assert.equal(coldStartReady(5, 5), true);
  assert.equal(coldStartReady(9, 5), true);
  assert.equal(coldStartReady(3, 0), true); // 0/neg threshold → always (min 1)
});

test("redactSales removes only the given customer's events", () => {
  const sales = [
    { customerId: "1", firstName: "A" },
    { customerId: "2", firstName: "B" },
    { customerId: "1", firstName: "C" },
    { customerId: null, firstName: "D" },
  ];
  const kept = redactSales(sales, "1");
  assert.deepEqual(
    kept.map((s) => s.firstName),
    ["B", "D"],
  );
});

test("formatSaleMessage substitutes name/city/product; hides missing fields", () => {
  assert.equal(
    formatSaleMessage("{name} from {city} bought {product}", {
      firstName: "Anna",
      city: "Praha",
      productTitle: "Mug",
    }),
    "Anna from Praha bought Mug",
  );
  // Missing name/city collapse gracefully (no "undefined", no dangling words).
  const msg = formatSaleMessage("{name} from {city} bought {product}", {
    firstName: null,
    city: null,
    productTitle: "Mug",
  });
  assert.ok(!msg.includes("undefined"));
  assert.ok(msg.includes("Mug"));
});
