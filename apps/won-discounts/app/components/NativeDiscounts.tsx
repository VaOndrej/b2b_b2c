// Shopify discounts that live outside Won (docs/won-discounts/rozhodnuti.md,
// "Nativní slevy Shopify"): always detected, moved with one button, undoable.
// Shared by Přehled (a Move per discount + Move all) and onboarding step 2 (one
// Move button for all of them). The submission is a fetcher to the page's own
// route action, which calls the moveNative/undoMove seam (app/lib/ui-actions).

import { useState } from "react";
import { useFetcher } from "react-router";

import { formatDate } from "@won/core/discounts/describe";

import { useT } from "../i18n/context";
import type { Translator } from "../i18n";
import { MoveDialog } from "./MoveDialog";
import type { NativeBlockedReason, NativeDiscountView, NativeView, UiResult } from "./model/types";
import { boolAttr } from "./shell/attrs";
import { Notice } from "./shell/Notice";
import { RowNote, WonRow } from "./shell/WonSection";

const BLOCKED_KEYS: Record<NativeBlockedReason, "overview.native.blocked.bxgy" | "overview.native.blocked.app" | "overview.native.blocked.other"> = {
  bxgy: "overview.native.blocked.bxgy",
  app: "overview.native.blocked.app",
  other: "overview.native.blocked.other",
};

/** Section state line (§17): "Zatím nezkontrolováno" / "Žádné…" / "3 slevy mimo Won. Engine s nimi nepočítá." */
export function nativeSummary(native: NativeView | undefined, tr: Translator): string {
  if (!native || native.state === "not_wired") return tr.t("overview.native.notWired");
  if (native.state === "error") return tr.t("overview.native.error");
  if (native.discounts.length === 0) return tr.t("overview.native.none");
  return `${tr.tp("count.native", native.discounts.length)}. ${tr.t("overview.native.someSuffix")}`;
}

function describeNative(d: NativeDiscountView, tr: Translator): string {
  const kind = d.method === "code" && d.code ? tr.t("overview.native.kind.code", { code: d.code }) : tr.t("overview.native.kind.automatic");
  return [d.summary, kind].filter(Boolean).join(" · ");
}

const DIALOG_ID = "won-move-dialog";

export function NativeDiscountsPanel({ native, mode }: { native: NativeView; mode: "each" | "all" }) {
  const tr = useT();
  if (native.state === "not_wired") return <s-paragraph color="subdued">{tr.t("overview.native.notWiredBody")}</s-paragraph>;
  if (native.state === "error") return <s-paragraph>{tr.t("overview.native.error")}</s-paragraph>;
  return <NativeList native={native} mode={mode} />;
}

function NativeList({ native, mode }: { native: Extract<NativeView, { state: "ok" }>; mode: "each" | "all" }) {
  const tr = useT();
  const fetcher = useFetcher<UiResult>();
  const [pending, setPending] = useState<NativeDiscountView[]>([]);
  const movable = native.discounts.filter((d) => d.movable);
  const busy = fetcher.state !== "idle";

  const submit = (intent: "move" | "undo", values: string[]) => {
    const fd = new FormData();
    fd.append("intent", intent);
    for (const v of values) fd.append(intent === "move" ? "nativeId" : "backupId", v);
    fetcher.submit(fd, { method: "post" });
  };

  const moveButton = (items: NativeDiscountView[], label: string, primary = false) => (
    <s-button
      variant={primary ? "primary" : "secondary"}
      commandFor={DIALOG_ID}
      command="--show"
      disabled={boolAttr(busy)}
      onClick={() => setPending(items)}
    >
      {label}
    </s-button>
  );

  return (
    <s-stack direction="block" gap="base">
      <Notice result={fetcher.data} />
      {native.discounts.length > 0 ? (
        <div>
          {native.discounts.map((d) => (
            <WonRow
              key={d.id}
              action={mode === "each" && d.movable ? moveButton([d], tr.t("overview.native.move")) : undefined}
            >
              <s-text type="strong">{d.title}</s-text>
              <RowNote>{d.movable ? describeNative(d, tr) : tr.t(BLOCKED_KEYS[d.blockedReason ?? "other"])}</RowNote>
            </WonRow>
          ))}
        </div>
      ) : null}
      {mode === "each" && movable.length >= 2 ? (
        <div>{moveButton(movable, tr.t("overview.native.moveAll", { n: movable.length }))}</div>
      ) : null}
      {mode === "all" && movable.length > 0 ? (
        <div>{moveButton(movable, tr.t("onboarding.native.moveAll", { n: movable.length }), true)}</div>
      ) : null}
      {native.moved.length > 0 ? (
        <div>
          <s-text type="strong">{tr.t("overview.native.movedTitle")}</s-text>
          {native.moved.map((m) => (
            <WonRow
              key={m.backupId}
              action={
                <s-button variant="tertiary" disabled={boolAttr(busy)} onClick={() => submit("undo", [m.backupId])}>
                  {tr.t("overview.native.undo")}
                </s-button>
              }
            >
              <s-text>{m.title}</s-text>
              <RowNote>{tr.t("overview.native.movedAt", { date: formatDate(m.movedAt.slice(0, 10), tr.locale) })}</RowNote>
            </WonRow>
          ))}
        </div>
      ) : null}
      <MoveDialog id={DIALOG_ID} discounts={pending} onConfirm={() => submit("move", pending.map((d) => d.id))} />
    </s-stack>
  );
}
