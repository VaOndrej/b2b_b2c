// Renders the outcome of an admin action honestly (§12): saved AND in Shopify,
// saved but not (yet) in Shopify (what did not get through, with "Synchronizovat
// znovu"), refused with the real reason, or "not connected yet" — never a
// silent no-op, never "try again" for something a retry cannot fix. Where one
// action resolves a refusal, the notice carries it (§13a). Field-level errors
// are shown next to their fields. The wording lives in model/result-copy.ts.

import type { ReactNode } from "react";
import { useFetcher } from "react-router";

import { useT } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import { failureCopy, uiText } from "../model/result-copy";
import type { SyncOutcomeView, UiResult } from "../model/types";
import { boolAttr } from "./attrs";

export { failureCopy } from "../model/result-copy";

/** Where "Synchronizovat znovu" posts: the Přehled route action (`intent=resync`). */
export const RESYNC_ACTION = "/app?index";

function Items({ items }: { items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <s-unordered-list>
      {items.map((item, i) => (
        <s-list-item key={`${i}-${item}`}>{item}</s-list-item>
      ))}
    </s-unordered-list>
  );
}

function Titled({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <s-stack direction="block" gap="small-200">
      <s-text type="strong">{title}</s-text>
      <Items items={items} />
    </s-stack>
  );
}

/** "Synchronizovat znovu": resyncs the stored config (Přehled action) and shows what happened. */
export function ResyncButton({ slot, variant = "secondary" }: { slot?: "secondary-actions"; variant?: "primary" | "secondary" | "tertiary" }) {
  const tr = useT();
  const fetcher = useFetcher<UiResult>();
  const busy = fetcher.state !== "idle";
  const button = (
    <s-button
      slot={slot}
      variant={variant}
      loading={boolAttr(busy)}
      disabled={boolAttr(busy)}
      onClick={() => fetcher.submit({ intent: "resync" }, { method: "post", action: RESYNC_ACTION })}
    >
      {tr.t("result.action.resync")}
    </s-button>
  );
  if (!fetcher.data) return button;
  // In a banner the button sits in its actions slot; what the resync did goes into the banner body.
  if (slot) {
    return (
      <>
        {button}
        <Notice result={fetcher.data} />
      </>
    );
  }
  return (
    <s-stack direction="block" gap="small-200">
      {button}
      <Notice result={fetcher.data} />
    </s-stack>
  );
}

function syncHeading(message: string, sync: SyncOutcomeView | undefined): MessageKey {
  if (message === "synced") return "result.synced";
  if (message === "deleted") return sync && !sync.ok ? "result.deletedNotSynced" : "result.deleted";
  if (sync && !sync.ok) return "result.savedNotSynced";
  return sync ? "result.savedSynced" : "result.saved";
}

export function Notice({ result, onReplace }: { result: UiResult | null | undefined; onReplace?: () => void }) {
  const tr = useT();
  const { t } = tr;
  if (!result) return null;
  if (result.ok) {
    if (result.message === "moved" || result.message === "undone") {
      const moved = result.message === "moved";
      const failures = result.failures ?? [];
      return (
        <s-banner
          tone={failures.length > 0 ? "warning" : "success"}
          heading={moved ? tr.tp("result.moved", result.count ?? 1) : t("result.undone")}
        >
          <s-stack direction="block" gap="small-300">
            <Titled title={t(moved ? "result.movedNotes" : "result.undoneNotes")} items={result.notes ?? []} />
            <Titled title={t("result.movedPartly")} items={failures} />
          </s-stack>
        </s-banner>
      );
    }
    const sync = result.sync;
    const fixes = result.fixes ?? [];
    const failed = sync !== undefined && !sync.ok;
    const heading = fixes.length > 0 && !failed ? t("result.savedWithFixes") : t(syncHeading(result.message, sync));
    const warnings = (sync?.warnings ?? []).map((w) => uiText(w, tr));
    const problems = (sync?.problems ?? []).map((p) => uiText(p, tr));
    return (
      <s-banner tone={failed ? "warning" : "success"} heading={heading}>
        <s-stack direction="block" gap="small-300">
          {fixes.length > 0 && failed ? <Titled title={t("result.savedWithFixes")} items={fixes} /> : <Items items={fixes} />}
          <Items items={problems} />
          <Titled title={t("result.syncWarnings")} items={warnings} />
        </s-stack>
        {failed ? <ResyncButton slot="secondary-actions" /> : null}
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
  } else if (copy.action?.replace && onReplace) {
    action = (
      <s-button slot="secondary-actions" onClick={onReplace}>
        {t(copy.action.label)}
      </s-button>
    );
  } else if (copy.action?.resync) {
    action = <ResyncButton slot="secondary-actions" />;
  }
  return (
    <s-banner tone={copy.tone}>
      {t(copy.key, copy.params)}
      {copy.items && copy.items.length > 0 ? <Items items={copy.items} /> : null}
      {action}
    </s-banner>
  );
}
