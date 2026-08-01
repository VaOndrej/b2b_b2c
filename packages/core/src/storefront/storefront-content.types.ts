import type { Segment } from "../segment/segment.types";

export type PageType =
  | "ALL"
  | "HOME"
  | "PRODUCT"
  | "COLLECTION"
  | "CART"
  | "PAGE";

export type TargetType = "CSS_SELECTOR" | "SEMANTIC_POSITION";

export type SemanticPosition =
  | "TOP_BANNER"
  | "ABOVE_TITLE"
  | "BELOW_TITLE"
  | "ABOVE_ADD_TO_CART"
  | "BELOW_ADD_TO_CART"
  | "BOTTOM_BANNER";

export type ContentAction =
  | "SWAP_IMAGE"
  | "SWAP_TEXT"
  | "SWAP_HTML"
  | "SWAP_HREF"
  | "HIDE"
  | "SHOW"
  | "ADD_CLASS"
  | "REMOVE_CLASS";

export interface StorefrontContentRule {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  segment: Segment;
  pageType: PageType;
  productId?: string | null;
  collectionId?: string | null;
  targetType: TargetType;
  targetSelector?: string | null;
  targetPosition?: string | null;
  action: ContentAction;
  value?: string | null;
  valueCsLocale?: string | null;
}

export type CollectionVisibilityMode = "B2B_ONLY" | "B2C_ONLY";

export interface CollectionVisibilityRule {
  id: string;
  collectionId: string;
  collectionHandle: string;
  collectionTitle?: string | null;
  visibilityMode: CollectionVisibilityMode;
}

export interface StorefrontContentInput {
  segment: Segment;
  pageType: PageType;
  productId?: string | null;
  collectionHandle?: string | null;
  locale?: string;
  rules: StorefrontContentRule[];
  collectionVisibilityRules: CollectionVisibilityRule[];
}

export interface ResolvedContentRule {
  targetType: TargetType;
  targetSelector?: string | null;
  targetPosition?: string | null;
  action: ContentAction;
  value?: string | null;
  pageType: PageType;
  priority: number;
}

export interface StorefrontContentOutput {
  segment: Segment;
  contentRules: ResolvedContentRule[];
  hiddenCollections: string[];
  collectionRedirectMessage: string;
}
