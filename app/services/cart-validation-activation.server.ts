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

const VALIDATION_TITLE = "Margin Guard Cart Validation";
const VALIDATION_HANDLE = "margin-guard-cart-validation";

function normalizeErrorMessage(userErrors: Array<{ message?: string }>): string {
  return userErrors
    .map((error) => error?.message)
    .filter(Boolean)
    .join(" | ");
}

function normalizeGraphQLErrorMessage(errors: Array<{ message?: string }>): string {
  return errors
    .map((error) => error?.message)
    .filter(Boolean)
    .join(" | ");
}

function isAlreadyExistsMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes("already") && normalized.includes("validation");
}

function buildValidationInput(
  functionConfig: ReturnType<typeof buildCartValidationFunctionConfig>,
  options: { includeFunctionHandle: boolean },
) {
  const baseInput = {
    title: VALIDATION_TITLE,
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
  };

  if (options.includeFunctionHandle) {
    return {
      ...baseInput,
      functionHandle: VALIDATION_HANDLE,
    };
  }

  return baseInput;
}

async function findExistingValidationIdsByTitle(
  admin: AdminGraphqlClient,
): Promise<string[]> {
  const response = await admin.graphql(
    `#graphql
      query FindMarginGuardValidation($first: Int!) {
        validations(first: $first) {
          nodes {
            id
            title
          }
        }
      }`,
    {
      variables: { first: 50 },
    },
  );
  const payload = await response.json();
  const graphQLErrors = payload?.errors ?? [];
  if (graphQLErrors.length > 0) {
    throw new Error(
      normalizeGraphQLErrorMessage(graphQLErrors) ||
        "Unknown validation lookup error",
    );
  }

  const nodes = payload?.data?.validations?.nodes ?? [];
  return nodes
    .filter(
      (node: { id?: string; title?: string }) => node?.title === VALIDATION_TITLE,
    )
    .map((node: { id?: string }) => node.id)
    .filter((id: string | undefined): id is string => Boolean(id));
}

async function createValidation(
  admin: AdminGraphqlClient,
  functionConfig: ReturnType<typeof buildCartValidationFunctionConfig>,
): Promise<ActivationResult> {
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
        validation: buildValidationInput(functionConfig, {
          includeFunctionHandle: true,
        }),
      },
    },
  );

  const payload = await response.json();
  const graphQLErrors = payload?.errors ?? [];
  if (graphQLErrors.length > 0) {
    return {
      ok: false,
      message:
        normalizeGraphQLErrorMessage(graphQLErrors) ||
        "Unknown validation activation GraphQL error",
    };
  }

  const userErrors = payload?.data?.validationCreate?.userErrors ?? [];
  const rawMessage = normalizeErrorMessage(userErrors);
  if (userErrors.length === 0 || isAlreadyExistsMessage(rawMessage)) {
    return {
      ok: true,
      message:
        userErrors.length === 0
          ? "Cart validation function is active."
          : "Cart validation already existed and is treated as active.",
    };
  }

  return {
    ok: false,
    message: rawMessage || "Unknown activation error",
  };
}

async function updateValidation(
  admin: AdminGraphqlClient,
  validationId: string,
  functionConfig: ReturnType<typeof buildCartValidationFunctionConfig>,
): Promise<ActivationResult> {
  const response = await admin.graphql(
    `#graphql
      mutation UpdateValidation($id: ID!, $validation: ValidationUpdateInput!) {
        validationUpdate(id: $id, validation: $validation) {
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
        id: validationId,
        validation: buildValidationInput(functionConfig, {
          includeFunctionHandle: false,
        }),
      },
    },
  );

  const payload = await response.json();
  const graphQLErrors = payload?.errors ?? [];
  if (graphQLErrors.length > 0) {
    return {
      ok: false,
      message:
        normalizeGraphQLErrorMessage(graphQLErrors) ||
        "Unknown validation update GraphQL error",
    };
  }

  const userErrors = payload?.data?.validationUpdate?.userErrors ?? [];
  if (userErrors.length === 0) {
    return {
      ok: true,
      message: "Cart validation function is active and config was updated.",
    };
  }

  return {
    ok: false,
    message: normalizeErrorMessage(userErrors) || "Unknown validation update error",
  };
}

async function updateExistingValidations(
  admin: AdminGraphqlClient,
  validationIds: string[],
  functionConfig: ReturnType<typeof buildCartValidationFunctionConfig>,
): Promise<ActivationResult> {
  const errors: string[] = [];

  for (const validationId of validationIds) {
    const update = await updateValidation(admin, validationId, functionConfig);
    if (!update.ok) {
      errors.push(`ID ${validationId}: ${update.message}`);
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      message:
        `Failed to update ${errors.length}/${validationIds.length} existing validations. ` +
        errors.join(" | "),
    };
  }

  return {
    ok: true,
    message:
      validationIds.length === 1
        ? "Cart validation function is active and config was updated."
        : `Cart validation function is active and ${validationIds.length} existing validations were updated.`,
  };
}

export async function ensureCartValidationActive(
  admin: AdminGraphqlClient,
): Promise<ActivationResult> {
  const db = prisma as any;
  const config = await getOrCreateMarginGuardConfig();
  const functionConfig = buildCartValidationFunctionConfig(config);

  try {
    const existingValidationIds = await findExistingValidationIdsByTitle(admin);
    const result = existingValidationIds.length > 0
      ? await updateExistingValidations(
          admin,
          existingValidationIds,
          functionConfig,
        )
      : await createValidation(admin, functionConfig);

    await db.marginGuardConfig.update({
      where: { id: "default" },
      data: {
        cartValidationStatus: result.ok ? "ACTIVE" : "ERROR",
        cartValidationLastError: result.ok ? null : result.message,
        cartValidationLastSyncAt: new Date(),
      },
    });

    return result;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown activation error";
    await db.marginGuardConfig.update({
      where: { id: "default" },
      data: {
        cartValidationStatus: "ERROR",
        cartValidationLastError: message,
        cartValidationLastSyncAt: new Date(),
      },
    });

    return {
      ok: false,
      message,
    };
  }
}
