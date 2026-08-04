import { useEffect } from "react";
import { useActionData } from "react-router";

// After a successful save (action returns `{ saved: true }`), fire the App
// Bridge success toast so every settings page confirms the save the same way.
// Pairs with `data-save-bar`: the save bar clears on submit, this shows "Saved".
export function useSavedToast(message = "Saved") {
  const data = useActionData() as { saved?: boolean } | undefined;

  useEffect(() => {
    if (!data?.saved) return;
    const shopify = (
      globalThis as {
        shopify?: { toast?: { show?: (m: string) => void } };
      }
    ).shopify;
    shopify?.toast?.show?.(message);
  }, [data, message]);
}
