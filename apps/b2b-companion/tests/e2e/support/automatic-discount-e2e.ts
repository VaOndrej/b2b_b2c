import { getOfflineAdminClientForE2E } from "./seed.ts";

/**
 * Real Shopify automatic-discount provisioning for the cart discount-conflict
 * spec. The cart banner is driven by `resolveCartDiscountConflictsByHandle`, which
 * flags *real Shopify automatic discounts* (fetched live via the admin API) that
 * breach the resolved catalog's margin floor — NOT catalog discount rules (those
 * are only stacking context). So a faithful E2E must create an actual automatic
 * discount, scoped to the single e2e product, and delete it on teardown.
 *
 * Blast radius is deliberately tiny: one PRODUCT-scoped percentage discount on the
 * dedicated `mg-e2e-*` product, alive only for the duration of one test, removed
 * in `afterEach`. Titles are prefixed `mg-e2e-` so any strays are identifiable.
 */

const AUTOMATIC_BASIC_CREATE = `#graphql
  mutation MgE2ECreateAutoBasic($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
    discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
      automaticDiscountNode { id }
      userErrors { field message }
    }
  }`;

const AUTOMATIC_DELETE = `#graphql
  mutation MgE2EDeleteAuto($id: ID!) {
    discountAutomaticDelete(id: $id) {
      deletedAutomaticDiscountId
      userErrors { field message }
    }
  }`;

export interface E2EAutomaticDiscount {
  /** DiscountAutomaticNode gid — pass to deleteAutomaticDiscount for teardown. */
  id: string;
  title: string;
}

/**
 * Creates a real ACTIVE PRODUCT-scoped percentage automatic discount on the given
 * product. `percentOff` is a 0..100 percent (converted to Shopify's 0..1 decimal).
 * Returns null when there is no offline admin session (caller should skip).
 */
export async function createProductScopedPercentAutomaticDiscount(input: {
  productId: string;
  percentOff: number;
  /** ISO timestamp; the spec passes one (Date is available in the Playwright runtime). */
  startsAt: string;
  titleSuffix: string;
}): Promise<E2EAutomaticDiscount | null> {
  const admin = await getOfflineAdminClientForE2E();
  if (!admin) {
    return null;
  }
  const title = `mg-e2e-conflict-${input.titleSuffix}`;
  const response = await admin.graphql(AUTOMATIC_BASIC_CREATE, {
    variables: {
      automaticBasicDiscount: {
        title,
        startsAt: input.startsAt,
        customerGets: {
          value: { percentage: Math.min(1, Math.max(0, input.percentOff / 100)) },
          items: { products: { productsToAdd: [input.productId] } },
        },
        minimumRequirement: {
          quantity: { greaterThanOrEqualToQuantity: "1" },
        },
      },
    },
  });
  const payload = (await response.json()) as {
    data?: {
      discountAutomaticBasicCreate?: {
        automaticDiscountNode?: { id?: string } | null;
        userErrors?: { field?: string[]; message?: string }[];
      };
    };
  };
  const result = payload?.data?.discountAutomaticBasicCreate;
  const errors = result?.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(
      `discountAutomaticBasicCreate failed: ${errors
        .map((e) => `${(e.field ?? []).join(".")}: ${e.message}`)
        .join("; ")}`,
    );
  }
  const id = result?.automaticDiscountNode?.id;
  if (!id) {
    throw new Error("discountAutomaticBasicCreate returned no automaticDiscountNode id.");
  }
  return { id, title };
}

/**
 * Deletes a previously created automatic discount. Best-effort: never throws, so a
 * failed teardown cannot fail an otherwise-passing test (strays are identifiable by
 * the `mg-e2e-conflict-` title prefix).
 */
export async function deleteAutomaticDiscount(id: string): Promise<void> {
  try {
    const admin = await getOfflineAdminClientForE2E();
    if (!admin) {
      return;
    }
    await admin.graphql(AUTOMATIC_DELETE, { variables: { id } });
  } catch {
    // swallow — teardown must not fail the suite
  }
}
