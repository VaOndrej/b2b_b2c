export const MAIN_PRODUCT_SECTION_TYPES: readonly ["main-product", "product-information"];

export interface TemplateOverlayBlock {
  id: string;
  type: string;
  settings?: Record<string, unknown>;
}

export type TemplateOverlayPosition =
  | "start"
  | "end"
  | { index: number }
  | { before: string }
  | { after: string }
  /** Before / after the first block of that type in block_order (robust against the editor's random ids). */
  | { beforeType: string }
  | { afterType: string };

export interface TemplateOverlay {
  /** Path to a template file, relative to the theme workspace (e.g. "templates/product.json"). */
  template: string;
  /**
   * Section `type` values used to locate the target section. Defaults to
   * MAIN_PRODUCT_SECTION_TYPES, which matches both Horizon and Dawn's main
   * product section.
   */
  sectionTypes?: string[];
  /**
   * Insert into a nested block instead of the section: the ONE top-level block
   * of the section whose type is listed (e.g. Horizon's `_product-details`,
   * which accepts `@app` blocks next to the price and buy buttons). Omitted =
   * the section's own block list.
   */
  parentBlockTypes?: string[];
  block: TemplateOverlayBlock;
  /** Where to insert the block in the section's block_order. Defaults to "end". */
  position?: TemplateOverlayPosition;
}

export interface NormalizedTemplateOverlay {
  template: string;
  sectionTypes: string[];
  parentBlockTypes: string[] | null;
  block: { id: string; type: string; settings: Record<string, unknown> };
  position: TemplateOverlayPosition;
}

export interface TemplateOverlayPlan {
  template: string;
  sectionKey: string;
  sectionType: string;
  /** Key of the nested block the overlay inserts into (parentBlockTypes), else null. */
  parentBlockKey: string | null;
  blockId: string;
  blockType: string;
  action: "insert" | "noop";
  index: number;
}

export interface TemplateOverlayResult extends TemplateOverlayPlan {
  filePath: string;
}

export function validateTemplateOverlay(
  overlay: TemplateOverlay,
): NormalizedTemplateOverlay;

export function planTemplateOverlay(
  template: unknown,
  overlay: TemplateOverlay,
): TemplateOverlayPlan;

export function applyTemplateOverlay(
  template: unknown,
  overlay: TemplateOverlay,
): unknown;

export function planTemplateOverlays(options: {
  workspaceDirectory: string;
  templateOverlays?: TemplateOverlay[];
}): Promise<TemplateOverlayResult[]>;

export function applyTemplateOverlays(options: {
  workspaceDirectory: string;
  templateOverlays?: TemplateOverlay[];
}): Promise<TemplateOverlayResult[]>;
