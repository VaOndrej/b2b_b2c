// The wording of an admin action's outcome (§12): each refusal has its own
// sentence and, where one action resolves it, that action (§13a) — never a
// generic "try again" for something a retry cannot fix. Pure (no React): the
// Notice renders it, the server words native-move refusals with it, tests pin it.

import type { MessageKey, MessageParams, Translator } from "../../i18n";
import type { UiFailure, UiText } from "./types";

export interface FailureCopy {
  key: MessageKey;
  params?: MessageParams;
  /** Sentences listed under the headline (what did not reach Shopify, why a move failed). */
  items?: string[];
  /** The one action that resolves it, if there is one. */
  action?: {
    label: MessageKey;
    href?: string;
    reload?: true;
    /** Re-submit the same form, confirming the replacement of an unreadable stored config. */
    replace?: true;
    /** "Synchronizovat znovu" (the Přehled action). */
    resync?: true;
  };
  tone: "info" | "critical" | "warning";
}

/** A server-built sentence in the page's language. */
export function uiText(text: UiText, tr: Translator): string {
  return tr.t(text.key, text.params);
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
    case "unreadable_config":
      return {
        key: "result.unreadableConfig",
        action: { label: "result.action.replaceUnreadable", replace: true },
        tone: "warning",
      };
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
    case "base_changed":
      return { key: "result.baseChanged", action: { label: "result.action.reload", reload: true }, tone: "warning" };
    case "busy":
      return { key: "result.busy", tone: "warning" };
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
    case "native_failed":
      return {
        key: result.op === "move" ? "result.nativeFailed.move" : "result.nativeFailed.undo",
        items: result.messages,
        tone: "critical",
      };
    case "sync_failed":
      return {
        key: "result.syncFailed",
        items: result.problems.map((problem) => uiText(problem, tr)),
        action: { label: "result.action.resync", resync: true },
        tone: "warning",
      };
    case "prices_unavailable":
      return {
        key: "result.pricesUnavailable",
        params: { currency: result.currency, products: tr.list(result.products) },
        tone: "critical",
      };
    case "shopify_unavailable":
      return {
        key: "result.shopifyUnavailable",
        params: { detail: result.detail || tr.t("result.noDetail") },
        tone: "critical",
      };
    case "error":
    default:
      return { key: "result.error", tone: "critical" };
  }
}
