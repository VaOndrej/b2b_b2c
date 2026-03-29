export interface VisibilityRuleCandidate {
  productId: string;
  visibilityMode: string;
}

export interface QuantityRuleCandidate {
  productId: string;
  minimumOrderQuantity: number;
  stepQuantity: number | null;
  maxOrderQuantity: number | null;
}

export interface VariantVisibilityRuleCandidate {
  productId: string;
  visibilityMode: string;
}

export interface AutoScenarioProductIdsInput {
  visibilityRules: VisibilityRuleCandidate[];
  quantityRules: QuantityRuleCandidate[];
  variantVisibilityRules: VariantVisibilityRuleCandidate[];
}

export interface AutoScenarioProductIds {
  visibility: string | null;
  step: string | null;
  max: string | null;
  variant: string | null;
}

function normalizeProductId(rawValue: string | null | undefined): string | null {
  const normalized = String(rawValue ?? "").trim();
  return normalized || null;
}

function isRestrictiveVisibilityMode(value: string | null | undefined): boolean {
  const normalized = String(value ?? "").trim();
  return Boolean(normalized) && normalized !== "ALL";
}

function hasStepQuantityConstraint(rule: QuantityRuleCandidate): boolean {
  return Number(rule.stepQuantity ?? 0) > 1;
}

function hasMaximumQuantityConstraint(rule: QuantityRuleCandidate): boolean {
  return Number(rule.maxOrderQuantity ?? 0) > 0;
}

export function selectAutoScenarioProductIds(
  input: AutoScenarioProductIdsInput,
): AutoScenarioProductIds {
  const visibility =
    input.visibilityRules.find((rule) =>
      isRestrictiveVisibilityMode(rule.visibilityMode),
    )?.productId ?? null;

  const step =
    input.quantityRules.find((rule) => hasStepQuantityConstraint(rule))?.productId ?? null;

  const max =
    input.quantityRules.find((rule) => hasMaximumQuantityConstraint(rule))?.productId ?? null;

  const variant =
    input.variantVisibilityRules.find((rule) =>
      isRestrictiveVisibilityMode(rule.visibilityMode),
    )?.productId ?? null;

  return {
    visibility: normalizeProductId(visibility),
    step: normalizeProductId(step),
    max: normalizeProductId(max),
    variant: normalizeProductId(variant),
  };
}
