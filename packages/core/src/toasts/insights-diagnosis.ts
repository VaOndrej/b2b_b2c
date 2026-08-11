// Golden-platter diagnosis for a configured-but-silent toast (merchant-review
// point 10). We KNOW the app: instead of telling the merchant to "check its
// triggers or targeting" and sending them away, we state the definite cause we
// can derive and, only when there's a real fix to make, link straight to it.
//
// Three cases, in order of certainty:
//  1. Every page is excluded → nothing can run anywhere → Targeting (fixable).
//  2. Nothing has shown ANYWHERE → the config is fine, so the app embed almost
//     certainly isn't live on the theme → point at setup, NOT Targeting.
//  3. Other toasts fire but this one doesn't → its settings are correct; it
//     simply hasn't met its real trigger yet — so we explain that trigger and
//     send them nowhere.

export interface SilentDiagnosis {
  message: string;
  /** A concrete fix to jump to — omitted when there's nothing to "fix". */
  action?: { label: string; href: string };
}

// What each toast type actually waits for. Keeps the "it's set up correctly —
// here's when it fires" message honest and specific per type.
const TRIGGER: Record<string, string> = {
  cart: "It shows the moment a shopper adds, removes or changes something in their cart.",
  "stock.low":
    "It only shows when a product's real stock drops below your threshold — that hasn't happened in the window yet.",
  "cart.activity":
    "It shows once enough shoppers have recently added the same item — the count hasn't been reached yet.",
  "order.summary":
    "It shows once you have real orders inside the counting window.",
  "order.created": "It shows when a real order comes in.",
  countdown: "It shows while its deadline is still in the future.",
  announcement:
    "It shows on normal page views — if it stays silent, double-check it's enabled and not URL-excluded.",
};

const DEFAULT_TRIGGER = "It simply hasn't met its trigger condition yet.";

export function diagnoseSilentType(input: {
  type: string;
  label: string;
  /** Targeting excludes every whole-page type → the app can't run anywhere. */
  allPagesExcluded: boolean;
  /** Whether ANY toast has been shown in the window (across all types). */
  anyToastShown: boolean;
}): SilentDiagnosis {
  const { type, label, allPagesExcluded, anyToastShown } = input;

  if (allPagesExcluded) {
    return {
      message: `${label} can't show because Targeting currently excludes every page. Remove some exclusions to let toasts run.`,
      action: { label: "Fix targeting", href: "/app/targeting" },
    };
  }

  if (!anyToastShown) {
    return {
      message: `${label} — and every other toast — hasn't shown once. Your settings look right, so the app embed probably isn't enabled on your live theme yet.`,
      action: { label: "Turn on the app embed", href: "/app" },
    };
  }

  return {
    message: `${label} is set up correctly. ${TRIGGER[type] ?? DEFAULT_TRIGGER}`,
  };
}
