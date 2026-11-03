import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Card, selectableStyle, TwoColumns } from "../../app/components/shell/Surface.tsx";
import { WON_AMBER, WON_ATTENTION_EDGE, WON_SELECT, WON_SELECT_TINT } from "../../app/components/shell/tokens.ts";

// The shell's surfaces (audit 2026-11-03 D1): a screen picks a tone, never a colour.

const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

test("a card's tone draws the agreed exception: amber Pro, red attention; selected is the blue ring over any tone", () => {
  assert.match(html(createElement(Card, { tone: "pro" }, "x")), new RegExp(`1px solid ${WON_AMBER}`, "i"));
  assert.match(html(createElement(Card, { tone: "attention" }, "x")), new RegExp(WON_ATTENTION_EDGE, "i"));
  const chosen = html(createElement(Card, { tone: "attention", selected: true }, "x"));
  assert.match(chosen, new RegExp(`2px solid ${WON_SELECT}`, "i"));
  assert.match(chosen, new RegExp(WON_SELECT_TINT, "i"));
  assert.deepEqual(Object.keys(selectableStyle(false)).sort(), ["background", "border", "boxShadow"]);
});

test("two columns: the main part and the preview, in the order asked", () => {
  const out = html(createElement(TwoColumns, { main: createElement("i", null, "main"), aside: createElement("b", null, "aside"), asideFirst: true }));
  assert.ok(out.indexOf("aside") < out.indexOf("main"));
  assert.match(out, /data-won-two-columns/);
});
