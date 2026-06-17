export type Segment = "B2B" | "B2C";

// Runtime source of truth for the Segment union. The `satisfies Record<Segment, …>`
// guard fails compilation if Segment ever gains/loses a member, so callers that
// need to validate a raw value (e.g. the gated E2E segment override) derive the
// allowed set from here instead of hardcoding/guessing it.
const SEGMENT_VALUES = {
  B2B: true,
  B2C: true,
} as const satisfies Record<Segment, true>;

export const SEGMENTS = Object.keys(SEGMENT_VALUES) as Segment[];

export function isSegment(value: unknown): value is Segment {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(SEGMENT_VALUES, value)
  );
}

export type SegmentSource = "company_role" | "customer_tag" | "fallback";

export interface SegmentInput {
  customerTags?: string[];
  b2bTag?: string;
  hasPurchasingCompany?: boolean;
}

export interface SegmentResolution {
  segment: Segment;
  source: SegmentSource;
  matchedTag?: string;
}
