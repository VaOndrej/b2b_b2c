import test from "node:test";
import assert from "node:assert/strict";
import {
  hasExpectedB2BTags,
  isAlreadyExistsMessage,
} from "../../app/services/cart-validation-activation.server.ts";

test("isAlreadyExistsMessage matches validation already-exists errors", () => {
  assert.equal(
    isAlreadyExistsMessage("Validation already exists for this function."),
    true,
  );
  assert.equal(
    isAlreadyExistsMessage("VALIDATION with this title already created."),
    true,
  );
});

test("isAlreadyExistsMessage does not match unrelated messages", () => {
  assert.equal(
    isAlreadyExistsMessage("Resource already exists but this is not validation."),
    false,
  );
  assert.equal(isAlreadyExistsMessage("Validation failed due to timeout."), false);
});

test("hasExpectedB2BTags enforces expected custom B2B tag", () => {
  const functionConfig = {
    b2bTags: ["wholesale"],
  } as any;

  assert.equal(hasExpectedB2BTags(functionConfig, "wholesale"), true);
  assert.equal(hasExpectedB2BTags(functionConfig, "b2b"), false);
});

test("hasExpectedB2BTags normalizes case and trims values", () => {
  const functionConfig = {
    b2bTags: [" WHOLESALE "],
  } as any;
  assert.equal(hasExpectedB2BTags(functionConfig, "wholesale"), true);
});
