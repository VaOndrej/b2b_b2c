#!/usr/bin/env node
// Generates the E2E settings_data overlays that switch the Won Discounts app
// embed ON in the shared Horizon and Dawn themes — no manual theme-editor step
// per run.
//
// The matrix runner (packages/testing/scripts/run-theme-matrix.mjs) copies the
// canonical theme into tmp/e2e-themes/won-discounts/<theme> and then REPLACES
// its config/settings_data.json with the overlay named in e2e.app.config.mjs.
// So an overlay must be the whole canonical file plus our embed block, never a
// partial patch. This script builds exactly that:
//
//   canonical b2b_b2c_themes/<Theme>/config/settings_data.json
//   + current.blocks[<stable key>] = { type: <our embed>, disabled: false, settings: {} }
//
// Deterministic and re-runnable: same canonical input → byte-identical output.
// The canonical header comment and key order are preserved, and any existing
// block of our embed (under any key, any extension id) is replaced by the one
// stable key, so the diff against the canonical file is exactly the added block.
//
// EXTENSION ID — READ THIS. The last segment of the block type is NOT the `uid`
// from shopify.extension.toml. It is the extension registration UUID that
// Shopify assigns on the platform (Won Toasts: toml uid b1f133d7-… but the
// settings_data type ends in 019fcc26-7067-7681-bdda-e97362bc9997). A block
// whose type carries the toml uid uploads "successfully" and is then silently
// dropped by Shopify, so the embed never renders (verified 2026-09-28 against
// the Horizon E2E theme). The registration UUID is stable for the life of the
// app (created on the first `shopify app dev` that registered the extension),
// so it is hard-coded below. To re-derive it (e.g. after the app is recreated
// under a new client_id): enable the embed once in the theme editor on any
// unpublished theme of the dev store, then read that theme's settings_data:
//
//   shopify theme pull --store b2b-b2c-store-development.myshopify.com \
//     --theme Horizon --only config/settings_data.json --path /tmp/wd-pull
//   grep -o 'won_discounts_embed/[0-9a-f-]*' /tmp/wd-pull/config/settings_data.json
//
// and update EMBED_EXTENSION_UUID (or pass --extension-uuid <UUID> once).
//
// Usage (from apps/won-discounts):
//   node scripts/make-e2e-overlay.mjs          # (re)write e2e/settings_data.{horizon,dawn}.json
//   node scripts/make-e2e-overlay.mjs --check  # exit 1 when a committed overlay is stale
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// Same theme path resolution the runner uses (adjacent b2b_b2c_themes checkout,
// worktree fallback, SHOPIFY_E2E_THEME_DIR_{HORIZON,DAWN} overrides).
import { resolveThemePaths } from "@won/testing/theme-paths";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptDirectory, "..");
const repoRoot = path.resolve(appRoot, "../..");

// App handle as registered on Shopify (shopify.app.toml `name`); it is the
// `<app>` segment of shopify://apps/<app>/blocks/<block>/<extension UUID>.
const APP_HANDLE = "won-discounts";
// Shopify-assigned extension registration UUID of
// extensions/won-discounts-storefront — NOT its toml `uid` (7ffc5d3f-…).
// Read 2026-09-28 from the Horizon E2E theme (id 158110712049) after the embed
// was enabled once in the theme editor; UUIDv7 timestamp 2026-09-28T10:30:30Z
// = the first `shopify app dev` that registered the extension. See header.
const EMBED_EXTENSION_UUID = "01a0e790-ee4d-733c-ac8e-14c7baa03fff";

const EXTENSION_DIRECTORY = path.join(
  appRoot,
  "extensions/won-discounts-storefront",
);
const EMBED_BLOCK_FILE = path.join(
  EXTENSION_DIRECTORY,
  "blocks/won_discounts_embed.liquid",
);
const OVERLAY_DIRECTORY = path.join(appRoot, "e2e");
const THEME_KEYS = ["horizon", "dawn"];
const HEADER_COMMENT = /^\uFEFF?\s*\/\*[\s\S]*?\*\/\s*/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function readTomlUid() {
  const toml = readFileSync(
    path.join(EXTENSION_DIRECTORY, "shopify.extension.toml"),
    "utf8",
  );
  return toml.match(/^\s*uid\s*=\s*"([^"]+)"\s*$/mu)?.[1] ?? null;
}

function readArgument(name) {
  const inline = process.argv.find((argument) =>
    argument.startsWith(`--${name}=`),
  );
  if (inline) return inline.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function resolveExtensionUuid(candidate = EMBED_EXTENSION_UUID) {
  const uuid = String(candidate ?? "").trim().toLowerCase();
  if (!uuid) {
    throw new Error(
      "The Shopify-assigned extension registration UUID of won-discounts-storefront is not set.\n" +
        "  It is NOT the toml `uid`; see the header of scripts/make-e2e-overlay.mjs for how to read it,\n" +
        "  then set EMBED_EXTENSION_UUID or pass --extension-uuid <UUID>.",
    );
  }
  if (uuid === String(readTomlUid() ?? "").toLowerCase()) {
    throw new Error(
      `${uuid} is the shopify.extension.toml uid. Shopify drops app embed blocks that use it;\n` +
        "  use the platform registration UUID instead (see the script header).",
    );
  }
  if (!UUID.test(uuid)) {
    throw new Error(`Not a UUID: ${uuid}`);
  }
  return uuid;
}

export function embedBlockType(extensionUuid) {
  if (!existsSync(EMBED_BLOCK_FILE)) {
    throw new Error(`App embed block not found: ${EMBED_BLOCK_FILE}`);
  }
  const blockName = path.basename(EMBED_BLOCK_FILE, ".liquid");
  return `shopify://apps/${APP_HANDLE}/blocks/${blockName}/${extensionUuid}`;
}

// Theme-editor style numeric key, derived from the block handle so it never
// changes between runs (and never collides with the editor's random keys in
// practice).
export function stableBlockKey(type) {
  const stem = type.split("/").slice(0, -1).join("/");
  const digest = createHash("sha256").update(stem).digest();
  return digest.readBigUInt64BE(0).toString(10);
}

export function buildOverlay(canonicalContent, type) {
  const header = canonicalContent.match(HEADER_COMMENT)?.[0] ?? "";
  const data = JSON.parse(canonicalContent.slice(header.length));
  if (
    !data?.current ||
    typeof data.current !== "object" ||
    Array.isArray(data.current)
  ) {
    throw new Error(
      "canonical settings_data.json has no object-valued `current`.",
    );
  }
  const ourPrefix = `${type.split("/").slice(0, -1).join("/")}/`;
  const blocks = {};
  for (const [key, block] of Object.entries(data.current.blocks ?? {})) {
    if (!String(block?.type ?? "").startsWith(ourPrefix)) {
      blocks[key] = block;
    }
  }
  blocks[stableBlockKey(type)] = { type, disabled: false, settings: {} };
  data.current.blocks = blocks; // keeps its position when it already existed
  return `${header}${JSON.stringify(data, null, 2)}\n`;
}

function main() {
  const check = process.argv.includes("--check");
  const type = embedBlockType(
    resolveExtensionUuid(readArgument("extension-uuid") ?? EMBED_EXTENSION_UUID),
  );
  const themePaths = resolveThemePaths({ repoRoot, env: process.env });
  let stale = 0;

  mkdirSync(OVERLAY_DIRECTORY, { recursive: true });
  for (const key of THEME_KEYS) {
    const canonicalPath = path.join(
      themePaths[key],
      "config/settings_data.json",
    );
    if (!existsSync(canonicalPath)) {
      throw new Error(
        `${key}: canonical settings_data.json not found at ${canonicalPath}`,
      );
    }
    const overlay = buildOverlay(readFileSync(canonicalPath, "utf8"), type);
    const overlayPath = path.join(
      OVERLAY_DIRECTORY,
      `settings_data.${key}.json`,
    );
    const relativeOverlay = path.relative(appRoot, overlayPath);
    const current = existsSync(overlayPath)
      ? readFileSync(overlayPath, "utf8")
      : null;

    if (check) {
      if (current !== overlay) {
        stale += 1;
        console.error(`✗ ${relativeOverlay} is missing or stale vs ${canonicalPath}`);
      } else {
        console.log(`✓ ${relativeOverlay} up to date`);
      }
      continue;
    }
    if (current === overlay) {
      console.log(`= ${relativeOverlay} unchanged`);
    } else {
      writeFileSync(overlayPath, overlay);
      console.log(`✓ ${relativeOverlay} written from ${canonicalPath}`);
    }
  }
  console.log(
    `  embed block: ${type} (key ${stableBlockKey(type)}, disabled: false)`,
  );
  if (stale > 0) {
    console.error("Run `node scripts/make-e2e-overlay.mjs` to regenerate.");
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
