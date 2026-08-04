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
 *  - Feature pages follow in the given order; billing/"Plan" is conventionally
 *    last.
 *
 * Every Won app renders this in its `app.tsx`, passing only its own feature
 * pages:
 *
 *   <WonNavMenu
 *     items={[
 *       { to: "/app/behavior", label: "Behavior" },
 *       { to: "/app/plan", label: "Plan" },
 *     ]}
 *   />
 */
export function WonNavMenu({ items }: { items: WonNavItem[] }): ReactElement {
  return (
    <ui-nav-menu>
      <a href="/app" rel="home">
        Overview
      </a>
      {items.map((item) => (
        <a key={item.to} href={item.to}>
          {item.label}
        </a>
      ))}
    </ui-nav-menu>
  );
}
