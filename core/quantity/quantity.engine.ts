import type { QuantityRule } from "./quantity.rules";

export interface QuantityValidationInput {
  quantity: number;
  productId?: string;
  collectionIds?: string[];
  segment?: "B2B" | "B2C";
  rules: QuantityRule[];
}

interface ResolvedQuantityConstraints {
  minimumOrderQuantity: number;
  stepQuantity: number;
}

function normalizeQuantity(value: number | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.max(1, Math.floor(parsed));
}

function matchesSegment(
  expectedSegment: QuantityRule["segment"],
  actualSegment: QuantityValidationInput["segment"],
): boolean {
  if (!expectedSegment) {
    return true;
  }
  return expectedSegment === actualSegment;
}

function matchesTarget(rule: QuantityRule, input: QuantityValidationInput): boolean {
  if (rule.productId) {
    return rule.productId === input.productId;
  }
  if (rule.collectionId) {
    return (input.collectionIds ?? []).includes(rule.collectionId);
  }
  return true;
}

function targetPriority(rule: QuantityRule): number {
  if (rule.productId) {
    return 2;
  }
  if (rule.collectionId) {
    return 1;
  }
  return 0;
}

function segmentPriority(rule: QuantityRule): number {
  return rule.segment ? 1 : 0;
}

function resolveConstraintValue(
  input: QuantityValidationInput,
  selector: (rule: QuantityRule) => number | undefined,
  fallback: number,
): number {
  let selectedValue = fallback;
  let selectedTargetPriority = -1;
  let selectedSegmentPriority = -1;

  for (const rule of input.rules) {
    const value = selector(rule);
    if (value == null || !Number.isFinite(value) || value < 1) {
      continue;
    }
    if (!matchesSegment(rule.segment, input.segment) || !matchesTarget(rule, input)) {
      continue;
    }

    const normalizedValue = Math.floor(value);
    const currentTargetPriority = targetPriority(rule);
    const currentSegmentPriority = segmentPriority(rule);
    const isHigherPriority =
      currentTargetPriority > selectedTargetPriority ||
      (currentTargetPriority === selectedTargetPriority &&
        currentSegmentPriority > selectedSegmentPriority);

    if (isHigherPriority) {
      selectedValue = normalizedValue;
      selectedTargetPriority = currentTargetPriority;
      selectedSegmentPriority = currentSegmentPriority;
      continue;
    }

    if (
      currentTargetPriority === selectedTargetPriority &&
      currentSegmentPriority === selectedSegmentPriority
    ) {
      selectedValue = Math.max(selectedValue, normalizedValue);
    }
  }

  return selectedValue;
}

export function resolveQuantityConstraints(
  input: QuantityValidationInput,
): ResolvedQuantityConstraints {
  return {
    minimumOrderQuantity: resolveConstraintValue(
      input,
      (rule) => rule.minimumOrderQuantity,
      1,
    ),
    stepQuantity: resolveConstraintValue(input, (rule) => rule.stepQuantity, 1),
  };
}

export function validateQuantity(input: QuantityValidationInput): boolean {
  const quantity = normalizeQuantity(input.quantity);
  const constraints = resolveQuantityConstraints(input);
  if (quantity < constraints.minimumOrderQuantity) {
    return false;
  }

  if (constraints.stepQuantity > 1 && quantity % constraints.stepQuantity !== 0) {
    return false;
  }

  return true;
}
