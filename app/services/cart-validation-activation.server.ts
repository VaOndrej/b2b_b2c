import prisma from "../db.server";
import {
  buildCartValidationFunctionConfig,
  getOrCreateMarginGuardConfig,
} from "./margin-guard-config.server";

interface AdminGraphqlClient {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{ json(): Promise<any> }>;
}

export interface ActivationResult {
  ok: boolean;
  message: string;
}

function normalizeErrorMessage(userErrors: Array<{ message?: string }>): string {
  return userErrors
    .map((error) => error?.message)
    .filter(Boolean)
    .join(" | ");
}

export async function ensureCartValidationActive(
  admin: AdminGraphqlClient,
): Promise<ActivationResult> {
  const db = prisma as any;
  const config = await getOrCreateMarginGuardConfig();
  const functionConfig = buildCartValidationFunctionConfig(config);

  const response = await admin.graphql(
    `#graphql
      mutation ActivateValidation($validation: ValidationCreateInput!) {
        validationCreate(validation: $validation) {
          validation {
            id
            title
          }
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        validation: {
          functionHandle: "margin-guard-cart-validation",
          title: "Margin Guard Cart Validation",
          enable: true,
          blockOnFailure: true,
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
  const userErrors = payload?.data?.validationCreate?.userErrors ?? [];
  const rawMessage = normalizeErrorMessage(userErrors);
  const maybeAlreadyExists =
    rawMessage.toLowerCase().includes("already") &&
    rawMessage.toLowerCase().includes("validation");

  if (userErrors.length === 0 || maybeAlreadyExists) {
    await db.marginGuardConfig.update({
      where: { id: "default" },
      data: {
        cartValidationStatus: "ACTIVE",
        cartValidationLastError: null,
        cartValidationLastSyncAt: new Date(),
      },
    });
    return {
      ok: true,
      message:
        userErrors.length === 0
          ? "Cart validation function is active."
          : "Cart validation already existed and is treated as active.",
    };
  }

  await db.marginGuardConfig.update({
    where: { id: "default" },
    data: {
      cartValidationStatus: "ERROR",
      cartValidationLastError: rawMessage || "Unknown activation error",
      cartValidationLastSyncAt: new Date(),
    },
  });

  return {
    ok: false,
    message: rawMessage || "Unknown activation error",
  };
}
