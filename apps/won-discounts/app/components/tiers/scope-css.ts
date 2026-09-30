// The storefront block's CSS (extensions/won-discounts-storefront/assets/
// won-discounts-tiers.css, the SAME file the theme loads — doctrine A1) runs in
// the admin preview only inside the preview container: every rule is nested
// under the scope selector (native CSS nesting — a nested selector without `&`
// is a descendant of the scope), so it can never style anything else in the
// admin. At-rules that cannot be nested (@keyframes, @font-face, @property,
// @import, @layer statements) stay top-level. Comments and strings are skipped
// while splitting, so a "}" inside them never breaks a rule. Pure.

const TOP_LEVEL_AT = /^@(?:-webkit-)?(?:keyframes|font-face|property|import|layer|charset|namespace)\b/i;

/** Top-level CSS blocks (a rule, an at-rule with its body, or a `;` statement), comments dropped. */
function topLevelBlocks(css: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  const push = (end: number) => {
    const text = css.slice(start, end).trim();
    if (text) blocks.push(text);
    start = end;
  };
  while (i < css.length) {
    const ch = css[i]!;
    if (ch === "/" && css[i + 1] === "*") {
      const close = css.indexOf("*/", i + 2);
      const end = close === -1 ? css.length : close + 2;
      if (depth === 0) {
        // A top-level comment is dropped (it would otherwise glue onto the next rule's selector).
        push(i);
        start = end;
      }
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== ch) j += css[j] === "\\" ? 2 : 1;
      i = j + 1;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth = Math.max(0, depth - 1);
      if (depth === 0) push(i + 1);
    } else if (ch === ";" && depth === 0) push(i + 1);
    i += 1;
  }
  push(css.length);
  return blocks;
}

/** `css` confined to `scope` (see the header): hoisted at-rules first, then `scope { …rules… }`. */
export function scopeCss(css: string, scope: string): string {
  const hoisted: string[] = [];
  const nested: string[] = [];
  for (const block of topLevelBlocks(css)) (TOP_LEVEL_AT.test(block) ? hoisted : nested).push(block);
  const inner = nested.length > 0 ? `${scope} {\n${nested.join("\n")}\n}` : "";
  return [...hoisted, inner].filter(Boolean).join("\n");
}
