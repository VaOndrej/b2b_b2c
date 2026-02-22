export interface SegmentConfigMetafield {
  namespace: string;
  key: string;
  value: string;
}

export const segmentConfigMetafieldDefaults: SegmentConfigMetafield = {
  namespace: "margin_guard",
  key: "b2b_tag",
  value: "b2b",
};

export function resolveB2BTagFromMetafield(
  value: string | null | undefined,
  fallback = segmentConfigMetafieldDefaults.value,
): string {
  const resolved = (value ?? "").trim().toLowerCase();
  return resolved || fallback;
}
