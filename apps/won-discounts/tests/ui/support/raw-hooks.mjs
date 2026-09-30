// Node module hooks for Vite's `?raw` imports (a file's text as the default
// export). The admin preview imports the storefront extension's CSS and locales
// that way (app/components/tiers/TiersPreview.tsx — the SAME files the theme
// loads, doctrine A1); Vite does it in the app build, these hooks do it for the
// node test runner (tsx). tsx may hand the specifier over as `…css?raw` or with
// the query URL-encoded (`%3Fraw=`), both are accepted.

import { readFile } from "node:fs/promises";

const RAW = /(?:\?|%3F)raw=?$/i;

export async function resolve(specifier, context, nextResolve) {
  if (RAW.test(specifier)) {
    const file = new URL(specifier.replace(RAW, ""), context.parentURL);
    return { url: `${file.href}?raw`, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (url.endsWith("?raw")) {
    const text = await readFile(new URL(url.slice(0, -"?raw".length)), "utf8");
    return { format: "module", source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
  }
  return nextLoad(url, context);
}
