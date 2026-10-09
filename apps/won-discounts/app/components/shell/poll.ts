// A page that shows work running in the background (the purchase costs being read) reads its data again while
// that work runs, so "0 z 51" moves and ends by itself instead of standing until the merchant reloads the page.
// Nothing is read while the tab is hidden or while a load / a save is already under way.

import { useContext, useEffect } from "react";
import { UNSAFE_DataRouterContext } from "react-router";

/** Re-run the route's loaders every `ms` while `active`. Outside a data router (a screen rendered alone) it does nothing. */
export function usePollWhile(active: boolean, ms = 2500): void {
  const router = useContext(UNSAFE_DataRouterContext)?.router;
  useEffect(() => {
    if (!active || !router) return;
    const read = () => {
      if (document.visibilityState !== "visible") return;
      if (router.state.revalidation !== "idle" || router.state.navigation.state !== "idle") return;
      void router.revalidate();
    };
    const timer = window.setInterval(read, ms);
    // Back in the tab: read at once, not after the rest of the interval.
    document.addEventListener("visibilitychange", read);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", read);
    };
  }, [active, router, ms]);
}
