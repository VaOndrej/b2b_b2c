// MVP 7 contract M7 (SEC-3): the Pro look's custom CSS is always scoped to the Won block root and refused whole
// when it could reach outside the stylesheet, load anything, or name something global.

import assert from "node:assert/strict";
import { test } from "node:test";

import { CUSTOM_CSS_MAX_LENGTH, scopeCss } from "../../src/discounts/scope-css.ts";

const ROOT = ".won-discounts";
const ok = (css: string) => {
  const r = scopeCss(css, ROOT);
  assert.ok(r.ok, `${css} → ${JSON.stringify(r)}`);
  return r.css;
};
const reason = (css: string) => {
  const r = scopeCss(css, ROOT);
  return r.ok ? "ok" : r.reason;
};

test("every selector of every rule goes under the root; comments and extra white space are dropped", () => {
  assert.equal(ok(".won-tiers__row { color: red; }"), ".won-discounts .won-tiers__row{color: red;}");
  assert.equal(ok("h3, .a > b ,\n [data-x='1']{margin:0}"), ".won-discounts h3,.won-discounts .a > b,.won-discounts [data-x='1']{margin:0}");
  assert.equal(ok("/* look */ .a{b:c} /* end */"), ".won-discounts .a{b:c}");
  assert.equal(ok(""), "");
  assert.equal(ok("   \n "), "");
});

test(":root, html and body mean the block root itself — a rule can never style the page", () => {
  assert.equal(ok(":root{--won-accent:#f00}"), ".won-discounts{--won-accent:#f00}");
  assert.equal(ok("body .x{a:b}"), ".won-discounts .x{a:b}");
  assert.equal(ok("html{a:b} body{c:d}"), ".won-discounts{a:b}.won-discounts{c:d}");
  assert.equal(ok("body.dark .x{a:b}"), ".won-discounts.dark .x{a:b}");
  assert.equal(ok("bodybuilder{a:b}"), ".won-discounts bodybuilder{a:b}", "only the whole word");
  assert.equal(ok("*{a:b}"), ".won-discounts *{a:b}");
});

test("@media, @supports and @container keep their condition; the rules inside are scoped", () => {
  assert.equal(ok("@media (max-width: 600px) { .a{b:c} .d{e:f} }"), "@media (max-width: 600px){.won-discounts .a{b:c}.won-discounts .d{e:f}}");
  assert.equal(ok("@supports (display:grid){@media print{.a{b:c}}}"), "@supports (display:grid){@media print{.won-discounts .a{b:c}}}");
});

test("anything that leaves the stylesheet, loads something or is global is refused whole", () => {
  for (const css of [
    ".a{b:c}</style><script>alert(1)</script>",
    ".a{background:url(https://evil.example/x.png)}",
    ".a{background:URL ( x )}",
    ".a{width:expression(alert(1))}",
    "@import 'https://evil.example/x.css';",
    "@font-face{font-family:x;src:local(x)}",
    "@keyframes spin{from{a:b}to{c:d}}",
    ".a{content:'\\3c script'}",
    ".a{background:image-set('x.png' 1x)}",
    "@layer base{.a{b:c}}",
  ]) {
    assert.equal(reason(css), "forbidden", css);
  }
  assert.equal(reason("@page{margin:0}"), "at_rule");
  assert.equal(reason("@media screen;.a{b:c}"), "at_rule");
});

test("broken CSS is refused: unbalanced braces, a rule without a selector, an unclosed comment, too long", () => {
  for (const css of [".a{b:c", ".a{b:c}}", "}", ".a{.b{c:d}}", "/* open .a{b:c}"]) assert.equal(reason(css), "unbalanced", css);
  assert.equal(reason("{a:b}"), "selector");
  assert.equal(reason(".a,,.b{c:d}"), "selector");
  assert.equal(reason(`.a{b:c}${" ".repeat(CUSTOM_CSS_MAX_LENGTH)}`), "too_long");
});

test("property: whatever passes, every top-level selector starts with the root", () => {
  const samples = [".a{b:c}", "a,b,c{d:e}", ":root{x:y}", "@media (min-width:1px){.a,.b{c:d}}", "html .a:hover > .b::after{content:'x'}"];
  for (const css of samples) {
    const out = ok(css);
    const selectors = out.replace(/@[^{]+\{/g, "").split("}").filter(Boolean).flatMap((rule) => rule.split("{")[0]!.split(","));
    for (const s of selectors) assert.ok(s.startsWith(ROOT), `${css} → ${s}`);
  }
});
