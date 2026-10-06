// A module page as a few tiles and ONE panel at a time (feedback 6 Oct 2026; doctrine §19e): the tiles on top
// say what each part is for and what is set (shell/ModuleTile ViewTile), the panel below holds its sections.
// A panel that is not shown is hidden, never unmounted — its fields still submit (§17d), so a page keeps its one
// form and its one Save.
//
// useView decides which panel is open:
//   1. `initial()` — the page's own rule (what runs first, a result just returned…), again whenever `resetKey` changes;
//   2. a deep link: the URL hash of a section opens the panel that holds it and scrolls to the section;
//   3. a refused save: the first panel that shows an error opens (a hidden error would be a dead end, §13).

import { useEffect, useState, type ReactNode } from "react";

/** Marks a rendered field error for useView (Polaris fields carry their own `error` attribute). */
export const FIELD_ERROR_ATTR = "data-won-field-error";

const ERROR_SELECTOR = `[data-won-view-panel] [error]:not([error=""]), [data-won-view-panel] [${FIELD_ERROR_ATTR}]`;

export function useView<K extends string>(opts: { initial: () => K; hash?: Readonly<Record<string, K>>; resetKey?: unknown }): [K, (view: K) => void] {
  const [view, setView] = useState<K>(opts.initial);
  useEffect(() => {
    setView(opts.initial());
    // A refused save: open the panel that shows the first error (after the fields rendered it).
    const timer = window.setTimeout(() => {
      const panel = document.querySelector(ERROR_SELECTOR)?.closest("[data-won-view-panel]")?.getAttribute("data-won-view-panel");
      if (panel) setView(panel as K);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new result moves the page
  }, [opts.resetKey]);
  useEffect(() => {
    const anchor = window.location.hash.slice(1);
    const target = anchor ? opts.hash?.[anchor] : undefined;
    if (!target) return;
    setView(target);
    const timer = window.setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ block: "start" }), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a deep link is read once
  }, []);
  return [view, setView];
}

export function ViewPanel<K extends string>({ id, view, children }: { id: K; view: K; children: ReactNode }) {
  return (
    <div data-won-view-panel={id} style={{ display: view === id ? "block" : "none" }}>
      <s-stack direction="block" gap="base">
        {children}
      </s-stack>
    </div>
  );
}
