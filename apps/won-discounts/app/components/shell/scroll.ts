// How a jump inside a page moves: smoothly, unless the system asks for less motion. One answer for the list
// "Na této stránce" (SectionNav), the row of numbers (JumpRow) and the rule editor's deep links.

import { useEffect, useState, type KeyboardEvent } from "react";

import { openSectionsAround } from "./WonSection";

export function jumpBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** The link attributes of a jump inside the page: a real `#anchor` link, or its keyboard twin without `href`. */
export interface JumpLinkProps {
  href?: string;
  role?: "link";
  tabIndex?: 0;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/**
 * The link attributes of a jump inside the page. Before hydration and outside the Shopify admin it is a real
 * `#anchor` link (it works without JS). In the embedded admin App Bridge takes every click on an element with
 * `href` for leaving the page: with unsaved changes it stops the click before React sees it and asks about the
 * changes. A jump leaves nothing, so there the link has no `href` — it stays a link for the keyboard and for
 * screen readers (role, tab stop, Enter), and the save bar keeps guarding every real navigation.
 */
export function useJumpLink(anchor: string): JumpLinkProps {
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => {
    setEmbedded((globalThis as { shopify?: unknown }).shopify !== undefined);
  }, []);
  // With `href` Enter is the browser's own click.
  if (!embedded) return { href: `#${anchor}`, onKeyDown: () => {} };
  return {
    role: "link",
    tabIndex: 0,
    onKeyDown: (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      event.currentTarget.click();
    },
  };
}

/**
 * Scroll to a section of the page after the click's own render (a view panel the click just opened is laid
 * out by then); a collapsed section around it opens first. No URL hash is written.
 */
export function jumpToId(id: string): void {
  window.requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const scroll = () => el.scrollIntoView({ block: "start", behavior: jumpBehavior() });
    if (openSectionsAround(el)) window.requestAnimationFrame(scroll);
    else scroll();
  });
}

/**
 * A Polaris link or button (`s-link`, `s-button`) that jumps inside the page: `href` as in useJumpLink (none in
 * the embedded admin — App Bridge reads `href` on these elements too), and a click that runs `before` (open the
 * view that holds the section) and scrolls there itself.
 */
export function usePolarisJump(anchor: string, before?: () => void): { href?: string; onClick: (event: { preventDefault(): void }) => void } {
  const { href } = useJumpLink(anchor);
  return {
    href,
    onClick: (event) => {
      event.preventDefault();
      before?.();
      jumpToId(anchor);
    },
  };
}
