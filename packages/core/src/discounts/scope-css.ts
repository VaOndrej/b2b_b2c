// Custom CSS of the Pro look (MVP 7, contract M7, decision P5; SEC-3): the merchant's (or their AI's) CSS for the
// Won blocks is ALWAYS confined to the blocks — every selector is prefixed with the block root before it reaches
// a page, and anything that could reach outside the stylesheet or load something is refused whole.
//
//   scopeCss(css, root)  → { ok: true, css } with every rule's selectors under `root`, or { ok: false, reason }.
// Refused (the whole text, never repaired piecemeal): `<` (a closing style tag, markup), a backslash (escapes
// hide keywords), `url(`, `expression(`, `image-set(`, `@import`, `@font-face`, `@namespace`, `@charset`, `@property`,
// `@keyframes` (a global name), `@layer`, unbalanced braces, a rule without a selector, more than
// CUSTOM_CSS_MAX_LENGTH characters. Allowed at-rules: `@media`, `@supports`, `@container` (their content is scoped
// the same way). Comments are dropped. Selectors `:root`, `html` and `body` become the root itself.
// The result is plain text for a <style> element; with `<` refused it cannot end that element.

export const CUSTOM_CSS_MAX_LENGTH = 4000;

export type ScopeCssReason = "too_long" | "forbidden" | "unbalanced" | "at_rule" | "selector";
export type ScopeCssResult = { ok: true; css: string } | { ok: false; reason: ScopeCssReason; detail?: string };

const FORBIDDEN = /<|\\|url\s*\(|expression\s*\(|image-set\s*\(|javascript:|@import|@font-face|@namespace|@charset|@property|@keyframes|@layer/i;
const NESTING_AT_RULES = new Set(["@media", "@supports", "@container"]);

function stripComments(css: string): string | null {
  let out = "";
  for (let i = 0; i < css.length; ) {
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      if (end === -1) return null;
      i = end + 2;
      out += " ";
    } else out += css[i++];
  }
  return out;
}

function scopeSelector(selector: string, root: string): string | null {
  const s = selector.trim().replace(/\s+/g, " ");
  if (s === "" || /[{};]/.test(s)) return null;
  const replaced = s.replace(/^(?::root|html|body)(?=$|[\s>+~.:#[])/i, "");
  if (replaced !== s) return `${root}${replaced.startsWith(" ") || replaced === "" ? replaced : replaced}`.trim();
  return `${root} ${s}`;
}

/** Scope the rules of `css` (between `from` and its matching end) — returns the scoped text and where it stopped. */
function scopeBlock(css: string, start: number, root: string, nested: boolean): { text: string; end: number } | ScopeCssReason {
  let out = "";
  let i = start;
  for (;;) {
    while (i < css.length && /\s/.test(css[i]!)) i += 1;
    if (i >= css.length) return nested ? "unbalanced" : { text: out, end: i };
    if (css[i] === "}") return nested ? { text: out, end: i + 1 } : "unbalanced";
    const open = css.indexOf("{", i);
    const stray = css.indexOf("}", i);
    if (open === -1 || (stray !== -1 && stray < open)) return "unbalanced";
    const prelude = css.slice(i, open).trim();
    if (prelude.startsWith("@")) {
      const name = /^@[a-z-]+/i.exec(prelude)?.[0].toLowerCase() ?? "";
      if (!NESTING_AT_RULES.has(name) || /[;{}]/.test(prelude)) return "at_rule";
      const inner = scopeBlock(css, open + 1, root, true);
      if (typeof inner === "string") return inner;
      out += `${prelude.replace(/\s+/g, " ")}{${inner.text}}`;
      i = inner.end;
      continue;
    }
    const close = css.indexOf("}", open + 1);
    if (close === -1) return "unbalanced";
    const body = css.slice(open + 1, close);
    if (body.includes("{")) return "unbalanced";
    const selectors = prelude.split(",").map((s) => scopeSelector(s, root));
    if (selectors.some((s) => s === null)) return "selector";
    out += `${selectors.join(",")}{${body.trim().replace(/\s+/g, " ")}}`;
    i = close + 1;
  }
}

export function scopeCss(css: string, root: string): ScopeCssResult {
  if (css.length > CUSTOM_CSS_MAX_LENGTH) return { ok: false, reason: "too_long" };
  const forbidden = FORBIDDEN.exec(css);
  if (forbidden) return { ok: false, reason: "forbidden", detail: forbidden[0].trim().toLowerCase() };
  const plain = stripComments(css);
  if (plain === null) return { ok: false, reason: "unbalanced" };
  const scoped = scopeBlock(plain, 0, root, false);
  if (typeof scoped === "string") return { ok: false, reason: scoped };
  return { ok: true, css: scoped.text };
}
