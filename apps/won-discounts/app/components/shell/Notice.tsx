// Renders the outcome of an admin action honestly (§12): saved, refused with a
// reason, or "not connected yet" — never a silent no-op. Messages are i18n keys
// resolved here; field-level errors are shown next to their fields by the screen.

import { useT } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import type { UiResult } from "../model/types";

function failureKey(result: Exclude<UiResult, { ok: true }>): MessageKey {
  switch (result.reason) {
    case "not_wired":
      return result.what === "move"
        ? "result.notWired.move"
        : result.what === "undo"
          ? "result.notWired.undo"
          : "result.notWired.tryCart";
    case "invalid":
      return "result.invalid";
    case "newer_schema":
      return "result.newerSchema";
    case "function_config_too_large":
      return "result.functionTooLarge";
    case "config_too_large":
      return "result.configTooLarge";
    case "not_found":
      return "result.notFound";
    case "preview_only":
      return "result.previewOnly";
    case "error":
    default:
      return "result.error";
  }
}

export function Notice({ result }: { result: UiResult | null | undefined }) {
  const { t } = useT();
  if (!result) return null;
  if (result.ok) {
    const heading = result.fixes && result.fixes.length > 0 ? t("result.savedWithFixes") : t(result.message === "deleted" ? "result.deleted" : "result.saved");
    return (
      <s-banner tone="success" heading={heading}>
        {result.fixes && result.fixes.length > 0 ? (
          <s-unordered-list>
            {result.fixes.map((fix) => (
              <s-list-item key={fix}>{fix}</s-list-item>
            ))}
          </s-unordered-list>
        ) : null}
      </s-banner>
    );
  }
  let params: Record<string, number> | undefined;
  if (result.reason === "function_config_too_large") params = { bytes: result.bytes, budget: result.budget };
  else if (result.reason === "config_too_large") params = { bytes: result.bytes, limit: result.limit };
  const tone = result.reason === "not_wired" || result.reason === "preview_only" ? "info" : "critical";
  return <s-banner tone={tone}>{t(failureKey(result), params)}</s-banner>;
}
