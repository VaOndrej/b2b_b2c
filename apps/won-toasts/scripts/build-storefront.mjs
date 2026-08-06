import { transform } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Won Toasts ships the storefront runtime MINIFIED (esbuild) to stay well under
// the storefront performance budget. The AUTHORED, readable, spec-mirroring
// source lives in storefront-src/ (outside the theme extension, whose only
// supported dirs are assets/blocks/snippets/locales) and is the file developers
// edit. This script emits the shipped assets/won-toasts.js from it.
//
// Determinism matters: a given esbuild version + this source => identical bytes.
// The storefront-build contract test re-runs buildStorefront() and asserts the
// committed asset equals it, so a hand-edit or a forgotten rebuild fails the gate.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "..");

export const SOURCE = path.join(APP_ROOT, "storefront-src/won-toasts.js");
export const ASSET = path.join(
  APP_ROOT,
  "extensions/won-toasts-storefront/assets/won-toasts.js",
);

// Provenance + an eslint-disable so the generated single-line artifact is not
// linted (the readable source is what lint and the marker contract check).
const BANNER =
  "/* won-toasts.js — GENERATED from storefront-src/won-toasts.js by " +
  "scripts/build-storefront.mjs. Do not edit; run `npm run build:storefront`. */\n" +
  "/* eslint-disable */\n";

export async function buildStorefront() {
  const source = readFileSync(SOURCE, "utf8");
  const result = await transform(source, {
    minify: true,
    legalComments: "none",
    // Deliberately NO `target`: keep the authored, storefront-safe syntax level.
    // minify only strips whitespace/comments and renames locals; downleveling
    // could alter semantics, so we never ask esbuild to transpile.
  });
  return BANNER + result.code;
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const out = await buildStorefront();
  writeFileSync(ASSET, out);
  process.stdout.write(
    `built ${path.relative(APP_ROOT, ASSET)} (${Buffer.byteLength(out)} B raw)\n`,
  );
}
