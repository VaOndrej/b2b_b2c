import { useEffect } from "react";
import { useActionData } from "react-router";

// After a save, confirm the outcome the same way on every settings page:
//   - success (`{ saved: true }`)  → App Bridge success toast ("Saved")
//   - failure (`{ saved: false }`) → App Bridge error toast (the friendly message)
// Pairs with `data-save-bar`: the save bar clears on submit, this shows the result.
// A failed save NEVER white-screens (see persist-config.server); the page stays
// usable and the merchant can retry. Returns the error message so a page can also
// render an inline banner if it wants a persistent notice.
export function useSavedToast(message = "Saved"): string | undefined {
  const data = useActionData() as
    | { saved?: boolean; error?: string }
    | undefined;

  const failed = data?.saved === false;
  const error = failed
    ? data?.error ?? "We couldn't save your changes. Please try again."
    : undefined;

  useEffect(() => {
    const shopify = (
      globalThis as {
        shopify?: {
          toast?: { show?: (m: string, o?: { isError?: boolean }) => void };
        };
      }
    ).shopify;
    if (data?.saved === true) {
      shopify?.toast?.show?.(message);
    } else if (failed) {
      shopify?.toast?.show?.(error as string, { isError: true });
    }
  }, [data, message, failed, error]);

  return error;
}
