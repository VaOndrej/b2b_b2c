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

interface ValidationNode {
  id: string;
  title: string;
  enabled: boolean;
  blockOnFailure: boolean;
  shopifyFunctionId: string | null;
  shopifyFunctionTitle: string | null;
}

interface CreateValidationResult extends ActivationResult {
  alreadyExists: boolean;
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

function parseValidationNumericId(id: string): number {
  const match = String(id || "").match(/\/(\d+)$/);
  if (!match) {
    return Number.MAX_SAFE_INTEGER;
  }
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return parsed;
}

function compareValidationNodeByIdAsc(a: ValidationNode, b: ValidationNode): number {
  const idDelta = parseValidationNumericId(a.id) - parseValidationNumericId(b.id);
  if (idDelta !== 0) {
    return idDelta;
  }
  return String(a.id).localeCompare(String(b.id));
}

function normalizeValidationNodes(rawNodes: unknown): ValidationNode[] {
  const nodes = Array.isArray(rawNodes) ? rawNodes : [];
  const normalized: ValidationNode[] = [];
  for (const node of nodes) {
    const id = String((node as any)?.id ?? "").trim();
    if (!id) {
      continue;
    }
    normalized.push({
      id,
      title: String((node as any)?.title ?? "").trim(),
      enabled: Boolean((node as any)?.enabled),
      blockOnFailure: Boolean((node as any)?.blockOnFailure),
      shopifyFunctionId: String((node as any)?.shopifyFunction?.id ?? "").trim() || null,
      shopifyFunctionTitle:
        String((node as any)?.shopifyFunction?.title ?? "").trim() || null,
    });
  }
  return normalized;
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

async function listMatchingValidations(
  admin: AdminGraphqlClient,
): Promise<ValidationNode[]> {
  const response = await admin.graphql(
    `#graphql
      query FindMarginGuardValidation($first: Int!) {
        validations(first: $first) {
          nodes {
            id
            title
            enabled
            blockOnFailure
            shopifyFunction {
              id
              title
            }
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

  const nodes = normalizeValidationNodes(payload?.data?.validations?.nodes);
  return nodes
    .filter((node) => {
      if (node.shopifyFunctionTitle === VALIDATION_HANDLE) {
        return true;
      }
      return node.title === VALIDATION_TITLE;
    })
    .sort(compareValidationNodeByIdAsc);
}

async function createValidation(
  admin: AdminGraphqlClient,
  functionConfig: ReturnType<typeof buildCartValidationFunctionConfig>,
): Promise<CreateValidationResult> {
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
      alreadyExists: false,
      message:
        normalizeGraphQLErrorMessage(graphQLErrors) ||
        "Unknown validation activation GraphQL error",
    };
  }

  const userErrors = payload?.data?.validationCreate?.userErrors ?? [];
  const rawMessage = normalizeErrorMessage(userErrors);
  if (userErrors.length === 0) {
    return {
      ok: true,
      alreadyExists: false,
      message: "Cart validation function is active.",
    };
  }

  if (isAlreadyExistsMessage(rawMessage)) {
    return {
      ok: true,
      alreadyExists: true,
      message: "Cart validation already existed and will be reconciled.",
    };
  }

  return {
    ok: false,
    alreadyExists: false,
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

async function deleteValidation(
  admin: AdminGraphqlClient,
  validationId: string,
): Promise<ActivationResult> {
  const response = await admin.graphql(
    `#graphql
      mutation DeleteValidation($id: ID!) {
        validationDelete(id: $id) {
          deletedId
          userErrors {
            field
            message
          }
        }
      }`,
    {
      variables: {
        id: validationId,
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
        "Unknown validation delete GraphQL error",
    };
  }

  const userErrors = payload?.data?.validationDelete?.userErrors ?? [];
  if (userErrors.length === 0) {
    return {
      ok: true,
      message: "Duplicate cart validation was removed.",
    };
  }

  return {
    ok: false,
    message: normalizeErrorMessage(userErrors) || "Unknown validation delete error",
  };
}

function splitPrimaryAndDuplicates(
  validations: ValidationNode[],
): { primary: ValidationNode | null; duplicates: ValidationNode[] } {
  if (!validations.length) {
    return {
      primary: null,
      duplicates: [],
    };
  }
  const [primary, ...duplicates] = validations
    .slice()
    .sort(compareValidationNodeByIdAsc);
  return {
    primary,
    duplicates,
  };
}

async function updateExistingValidations(
  admin: AdminGraphqlClient,
  validations: ValidationNode[],
  functionConfig: ReturnType<typeof buildCartValidationFunctionConfig>,
): Promise<ActivationResult> {
  const { primary, duplicates } = splitPrimaryAndDuplicates(validations);
  if (!primary) {
    return {
      ok: false,
      message: "No existing cart validation found for reconciliation.",
    };
  }

  const primaryUpdate = await updateValidation(admin, primary.id, functionConfig);
  if (!primaryUpdate.ok) {
    return primaryUpdate;
  }

  const errors: string[] = [];
  for (const duplicate of duplicates) {
    const deletion = await deleteValidation(admin, duplicate.id);
    if (!deletion.ok) {
      errors.push(`ID ${duplicate.id}: ${deletion.message}`);
    }
  }

  if (errors.length > 0) {
    return {
      ok: false,
      message:
        `Primary validation updated, but failed to delete ${errors.length}/${duplicates.length} duplicates. ` +
        errors.join(" | "),
    };
  }

  return {
    ok: true,
    message:
      duplicates.length === 0
        ? "Cart validation function is active and config was updated."
        : `Cart validation function is active; updated primary validation and removed ${duplicates.length} duplicates.`,
  };
}

export async function ensureCartValidationActive(
  admin: AdminGraphqlClient,
): Promise<ActivationResult> {
  const db = prisma as any;
  const config = await getOrCreateMarginGuardConfig();
  const functionConfig = buildCartValidationFunctionConfig(config);

  try {
    const existingValidations = await listMatchingValidations(admin);
    let result: ActivationResult;
    if (existingValidations.length > 0) {
      result = await updateExistingValidations(
        admin,
        existingValidations,
        functionConfig,
      );
    } else {
      const creation = await createValidation(admin, functionConfig);
      if (!creation.ok) {
        result = creation;
      } else if (!creation.alreadyExists) {
        result = creation;
      } else {
        const reconciledValidations = await listMatchingValidations(admin);
        result =
          reconciledValidations.length > 0
            ? await updateExistingValidations(
                admin,
                reconciledValidations,
                functionConfig,
              )
            : {
                ok: false,
                message:
                  "Cart validation reported as existing, but no matching validation could be listed.",
              };
      }
    }

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
