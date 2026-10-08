// A row of numbers that jump to the repeated parts of ONE long section (the steps of Milníky): where the
// section itself is most of the page, a list of the page's sections would not help — its landmarks are the
// parts inside it.
//   - a <nav> with a label; every number is a real `#id` link, so it works before hydration; with JS the jump
//     is smooth (jumpBehavior) and writes no URL hash (the hash belongs to deep links from other pages);
//   - a part with something to fix is red and carries the dot of every other navigation (StatusDot), with the
//     state in words for screen readers;
//   - the row wraps: twelve numbers at 390 px take two lines, never a sideways scroll.
// JumpRow is presentational: the screen passes the ids its parts already have and what each one is called.

import type { MouseEvent } from "react";

import { jumpBehavior } from "./scroll";
import { ReaderOnly, StatusDot, type DotState } from "./WonSection";
import { WON_ATTENTION, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SELECT, WON_SURFACE } from "./tokens";

export interface JumpRowItem {
  /** The DOM id of the part (it carries its own `scroll-margin-top`). */
  target: string;
  /** What is shown: the part's number. */
  mark: string;
  /** What the part is called ("2. stupeň"), for screen readers and the tooltip. */
  name: string;
  /** The part's state, when it has one to say (P2: no dot for "nothing to say"). */
  state?: DotState;
}

const JUMP_ROW_CSS = `
.won-jumps{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;font-family:${WON_FONT}}
.won-jumps__label{font-size:12.5px;color:${WON_MUTED}}
.won-jumps__list{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.won-jumps__link{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-width:28px;height:28px;box-sizing:border-box;padding:0 8px;border-radius:999px;border:1px solid ${WON_LINE};background:${WON_SURFACE};font-size:12.5px;font-weight:650;line-height:1;color:${WON_INK};text-decoration:none}
.won-jumps__link:hover{border-color:${WON_MUTED}}
.won-jumps__link:focus-visible{outline:2px solid ${WON_SELECT};outline-offset:1px}
.won-jumps__link[data-won-jump-state="attention"]{color:${WON_ATTENTION};border-color:${WON_ATTENTION}}
`;

export function JumpRow({ label, items }: { label: string; items: readonly JumpRowItem[] }) {
  const go = (event: MouseEvent<HTMLAnchorElement>, target: string) => {
    // A new tab / window stays the browser's business.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const el = document.getElementById(target);
    if (!el) return;
    event.preventDefault();
    el.scrollIntoView({ block: "start", behavior: jumpBehavior() });
  };
  return (
    <nav className="won-jumps" aria-label={label} data-won-jump-row>
      <style dangerouslySetInnerHTML={{ __html: JUMP_ROW_CSS }} />
      <span className="won-jumps__label" aria-hidden="true">
        {label}
      </span>
      <ol className="won-jumps__list">
        {items.map((item) => (
          <li key={item.target}>
            <a className="won-jumps__link" href={`#${item.target}`} title={item.name} {...(item.state ? { "data-won-jump-state": item.state } : {})} onClick={(event) => go(event, item.target)}>
              {item.state ? <StatusDot state={item.state} /> : null}
              <span aria-hidden="true">{item.mark}</span>
              <ReaderOnly>{item.name}</ReaderOnly>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
