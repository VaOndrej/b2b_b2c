// The in-page navigation of a long page (Nastavení): the list of its sections next
// to them, one click away from any of them.
//   - a <nav> with a label; the section in view is marked with aria-current="location";
//   - wide screen: a column left of the sections that stays in view while the page
//     scrolls; narrow screen (390 px): one row above them that stays at the top and
//     scrolls sideways, never wraps;
//   - the links are real `#anchor` links (WonSection anchors, or any element id), so
//     they work before hydration; with JS the jump is smooth and lands under the row,
//     and a collapsed section opens first (a jump to a closed header would be a dead end);
//   - no URL hash is written (SubNav: the hash belongs to deep links from other pages);
//   - a section that has a state may show it as a dot before its name (StatusDot: the
//     pill's colours and words) — a section without a state has none (P2).
// SectionNav is presentational and knows nothing about discounts: the screen passes
// the anchors and the titles its sections already have.

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";

import { jumpBehavior } from "./scroll";
import { openSectionsAround, StatusDot, type DotState } from "./WonSection";
import { WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SELECT, WON_SURFACE } from "./tokens";

export interface SectionNavItem {
  /** The DOM id of the section (WonSection `anchor`). */
  anchor: string;
  label: string;
  /** The section's state, when it has one (the section's own facts: the screen passes what its header says). */
  state?: DotState;
}

/** From this width the navigation is a column; below it a row above the sections. */
const WIDE = "(min-width: 900px)";
/** The air between the top of the view (or the row) and the section a click lands on. */
const GAP = 16;

const SECTION_NAV_CSS = `
.won-jump{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-items:start}
.won-jump__body{min-width:0}
.won-jump__nav{position:sticky;top:0;z-index:2;font-family:${WON_FONT};margin:0 -4px;padding:8px 4px;background:rgba(241,241,241,.92);backdrop-filter:blur(6px)}
.won-jump__title{display:none;margin:0 0 8px 14px;font-size:12px;font-weight:600;color:${WON_MUTED}}
.won-jump__list{display:flex;flex-wrap:nowrap;gap:4px;margin:0;padding:0;list-style:none;overflow-x:auto;scrollbar-width:none}
.won-jump__link{display:flex;align-items:flex-start;gap:6px;padding:6px 10px;border-radius:8px;font-size:13px;line-height:1.3;color:${WON_MUTED};text-decoration:none;white-space:nowrap}
.won-jump__dot{display:inline-flex;align-items:center;height:1.3em;flex:0 0 auto}
.won-jump__link:hover{color:${WON_INK};background:rgba(17,20,24,.05)}
.won-jump__link:focus-visible{outline:2px solid ${WON_SELECT};outline-offset:1px}
.won-jump__link[aria-current]{color:${WON_INK};font-weight:650;background:${WON_SURFACE};box-shadow:inset 0 0 0 1px ${WON_LINE}}
@media ${WIDE}{
.won-jump{grid-template-columns:184px minmax(0,1fr);gap:24px}
.won-jump__nav{top:${GAP}px;margin:0;padding:0;background:none;backdrop-filter:none}
.won-jump__title{display:block}
.won-jump__list{flex-direction:column;gap:2px;overflow:visible;border-left:1px solid ${WON_LINE}}
.won-jump__link{white-space:normal;margin-left:-1px;padding:6px 12px;border-left:2px solid transparent;border-radius:0 8px 8px 0}
.won-jump__link[aria-current]{background:none;box-shadow:none;border-left-color:${WON_SELECT}}
}
`;

export interface SectionNavProps {
  /** What the list is (the caption of the column, read by screen readers). */
  label: string;
  /** The sections, in the page's order. Their states may change while the page is open (a live form). */
  items: readonly SectionNavItem[];
  /** The sections themselves. */
  children: ReactNode;
}

export function SectionNav({ label, items, children }: SectionNavProps) {
  const [active, setActive] = useState(items[0]?.anchor ?? "");
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // While a click's own scroll runs, the clicked item stays marked (the timer id; 0 = free).
  const lock = useRef(0);
  // A jump that waits for a section it just opened to be laid out (the frame id; 0 = none).
  const jump = useRef(0);
  const anchors = items.map((item) => item.anchor).join("|");

  // How far under the top of the view a section starts: under the row on a narrow screen.
  const offset = () => {
    const nav = navRef.current;
    const row = nav !== null && !window.matchMedia(WIDE).matches;
    return (row ? nav.offsetHeight : 0) + GAP;
  };

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      if (lock.current) return;
      const present = anchors.split("|").filter((anchor) => document.getElementById(anchor));
      if (present.length === 0) return;
      const line = offset() + 8;
      let current = present[0];
      for (const anchor of present) {
        if (document.getElementById(anchor)!.getBoundingClientRect().top <= line) current = anchor;
      }
      // The last sections may never reach the top: at the end of the page the last one is the one in view.
      if (window.scrollY > 0 && window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = present[present.length - 1];
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(lock.current);
      lock.current = 0;
      window.cancelAnimationFrame(jump.current);
      jump.current = 0;
    };
  }, [anchors]);

  // In the row the current item may sit outside the strip: bring it into view (sideways only).
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>("[aria-current]");
    if (!list || !current || list.scrollWidth <= list.clientWidth) return;
    const left = current.offsetLeft - list.offsetLeft;
    const overflow = left + current.offsetWidth - (list.scrollLeft + list.clientWidth);
    if (overflow > 0) list.scrollLeft += overflow;
    else if (left < list.scrollLeft) list.scrollLeft = left;
  }, [active]);

  const go = (event: MouseEvent<HTMLAnchorElement>, anchor: string) => {
    // A new tab / window stays the browser's business.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const el = document.getElementById(anchor);
    if (!el) return;
    event.preventDefault();
    setActive(anchor);
    window.clearTimeout(lock.current);
    lock.current = window.setTimeout(() => {
      lock.current = 0;
    }, 900);
    const behavior = jumpBehavior();
    const scroll = () => {
      jump.current = 0;
      window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - offset(), behavior });
    };
    window.cancelAnimationFrame(jump.current);
    // A section that was collapsed makes the page taller only after React has rendered its body: scrolling now
    // would stop at the old end of the page. Everything else scrolls at once.
    if (openSectionsAround(el)) jump.current = window.requestAnimationFrame(scroll);
    else scroll();
  };

  return (
    <div className="won-jump">
      <style dangerouslySetInnerHTML={{ __html: SECTION_NAV_CSS }} />
      <nav ref={navRef} className="won-jump__nav" aria-label={label} data-won-section-nav>
        <p className="won-jump__title" aria-hidden="true">
          {label}
        </p>
        <ul ref={listRef} className="won-jump__list">
          {items.map((item) => (
            <li key={item.anchor} style={{ flex: "0 0 auto" }}>
              <a className="won-jump__link" href={`#${item.anchor}`} aria-current={item.anchor === active ? "location" : undefined} onClick={(event) => go(event, item.anchor)}>
                {item.state ? (
                  <span className="won-jump__dot">
                    <StatusDot state={item.state} />
                  </span>
                ) : null}
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="won-jump__body">{children}</div>
    </div>
  );
}
