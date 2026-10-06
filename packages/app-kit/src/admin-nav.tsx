import type { ReactElement } from "react";

export type WonNavItem = {
  /** Route path, e.g. "/app/behavior". */
  to: string;
  /** Menu label shown in the admin sidebar. */
  label: string;
};

/**
 * Unified admin navigation for every Won app.
 *
 * Shopify owns the visual chrome of `ui-nav-menu`, so cross-app consistency
 * comes from a shared *structure*, not styling:
 *
 *  - The app's own name + icon sit at the top of the menu — that is the
 *    per-app identity, and it comes from each app's `shopify.app.toml`
 *    (`name`) and the Partner Dashboard app icon. A merchant running Won
 *    Toasts and Won Stepper side by side sees a different name/icon but the
 *    same menu shape, so they instantly know *which* app they are in and
 *    *how* to move around it.
 *  - The Overview/home link is always first (App Bridge uses it as the app
 *    root via `rel="home"`).
 *  - At most FIVE items follow the home link, in the given order. Related
 *    pages share one item and a sub-navigation on the page (a strip of links
 *    under the page heading; see Won Discounts' `components/shell/SubNav.tsx`).
 *  - Settings is last. The plan ("Plan"/"Tarif") is NOT a menu item: it lives
 *    in Settings. The `/app/plan` route may stay for Shopify's billing return.
 *
 * Every Won app renders this in its `app.tsx`, passing only its own feature
 * pages:
 *
 *   <WonNavMenu
 *     items={[
 *       { to: "/app/behavior", label: "Behavior" },
 *       { to: "/app/settings", label: "Settings" },
 *     ]}
 *   />
 *
 * A localized admin passes `homeLabel` (default "Overview").
 */
export function WonNavMenu({
  items,
  homeLabel = "Overview",
}: {
  items: WonNavItem[];
  /**
   * Label of the home link. Defaults to "Overview"; an app whose admin speaks
   * the merchant's language passes its own (e.g. "Přehled").
   */
  homeLabel?: string;
}): ReactElement {
  return (
    <ui-nav-menu>
      <a href="/app" rel="home">
        {homeLabel}
      </a>
      {items.map((item) => (
        <a key={item.to} href={item.to}>
          {item.label}
        </a>
      ))}
    </ui-nav-menu>
  );
}
