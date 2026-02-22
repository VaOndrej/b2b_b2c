import type {
  DiscountInput,
  DiscountResult,
  DiscountRules,
} from "./discount.rules";

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function resolveDiscounts(
  discounts: DiscountInput[],
  rules: DiscountRules,
): DiscountResult {
  if (discounts.length === 0) {
    return { totalPercentOff: 0, appliedCodes: [] };
  }

  const normalized = discounts.map((discount) => ({
    code: discount.code,
    percentOff: clampPercent(discount.percentOff ?? 0),
  }));

  let selected = normalized;
  if (!rules.allowStacking) {
    selected = [
      normalized.reduce((best, current) =>
        current.percentOff > best.percentOff ? current : best,
      ),
    ];
  }

  const rawTotal = selected.reduce((sum, item) => sum + item.percentOff, 0);
  const capped =
    rules.maxCombinedPercentOff != null
      ? Math.min(rawTotal, clampPercent(rules.maxCombinedPercentOff))
      : rawTotal;

  return {
    totalPercentOff: clampPercent(capped),
    appliedCodes: selected
      .map((item) => item.code)
      .filter((code): code is string => Boolean(code)),
  };
}
