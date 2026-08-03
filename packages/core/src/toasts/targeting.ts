// Targeting (Pro) — decide whether toasts should run in the current storefront
// context. Pure predicate; the storefront supplies the context it can observe
// (page type, device), the admin configures the rules.

export type PageType =
  | "product"
  | "collection"
  | "cart"
  | "home"
  | "search"
  | "other";

export type DeviceTarget = "both" | "mobile" | "desktop";
export type CustomerTarget = "both" | "guest" | "logged-in";

export interface ToastTargeting {
  /** Allowed page types; empty = all pages. */
  pages: PageType[];
  device: DeviceTarget;
  customerState: CustomerTarget;
}

export interface TargetingContext {
  pageType: PageType;
  isMobile: boolean;
  /** undefined when the storefront can't tell (then customerState is ignored). */
  isLoggedIn?: boolean;
}

export const DEFAULT_TARGETING: ToastTargeting = {
  pages: [],
  device: "both",
  customerState: "both",
};

export function matchesTargeting(
  ctx: TargetingContext,
  targeting: ToastTargeting,
): boolean {
  if (targeting.pages.length > 0 && !targeting.pages.includes(ctx.pageType)) {
    return false;
  }
  if (targeting.device === "mobile" && !ctx.isMobile) return false;
  if (targeting.device === "desktop" && ctx.isMobile) return false;
  if (targeting.customerState !== "both" && ctx.isLoggedIn !== undefined) {
    const wantLoggedIn = targeting.customerState === "logged-in";
    if (ctx.isLoggedIn !== wantLoggedIn) return false;
  }
  return true;
}
