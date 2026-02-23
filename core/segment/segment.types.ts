export type Segment = "B2B" | "B2C";

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
