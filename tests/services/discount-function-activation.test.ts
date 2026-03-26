import test from "node:test";
import assert from "node:assert/strict";
import {
  getDiscountFunctionStatus,
  reconcileDiscountFunctionStatus,
} from "../../app/services/discount-function-activation.server.ts";
import { discountFunctionPolicy } from "../../config/feature-flags.ts";

const inactiveAdmin = {
  graphql: async () => ({
    json: async () => ({
      data: {
        discountNodes: {
          nodes: [],
        },
      },
    }),
  }),
};

test("discount function policy is enabled for MVP_4 rollout", () => {
  assert.equal(
    discountFunctionPolicy.allowDiscountFunction,
    true,
    "[DISCOUNT POLICY FAIL] MVP_4 rollout must keep the discount function enabled.",
  );
});

test("getDiscountFunctionStatus reports a generic inactive message", async () => {
  const status = await getDiscountFunctionStatus(inactiveAdmin);

  assert.deepEqual(status, {
    status: "INACTIVE",
    message: "Discount function is not active yet.",
  });
});

test("reconcileDiscountFunctionStatus activates the discount function when rollout allows it", async () => {
  const status = await reconcileDiscountFunctionStatus(inactiveAdmin, {
    ensureDiscountFunctionActive: async () => ({
      ok: true,
      status: "ACTIVE",
      message: "Discount function is active.",
      lastSyncAt: new Date("2026-03-26T15:30:31.000Z"),
    }),
    getDiscountFunctionStatusWithAutoDisable: async () => ({
      status: "INACTIVE",
      message: "Rollout-disabled path should not run here.",
    }),
  });

  assert.equal(status.status, "ACTIVE");
  assert.equal(status.message, "Discount function is active.");
  assert.equal(status.lastSyncAt?.toISOString(), "2026-03-26T15:30:31.000Z");
});
