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
  | { after: string };

export interface TemplateOverlay {
  /** Path to a template file, relative to the theme workspace (e.g. "templates/product.json"). */
  template: string;
  /**
   * Section `type` values used to locate the target section. Defaults to
   * MAIN_PRODUCT_SECTION_TYPES, which matches both Horizon and Dawn's main
   * product section.
   */
  sectionTypes?: string[];
  block: TemplateOverlayBlock;
  /** Where to insert the block in the section's block_order. Defaults to "end". */
  position?: TemplateOverlayPosition;
}

export interface NormalizedTemplateOverlay {
  template: string;
  sectionTypes: string[];
  block: { id: string; type: string; settings: Record<string, unknown> };
  position: TemplateOverlayPosition;
}

export interface TemplateOverlayPlan {
  template: string;
  sectionKey: string;
  sectionType: string;
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
