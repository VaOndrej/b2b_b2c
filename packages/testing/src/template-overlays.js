import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Section `type` values that Shopify assigns to the main product section of
 * `templates/product.json` in the themes this package knows how to run
 * against. Horizon (theme 2.0 / "sections everywhere") uses
 * "product-information"; Dawn uses "main-product". A single templateOverlay
 * definition can therefore target both themes without knowing which one it
 * is running against.
 */
export const MAIN_PRODUCT_SECTION_TYPES = ["main-product", "product-information"];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function stripGeneratedHeader(content) {
  return content.replace(/^﻿?\s*\/\*[\s\S]*?\*\/\s*/u, "");
}

/**
 * Validates and normalizes a templateOverlay definition (throws loudly on
 * anything malformed). Returns a copy with `sectionTypes` and `position`
 * defaulted.
 */
export function validateTemplateOverlay(overlay) {
  if (!isPlainObject(overlay)) {
    throw new Error("templateOverlay must be an object.");
  }
  requireNonEmptyString(overlay.template, "templateOverlay.template");
  if (path.isAbsolute(overlay.template)) {
    throw new Error("templateOverlay.template must be relative to the theme workspace.");
  }

  const sectionTypes = overlay.sectionTypes ?? MAIN_PRODUCT_SECTION_TYPES;
  if (
    !Array.isArray(sectionTypes) ||
    sectionTypes.length === 0 ||
    sectionTypes.some((type) => typeof type !== "string" || type.trim() === "")
  ) {
    throw new Error(
      "templateOverlay.sectionTypes must be a non-empty array of strings.",
    );
  }

  if (!isPlainObject(overlay.block)) {
    throw new Error("templateOverlay.block must be an object.");
  }
  requireNonEmptyString(overlay.block.id, "templateOverlay.block.id");
  requireNonEmptyString(overlay.block.type, "templateOverlay.block.type");
  if (
    overlay.block.settings !== undefined &&
    !isPlainObject(overlay.block.settings)
  ) {
    throw new Error(
      "templateOverlay.block.settings must be an object when provided.",
    );
  }

  const position = overlay.position ?? "end";
  const isKnownKeyword = position === "start" || position === "end";
  const isIndexPosition =
    isPlainObject(position) && Number.isInteger(position.index);
  const isBeforePosition =
    isPlainObject(position) &&
    typeof position.before === "string" &&
    position.before.trim() !== "";
  const isAfterPosition =
    isPlainObject(position) &&
    typeof position.after === "string" &&
    position.after.trim() !== "";
  if (
    !isKnownKeyword &&
    !isIndexPosition &&
    !isBeforePosition &&
    !isAfterPosition
  ) {
    throw new Error(
      'templateOverlay.position must be "start", "end", { index }, { before } or { after }.',
    );
  }

  return {
    template: overlay.template,
    sectionTypes,
    block: {
      id: overlay.block.id,
      type: overlay.block.type,
      settings: overlay.block.settings ?? {},
    },
    position,
  };
}

function findMainSectionEntry(sections, sectionTypes) {
  if (!isPlainObject(sections)) {
    throw new Error("Template has no sections object to overlay.");
  }
  const matches = Object.entries(sections).filter(
    ([, section]) =>
      isPlainObject(section) && sectionTypes.includes(section.type),
  );
  if (matches.length === 0) {
    throw new Error(
      `No section with type in [${sectionTypes.join(", ")}] found; expected the main product section.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous main product section: multiple sections match type in [${sectionTypes.join(
        ", ",
      )}] (${matches.map(([key]) => key).join(", ")}).`,
    );
  }
  return matches[0];
}

function resolveInsertIndex(blockOrder, position) {
  if (position === "end") {
    return blockOrder.length;
  }
  if (position === "start") {
    return 0;
  }
  if (Number.isInteger(position.index)) {
    return Math.max(0, Math.min(position.index, blockOrder.length));
  }
  if (typeof position.before === "string") {
    const index = blockOrder.indexOf(position.before);
    if (index === -1) {
      throw new Error(
        `templateOverlay position.before references unknown block "${position.before}".`,
      );
    }
    return index;
  }
  if (typeof position.after === "string") {
    const index = blockOrder.indexOf(position.after);
    if (index === -1) {
      throw new Error(
        `templateOverlay position.after references unknown block "${position.after}".`,
      );
    }
    return index + 1;
  }
  throw new Error("templateOverlay.position is invalid.");
}

/**
 * Pure: computes what applying a single overlay to a parsed template JSON
 * object would do, without mutating it. Throws loudly if the target section
 * cannot be found unambiguously.
 */
export function planTemplateOverlay(template, overlayInput) {
  const overlay = validateTemplateOverlay(overlayInput);
  if (!isPlainObject(template)) {
    throw new Error(`Template ${overlay.template} is not a JSON object.`);
  }
  const [sectionKey, section] = findMainSectionEntry(
    template.sections,
    overlay.sectionTypes,
  );
  const blocks = isPlainObject(section.blocks) ? section.blocks : {};
  const blockOrder = Array.isArray(section.block_order)
    ? section.block_order
    : [];
  const alreadyPresent = Object.prototype.hasOwnProperty.call(
    blocks,
    overlay.block.id,
  );
  if (alreadyPresent && blocks[overlay.block.id]?.type !== overlay.block.type) {
    throw new Error(
      `templateOverlay block id "${overlay.block.id}" already exists in ${overlay.template}#${sectionKey} with a different type ` +
        `(${blocks[overlay.block.id]?.type} !== ${overlay.block.type}).`,
    );
  }
  const index = alreadyPresent
    ? blockOrder.indexOf(overlay.block.id)
    : resolveInsertIndex(blockOrder, overlay.position);
  return {
    template: overlay.template,
    sectionKey,
    sectionType: section.type,
    blockId: overlay.block.id,
    blockType: overlay.block.type,
    action: alreadyPresent ? "noop" : "insert",
    index,
  };
}

/**
 * Pure: returns a new template JSON object with the overlay block inserted.
 * Idempotent — reapplying to an already-overlaid template returns an
 * equivalent (deep-cloned) object unchanged.
 */
export function applyTemplateOverlay(template, overlayInput) {
  const overlay = validateTemplateOverlay(overlayInput);
  const plan = planTemplateOverlay(template, overlay);
  const result = structuredClone(template);
  const section = result.sections[plan.sectionKey];
  if (!isPlainObject(section.blocks)) {
    section.blocks = {};
  }
  if (!Array.isArray(section.block_order)) {
    section.block_order = [];
  }
  if (plan.action === "noop") {
    return result;
  }
  section.blocks[overlay.block.id] = {
    type: overlay.block.type,
    settings: overlay.block.settings,
  };
  section.block_order.splice(plan.index, 0, overlay.block.id);
  return result;
}

function resolveTemplatePath(workspaceDirectory, templateRelativePath) {
  const normalizedWorkspace = path.resolve(workspaceDirectory);
  const templatePath = path.resolve(
    normalizedWorkspace,
    templateRelativePath,
  );
  const relative = path.relative(normalizedWorkspace, templatePath);
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`)
  ) {
    throw new Error(
      `templateOverlay.template escapes the theme workspace: ${templateRelativePath}`,
    );
  }
  return templatePath;
}

async function readTemplateJson(filePath) {
  let content;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    throw new Error(
      `Cannot read template ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    return JSON.parse(stripGeneratedHeader(content));
  } catch (error) {
    throw new Error(
      `Invalid JSON in template ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Pure/read-only: reports what applying `templateOverlays` to the theme
 * checkout at `workspaceDirectory` would change, without writing anything.
 * This is the --check building block for the E2E generator.
 */
export async function planTemplateOverlays({
  workspaceDirectory,
  templateOverlays,
}) {
  const overlays = templateOverlays ?? [];
  const plans = [];
  for (const overlayInput of overlays) {
    const overlay = validateTemplateOverlay(overlayInput);
    const filePath = resolveTemplatePath(workspaceDirectory, overlay.template);
    const templateJson = await readTemplateJson(filePath);
    plans.push({ ...planTemplateOverlay(templateJson, overlay), filePath });
  }
  return plans;
}

/**
 * Applies `templateOverlays` to the theme checkout at `workspaceDirectory`,
 * writing back only the template files that actually changed. Idempotent:
 * re-running on an already-overlaid workspace is a no-op per overlay.
 */
export async function applyTemplateOverlays({
  workspaceDirectory,
  templateOverlays,
}) {
  const overlays = templateOverlays ?? [];
  const results = [];
  for (const overlayInput of overlays) {
    const overlay = validateTemplateOverlay(overlayInput);
    const filePath = resolveTemplatePath(workspaceDirectory, overlay.template);
    const templateJson = await readTemplateJson(filePath);
    const plan = planTemplateOverlay(templateJson, overlay);
    if (plan.action === "insert") {
      const updated = applyTemplateOverlay(templateJson, overlay);
      await writeFile(filePath, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
    }
    results.push({ ...plan, filePath });
  }
  return results;
}
