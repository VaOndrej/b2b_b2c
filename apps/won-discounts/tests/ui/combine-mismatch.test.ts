// The admin preview imports the storefront CSS / locales with Vite `?raw`: node needs the hook first.
import "./support/raw-import.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router";

// A mismatch of "Sčítá se s" (14 Oct 2026, krok 5 of navrh-kombinace-2026-10-13.md): one finding a discount on
// Vyzkoušet košík with the two buttons, a red dot at "Kombinace a trhy" in the editor, a note in the discount
// list. The dev harness's ?mismatch=on: the sales take automatic discounts, which do not take the sales.

let prevEnv: string | undefined;
before(() => {
  prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
});
after(() => {
  if (prevEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = prevEnv;
});

async function render(path: string): Promise<string> {
  const mod = await import("../../app/routes/dev.preview.$.tsx");
  const routes = [{ path: "/dev/preview/*", loader: mod.loader, action: mod.action, Component: mod.default }];
  const handler = createStaticHandler(routes);
  const context = await handler.query(new Request(`http://localhost/dev/preview/${path}`));
  assert.ok(!(context instanceof Response), `${path}: a redirect`);
  assert.equal(context.statusCode, 200, path);
  const router = createStaticRouter(handler.dataRoutes, context);
  return renderToString(createElement(StaticRouterProvider, { router, context })).replace(/<script[\s\S]*?<\/script>/g, "");
}

test("Vyzkoušet košík: one finding a discount that allows, on every plan, with the two buttons and where its list is", async () => {
  for (const path of ["try-cart?mismatch=on", "try-cart?mismatch=on&plan=pro"]) {
    const html = await render(path);
    const at = html.indexOf('<section id="mismatches"');
    assert.ok(at >= 0, `${path}: the section`);
    const part = html.slice(at, html.indexOf("</section>", at));
    assert.equal((part.match(/data-won-mismatch="/g) ?? []).length, 1, path);
    assert.match(part, /Sčítání dovoluje jen jedna strana: Výprodej ano, „[^“]+“/);
    assert.match(part, /data-won-mismatch-fix="allow"[\s\S]*name="mismatchId" value="outlet"[\s\S]*Povolit i u druhé strany/);
    assert.match(part, /data-won-mismatch-fix="deny"[\s\S]*Zakázat i tady/);
    assert.match(part, /href="\/app\/outlet#combine-types"/);
  }
  // No mismatch: no section.
  assert.doesNotMatch(await render("try-cart?plan=pro"), /<section id="mismatches"/);
});

test("the discount in a mismatch: a red dot at Kombinace a trhy and the finding under its list; a note in the list of discounts", async () => {
  const editor = await render("rule-editor?rule=dev-fixture-4&mismatch=on");
  assert.match(editor, /Sčítání dovoluje jen jedna strana: Výprodej ano, „[^“]+“[^.]* ne\. V košíku se proto nesečtou\./);
  assert.match(editor, /href="\/app\/try-cart#mismatches"[^>]*>Srovnat/);
  // The dot in "Na této stránce": at the section that holds the lists.
  assert.match(editor, /href="#pro"[\s\S]{0,400}?data-won-dot="attention"|data-won-dot="attention"[\s\S]{0,400}?Kombinace a trhy/);
  assert.doesNotMatch(await render("rule-editor?rule=dev-fixture-4"), /href="\/app\/try-cart#mismatches"/);
  const list = await render("discounts?mismatch=on");
  assert.match(list, /Sčítání s jinou slevou dovoluje jen jedna strana\./);
  assert.doesNotMatch(await render("discounts"), /Sčítání s jinou slevou dovoluje jen jedna strana\./);
});
