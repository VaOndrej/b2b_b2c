// Renders the outcome of an admin action honestly (§12): saved, refused with the
// real reason, or "not connected yet" — never a silent no-op, never "try again"
// for something a retry cannot fix. Where one action resolves a refusal, the
// notice carries it (§13a). Field-level errors are shown next to their fields.

import type { ReactNode } from "react";

import { useT } from "../../i18n/context";
import type { MessageKey, MessageParams, Translator } from "../../i18n";
import type { UiFailure, UiResult } from "../model/types";

interface FailureCopy {
  key: MessageKey;
  params?: MessageParams;
  /** The one action that resolves it, if there is one. */
  action?: { label: MessageKey; href?: string; reload?: true };
  tone: "info" | "critical" | "warning";
}

export function failureCopy(result: UiFailure, tr: Translator): FailureCopy {
  switch (result.reason) {
    case "not_wired":
      return {
        key: result.what === "move" ? "result.notWired.move" : result.what === "undo" ? "result.notWired.undo" : "result.notWired.tryCart",
        tone: "info",
      };
    case "invalid":
      return { key: "result.invalid", tone: "critical" };
    case "too_many_code_rules":
      return {
        key: "result.tooManyCodeRules",
        params: { limit: result.limit, count: result.count, shopify: result.shopifyLimit },
        action: { label: "result.action.showDiscounts", href: "/app/discounts" },
        tone: "critical",
      };
    case "code_hash_collision":
      return {
        key: "result.codeHashCollision",
        params: { codes: result.codes.map((group) => tr.list(group)).join("; ") },
        action: { label: "result.action.editCodes", href: "#codes" },
        tone: "critical",
      };
    case "newer_schema":
      return { key: "result.newerSchema", action: { label: "result.action.reload", reload: true }, tone: "warning" };
    case "function_config_too_large":
      return {
        key: "result.functionTooLarge",
        params: { bytes: result.bytes, budget: result.budget },
        action: { label: "result.action.showDiscounts", href: "/app/discounts" },
        tone: "critical",
      };
    case "config_too_large":
      return {
        key: "result.configTooLarge",
        params: { bytes: result.bytes, limit: result.limit },
        action: { label: "result.action.showDiscounts", href: "/app/discounts" },
        tone: "critical",
      };
    case "not_found":
      return { key: "result.notFound", action: { label: "result.action.showDiscounts", href: "/app/discounts" }, tone: "critical" };
    case "nothing_selected":
      return { key: "result.nothingSelected", tone: "info" };
    case "bad_request":
      return { key: "result.badRequest", action: { label: "result.action.reload", reload: true }, tone: "critical" };
    case "preview_only":
      return { key: "result.previewOnly", tone: "info" };
    case "error":
    default:
      return { key: "result.error", tone: "critical" };
  }
}

export function Notice({ result }: { result: UiResult | null | undefined }) {
  const tr = useT();
  const { t } = tr;
  if (!result) return null;
  if (result.ok) {
    const fixes = result.fixes ?? [];
    const heading = fixes.length > 0 ? t("result.savedWithFixes") : t(result.message === "deleted" ? "result.deleted" : "result.saved");
    return (
      <s-banner tone="success" heading={heading}>
        {fixes.length > 0 ? (
          <s-unordered-list>
            {fixes.map((fix) => (
              <s-list-item key={fix}>{fix}</s-list-item>
            ))}
          </s-unordered-list>
        ) : null}
      </s-banner>
    );
  }
  const copy = failureCopy(result, tr);
  let action: ReactNode = null;
  if (copy.action?.href) {
    action = (
      <s-button slot="secondary-actions" href={copy.action.href}>
        {t(copy.action.label)}
      </s-button>
    );
  } else if (copy.action?.reload) {
    action = (
      <s-button slot="secondary-actions" onClick={() => window.location.reload()}>
        {t(copy.action.label)}
      </s-button>
    );
  }
  return (
    <s-banner tone={copy.tone}>
      {t(copy.key, copy.params)}
      {action}
    </s-banner>
  );
}
