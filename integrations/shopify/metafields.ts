export interface SegmentConfigMetafield {
  namespace: string;
  key: string;
  value: string;
}

export const segmentConfigMetafield: SegmentConfigMetafield = {
  namespace: "margin_guard",
  key: "b2b_tag",
  value: "b2b",
};
