// What the pointer is on (feedback 10 Oct 2026, 7th round, body 1 a 1.5: "abych věděl, na čem mám myš"): every
// hand-built thing that can be clicked answers the pointer the same way, from ONE stylesheet. An element says what
// it is with `data-won-hover` (hoverMark) and gets:
//   tab    a link of a strip (SubNav): the text darkens, a faint wash and a grey line under it;
//   card   a surface to click (a tile, a choice card, a ready-made look): the border darkens, it lifts by a pixel;
//   row    a header that opens what is under it (a collapsible section, <summary>): a faint wash;
//   chip   a small pill or a segment of a segmented choice: a faint wash and a darker text;
//   icon   a bare icon button (×): a wash under the glyph;
//   link   a text button drawn as a link: the text takes the selection blue.
// The chosen one (aria-current, aria-pressed, data-won-on) and a disabled one do not answer: hover never competes
// with "selected" (§11a). The rules carry !important because the surfaces set their look inline (tokens.ts
// selectionRing, ModuleTile tileFrame) and an inline style beats a stylesheet. Polaris elements (s-button, s-link)
// bring their own hover and are not touched. No transition under "reduce motion".
// Mounted once per page by the layout (routes/app.tsx) and by the dev harness.

import { WON_INK, WON_SELECT } from "./tokens";

export type HoverKind = "tab" | "card" | "row" | "chip" | "icon" | "link";

/** The attribute that makes an element answer the pointer. `on`: it is the chosen one (it then stays as it is). */
export function hoverMark(kind: HoverKind, on = false): Record<string, string> {
  return on ? { "data-won-hover": kind, "data-won-on": "" } : { "data-won-hover": kind };
}

const OFF = ':not([aria-current]):not([aria-pressed="true"]):not([data-won-on]):not([aria-disabled="true"]):not(:disabled)';
const WASH = "rgba(17,20,24,.055)";

export const WON_HOVER_CSS = `
[data-won-hover]{transition:background-color .12s ease,border-color .12s ease,box-shadow .12s ease,color .12s ease,transform .12s ease}
[data-won-hover="tab"]${OFF}:hover{color:${WON_INK}!important;background:${WASH}!important;border-bottom-color:#b9c2cc!important}
[data-won-hover="tab"]{border-radius:8px 8px 0 0}
[data-won-hover="tab"]:focus-visible,[data-won-hover="chip"]:focus-visible,[data-won-hover="icon"]:focus-visible,[data-won-hover="link"]:focus-visible{outline:2px solid ${WON_SELECT};outline-offset:1px}
[data-won-hover="card"]${OFF}:hover{border-color:#8fa3b8!important;box-shadow:0 2px 4px rgba(20,28,45,.08),0 8px 22px rgba(20,28,45,.12)!important;transform:translateY(-1px)}
[data-won-hover="card"]:has(input:focus-visible){outline:2px solid ${WON_SELECT};outline-offset:2px}
[data-won-hover="row"]{border-radius:10px}
[data-won-hover="row"]${OFF}:hover{background:${WASH}!important;box-shadow:0 0 0 6px ${WASH}}
[data-won-hover="chip"]${OFF}:hover{color:${WON_INK}!important;background:${WASH}!important;border-color:#8fa3b8!important}
[data-won-hover="icon"]${OFF}:hover{color:${WON_INK}!important;background:rgba(17,20,24,.09)!important}
[data-won-hover="link"]${OFF}:hover{color:${WON_SELECT}!important}
s-clickable:hover>[data-won-hover="card"]{border-color:#8fa3b8!important;box-shadow:0 2px 4px rgba(20,28,45,.08),0 8px 22px rgba(20,28,45,.12)!important;transform:translateY(-1px)}
button:hover>[data-won-hover="card"]${OFF}{border-color:#8fa3b8!important;box-shadow:0 2px 4px rgba(20,28,45,.08),0 8px 22px rgba(20,28,45,.12)!important;transform:translateY(-1px)}
@media (hover:none){[data-won-hover]:hover{transform:none!important}}
@media (prefers-reduced-motion:reduce){[data-won-hover]{transition:none}[data-won-hover]:hover,:hover>[data-won-hover]{transform:none!important}}
`;

export function HoverStyles() {
  return <style data-won-hover-css="" dangerouslySetInnerHTML={{ __html: WON_HOVER_CSS }} />;
}
