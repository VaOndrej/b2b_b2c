import type { Segment } from "../segment/segment.types";
import type {
  StorefrontContentRule,
  CollectionVisibilityRule,
  StorefrontContentInput,
  StorefrontContentOutput,
  ResolvedContentRule,
  PageType,
} from "./storefront-content.types";

const COLLECTION_REDIRECT_MESSAGES: Record<string, string> = {
  en: "This collection is not available for your customer segment.",
  cs: "Tato kolekce neni dostupna pro vas zakaznicky segment.",
};

function matchesSegment(
  ruleSegment: string,
  currentSegment: Segment,
): boolean {
  return ruleSegment === currentSegment;
}

function matchesPage(
  rulePageType: PageType,
  currentPageType: PageType,
): boolean {
  if (rulePageType === "ALL") {
    return true;
  }
  return rulePageType === currentPageType;
}

function resolveLocalizedValue(
  rule: StorefrontContentRule,
  locale: string,
): string | null {
  if (locale.startsWith("cs") && rule.valueCsLocale) {
    return rule.valueCsLocale;
  }
  return rule.value ?? null;
}

export function resolveContentRules(
  input: StorefrontContentInput,
): ResolvedContentRule[] {
  const { segment, pageType, rules, locale = "en" } = input;

  const matched = rules
    .filter((rule) => {
      if (!rule.active) {
        return false;
      }
      if (!matchesSegment(rule.segment, segment)) {
        return false;
      }
      if (!matchesPage(rule.pageType, pageType)) {
        return false;
      }
      if (
        rule.pageType === "PRODUCT" &&
        rule.productId &&
        input.productId &&
        rule.productId !== input.productId
      ) {
        return false;
      }
      if (
        rule.pageType === "COLLECTION" &&
        rule.collectionId &&
        input.collectionHandle
      ) {
        // Collection matching is done by the caller via collectionId lookup
      }
      return true;
    })
    .sort((a, b) => a.priority - b.priority);

  return matched.map((rule) => ({
    targetType: rule.targetType,
    targetSelector: rule.targetSelector,
    targetPosition: rule.targetPosition,
    action: rule.action,
    value: resolveLocalizedValue(rule, locale),
    pageType: rule.pageType,
    priority: rule.priority,
  }));
}

export function resolveHiddenCollections(
  segment: Segment,
  collectionVisibilityRules: CollectionVisibilityRule[],
): string[] {
  return collectionVisibilityRules
    .filter((rule) => {
      if (rule.visibilityMode === "B2B_ONLY" && segment !== "B2B") {
        return true;
      }
      if (rule.visibilityMode === "B2C_ONLY" && segment !== "B2C") {
        return true;
      }
      return false;
    })
    .map((rule) => rule.collectionHandle);
}

export function resolveCollectionRedirectMessage(locale: string): string {
  if (locale.startsWith("cs")) {
    return COLLECTION_REDIRECT_MESSAGES.cs;
  }
  return COLLECTION_REDIRECT_MESSAGES.en;
}

export function resolveStorefrontContent(
  input: StorefrontContentInput,
): StorefrontContentOutput {
  const locale = input.locale ?? "en";

  return {
    segment: input.segment,
    contentRules: resolveContentRules(input),
    hiddenCollections: resolveHiddenCollections(
      input.segment,
      input.collectionVisibilityRules,
    ),
    collectionRedirectMessage: resolveCollectionRedirectMessage(locale),
  };
}
