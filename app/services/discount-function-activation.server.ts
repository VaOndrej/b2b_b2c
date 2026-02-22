import {
  buildDiscountFunctionConfig,
  getOrCreateMarginGuardConfig,
} from "./margin-guard-config.server";

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

export interface DiscountActivationResult {
  ok: boolean;
  status: "ACTIVE" | "ERROR";
  message: string;
}

export interface DiscountFunctionStatusResult {
  status: "ACTIVE" | "INACTIVE" | "ERROR";
  message: string;
}

function normalizeUserErrors(userErrors: Array<{ message?: string }>): string {
  return userErrors
    .map((error) => error?.message)
    .filter(Boolean)
    .join(" | ");
}

async function findExistingDiscountByTitle(
  admin: AdminGraphqlClient,
  title: string,
): Promise<boolean> {
  const ids = await findExistingDiscountIdsByTitle(admin, title);
  return ids.length > 0;
}

async function findExistingDiscountIdsByTitle(
  admin: AdminGraphqlClient,
  title: string,
): Promise<string[]> {
  const response = await admin.graphql(
    `#graphql
      query FindMarginGuardDiscount($query: String!) {
        discountNodes(first: 20, query: $query) {
          nodes {
            id
          }
        }
      }`,
    {
      variables: {
        query: `title:'${title}'`,
      },
    },
  );
  const payload = await response.json();
  const nodes = payload?.data?.discountNodes?.nodes ?? [];
  return nodes.map((node: { id?: string }) => node.id).filter(Boolean);
}

export async function ensureDiscountFunctionActive(
  admin: AdminGraphqlClient,
): Promise<DiscountActivationResult> {
  try {
    const config = await getOrCreateMarginGuardConfig();
    const functionConfig = buildDiscountFunctionConfig(config);
    const title = "Margin Guard Discount Function";

    const alreadyExists = await findExistingDiscountByTitle(admin, title);
    if (alreadyExists) {
      return {
        ok: true,
        status: "ACTIVE",
        message: "Discount function already exists and is active.",
      };
    }

    const response = await admin.graphql(
      `#graphql
        mutation CreateAutomaticAppDiscount(
          $automaticAppDiscount: DiscountAutomaticAppInput!
        ) {
          discountAutomaticAppCreate(
            automaticAppDiscount: $automaticAppDiscount
          ) {
            automaticAppDiscount {
              discountId
              title
              status
            }
            userErrors {
              field
              message
            }
          }
        }`,
      {
        variables: {
          automaticAppDiscount: {
            title,
            functionHandle: "margin-guard-discount-function",
            startsAt: new Date().toISOString(),
            combinesWith: {
              orderDiscounts: true,
              productDiscounts: true,
              shippingDiscounts: true,
            },
            metafields: [
              {
                namespace: "$app:margin_guard",
                key: "config",
                type: "json",
                value: JSON.stringify(functionConfig),
              },
            ],
          },
        },
      },
    );

    const payload = await response.json();
    const userErrors = payload?.data?.discountAutomaticAppCreate?.userErrors ?? [];
    if (userErrors.length === 0) {
      return {
        ok: true,
        status: "ACTIVE",
        message: "Discount function is active.",
      };
    }

    return {
      ok: false,
      status: "ERROR",
      message:
        normalizeUserErrors(userErrors) || "Unknown discount activation error",
    };
  } catch (error) {
    return {
      ok: false,
      status: "ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Unexpected discount activation error",
    };
  }
}

export async function getDiscountFunctionStatus(
  admin: AdminGraphqlClient,
): Promise<DiscountFunctionStatusResult> {
  try {
    const exists = await findExistingDiscountByTitle(
      admin,
      "Margin Guard Discount Function",
    );
    if (exists) {
      return {
        status: "ACTIVE",
        message: "Discount function exists and is active.",
      };
    }

    return {
      status: "INACTIVE",
      message: "Discount function is not active for MVP_1.",
    };
  } catch (error) {
    return {
      status: "ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Unexpected discount status check error",
    };
  }
}

export async function deactivateDiscountFunction(
  admin: AdminGraphqlClient,
): Promise<DiscountActivationResult> {
  try {
    const ids = await findExistingDiscountIdsByTitle(
      admin,
      "Margin Guard Discount Function",
    );
    if (ids.length === 0) {
      return {
        ok: true,
        status: "ACTIVE",
        message: "No Margin Guard discount function to deactivate.",
      };
    }

    for (const id of ids) {
      const response = await admin.graphql(
        `#graphql
          mutation DeactivateDiscount($id: ID!, $endsAt: DateTime!) {
            discountAutomaticDeactivate(id: $id, endsAt: $endsAt) {
              automaticAppDiscount {
                discountId
                status
              }
              userErrors {
                field
                message
              }
            }
          }`,
        {
          variables: {
            id,
            endsAt: new Date().toISOString(),
          },
        },
      );
      const payload = await response.json();
      const userErrors =
        payload?.data?.discountAutomaticDeactivate?.userErrors ?? [];
      if (userErrors.length > 0) {
        return {
          ok: false,
          status: "ERROR",
          message:
            normalizeUserErrors(userErrors) ||
            "Unknown discount deactivation error",
        };
      }
    }

    return {
      ok: true,
      status: "ACTIVE",
      message: "Margin Guard discount function was deactivated.",
    };
  } catch (error) {
    return {
      ok: false,
      status: "ERROR",
      message:
        error instanceof Error
          ? error.message
          : "Unexpected discount deactivation error",
    };
  }
}
