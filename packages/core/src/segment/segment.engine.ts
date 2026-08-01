import type { SegmentInput, SegmentResolution } from "./segment.types";

const DEFAULT_B2B_TAG = "b2b";

function normalizeTag(value: string): string {
  return value.trim().toLowerCase();
}

export function resolveSegment(input: SegmentInput): SegmentResolution {
  if (input.hasPurchasingCompany) {
    return { segment: "B2B", source: "company_role" };
  }

  const expectedTag = normalizeTag(input.b2bTag ?? DEFAULT_B2B_TAG);
  const tags = (input.customerTags ?? []).map(normalizeTag);
  const matchedTag = tags.find((tag) => tag === expectedTag);

  if (matchedTag) {
    return { segment: "B2B", source: "customer_tag", matchedTag };
  }

  return { segment: "B2C", source: "fallback" };
}
