// The sub-navigation of a group of pages (P1: the Shopify sidebar has at most five
// items, related pages share one item and this strip). Polaris web components have
// no tabs element, so this is a small strip of links:
//   - a <nav> with a label, the current page marked with aria-current="page";
//   - React Router navigation (the same client-side router the `s-link href`
//     navigations end in), so it works inside the embedded admin and in the dev
//     harness; with unsaved changes App Bridge asks first (leaveConfirmation);
//   - one row, scrolls sideways on a narrow screen (390 px), never wraps;
//   - no URL hash (WonSection anchors own it).
//   - an item may carry its module's state: a dot before the label (green runs, red
//     needs attention, grey does not run — the colours and words of StatusPill), so
//     the state of every page is seen from any of them.
// SubNav is presentational and knows nothing about discounts; DiscountsSubNav is
// the one for "Slevy". It reads the onboarding goals (the order) and the modules'
// states from DiscountNav, so a screen renders it with one line and no new props.
// The embedded layout (app/routes/app.tsx) provides them from its loader, the dev
// harness from its fixtures; with no provider the default order applies, no dots.

import { createContext, useContext, useEffect, useRef, type MouseEvent } from "react";
import { useNavigate } from "react-router";

import { useT } from "../../i18n/context";
import { discountSubNavItems, NO_DISCOUNT_NAV, type DiscountNavData, type DiscountPage, type SubNavItem } from "../model/modules";
import { PlanBadge } from "./PlanBadge";
import { StatusDot } from "./WonSection";
import { WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SELECT } from "./tokens";

/** The order and the states of the pages under "Slevy", for every screen below the provider. */
export const DiscountNav = createContext<DiscountNavData>(NO_DISCOUNT_NAV);

interface SaveBarApi {
  leaveConfirmation?: () => Promise<void>;
}

/** Resolves when it is fine to leave the page: at once without a save bar, after the merchant's answer with one. */
async function confirmLeave(): Promise<void> {
  const saveBar = (globalThis as { shopify?: { saveBar?: SaveBarApi } }).shopify?.saveBar;
  if (typeof saveBar?.leaveConfirmation !== "function") return;
  try {
    await saveBar.leaveConfirmation();
  } catch {
    // App Bridge could not ask: leaving is still better than a dead link.
  }
}

export interface SubNavProps {
  /** What the strip navigates (read by screen readers). */
  label: string;
  items: readonly SubNavItem[];
  /** The key of the current page. */
  active: string;
}

export function SubNav({ label, items, active }: SubNavProps) {
  const navigate = useNavigate();
  // On a narrow screen the current item may sit outside the strip: bring it into view (sideways only).
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const list = listRef.current;
    const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !current) return;
    const overflow = current.offsetLeft + current.offsetWidth - (list.scrollLeft + list.clientWidth);
    if (overflow > 0) list.scrollLeft += overflow;
    else if (current.offsetLeft < list.scrollLeft) list.scrollLeft = current.offsetLeft;
  }, [active]);
  const go = (event: MouseEvent<HTMLAnchorElement>, to: string, current: boolean) => {
    // A new tab / window stays the browser's business.
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (current) return;
    void confirmLeave().then(() => navigate(to));
  };

  return (
    <nav aria-label={label} data-won-subnav style={{ fontFamily: WON_FONT, borderBottom: `1px solid ${WON_LINE}`, marginBottom: 16 }}>
      <ul
        ref={listRef}
        style={{
          position: "relative",
          display: "flex",
          flexWrap: "nowrap",
          gap: 4,
          margin: 0,
          padding: 0,
          listStyle: "none",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          scrollbarWidth: "none",
        }}
      >
        {items.map((item) => {
          const current = item.key === active;
          return (
            <li key={item.key} style={{ flex: "0 0 auto" }}>
              <a
                href={item.to}
                aria-current={current ? "page" : undefined}
                data-won-subnav-item={item.key}
                onClick={(event) => go(event, item.to, current)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 12px",
                  // The active line sits on the strip's own bottom line.
                  marginBottom: -1,
                  borderBottom: `2px solid ${current ? WON_SELECT : "transparent"}`,
                  fontSize: 13,
                  fontWeight: current ? 650 : 500,
                  lineHeight: 1.4,
                  whiteSpace: "nowrap",
                  textDecoration: "none",
                  color: current ? WON_INK : WON_MUTED,
                }}
              >
                {item.state ? <StatusDot state={item.state} /> : null}
                {item.label}
                {item.pro ? <PlanBadge tier="pro" /> : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** The strip on the five pages of "Slevy": Slevy a kódy first, then the modules in the order of the onboarding goals. */
export function DiscountsSubNav({ active }: { active: DiscountPage }) {
  const { t, locale } = useT();
  const { goals, states } = useContext(DiscountNav);
  return <SubNav label={t("nav.discountsGroup")} items={discountSubNavItems(locale, goals, states)} active={active} />;
}
