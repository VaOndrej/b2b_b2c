// The dev preview's screens as static HTML files, for screenshots when no dev server runs.
//
//   npx tsx apps/won-discounts/scripts/static-preview.ts <outDir> <name>=<screen?query> [...]
//
// Each file is the server render of /dev/preview/<screen> (the same loader → component path as a request), with
// Shopify's web components loaded from their CDN. Nothing is hydrated: it shows a state, it does not react to clicks.
import "../tests/ui/support/raw-import.ts";

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

process.env.NODE_ENV = "test";
const [outDir, ...screens] = process.argv.slice(2);
if (!outDir || screens.length === 0) throw new Error("Usage: static-preview.ts <outDir> <name>=<screen?query> [...]");
mkdirSync(outDir, { recursive: true });
const mod = await import("../app/routes/dev.preview.$.tsx");
const handler = createStaticHandler([{ path: "/dev/preview/*", loader: mod.loader, action: mod.action, Component: mod.default }]);
for (const entry of screens) {
  const at = entry.indexOf("=");
  const name = entry.slice(0, at);
  const context = await handler.query(new Request(`http://localhost/dev/preview/${entry.slice(at + 1)}`));
  if (context instanceof Response) throw new Error(`${name}: a redirect`);
  const body = renderToString(createElement(StaticRouterProvider, { router: createStaticRouter(handler.dataRoutes, context), context, hydrate: false }));
  const file = path.join(outDir, `${name}.html`);
  writeFileSync(file, `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${name}</title></head><body style="margin:0;background:#f1f2f4">${body}</body></html>`);
  console.log(file);
}
