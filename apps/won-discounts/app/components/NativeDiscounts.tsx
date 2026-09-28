// Shopify discounts that live outside Won (docs/won-discounts/rozhodnuti.md,
// "Nativní slevy Shopify"): always detected, moved with one button, undoable.
// Shared by Přehled (a Move per discount + Move all) and onboarding step 2 (one
// Move button for all of them). The submission is a fetcher to the page's own
// route action (app/lib/integration: moveNative / undoMove through saveAndSync);
// the page language rides along, so the result sentences match the page.
// Every backup with an undo stays listed whatever the detection does (a slow
// Shopify must never hide "Vrátit zpět").

import { useState } from "react";
import { useFetcher } from "react-router";

import { useT } from "../i18n/context";
import type { Translator } from "../i18n";
import { MoveDialog } from "./MoveDialog";
import { formatDateTime } from "./model/signals";
import type { MovedDiscountView, NativeBlockedReason, NativeDiscountView, NativeView, UiResult } from "./model/types";
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
  if (native.state === "loading") return tr.t("overview.native.loading");
  if (native.state === "error") return tr.t("overview.native.error");
  if (native.discounts.length === 0) return tr.t("overview.native.none");
  return `${tr.tp("count.native", native.discounts.length)}. ${tr.t("overview.native.someSuffix")}`;
}

function describeNative(d: NativeDiscountView, tr: Translator): string {
  const kind = d.method === "code" && d.code ? tr.t("overview.native.kind.code", { code: d.code }) : tr.t("overview.native.kind.automatic");
  return [d.summary, kind].filter(Boolean).join(" · ");
}

const DIALOG_ID = "won-move-dialog";

export function NativeDiscountsPanel({
  native,
  mode,
  result,
}: {
  native: NativeView;
  mode: "each" | "all";
  /** A move / undo result the page already has (the section's own fetcher result wins). */
  result?: UiResult | null;
}) {
  const tr = useT();
  if (native.state === "not_wired") return <s-paragraph color="subdued">{tr.t("overview.native.notWiredBody")}</s-paragraph>;
  return <NativeList native={native} mode={mode} result={result ?? null} />;
}

function NativeList({
  native,
  mode,
  result,
}: {
  native: Exclude<NativeView, { state: "not_wired" }>;
  mode: "each" | "all";
  result: UiResult | null;
}) {
  const tr = useT();
  const fetcher = useFetcher<UiResult>();
  const [pending, setPending] = useState<NativeDiscountView[]>([]);
  const discounts = native.state === "ok" ? native.discounts : [];
  const conflicts = native.state === "ok" ? (native.conflicts ?? []) : [];
  const backups = native.moved ?? [];
  const moved = backups.filter((m) => m.state !== "attention");
  const attention = backups.filter((m) => m.state === "attention");
  const movable = discounts.filter((d) => d.movable);
  const busy = fetcher.state !== "idle";

  const submit = (intent: "move" | "undo", values: string[]) => {
    const fd = new FormData();
    fd.append("intent", intent);
    fd.append("locale", tr.locale);
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

  const undoRow = (m: MovedDiscountView) => (
    <WonRow
      key={m.backupId}
      tone={m.state === "attention" ? "attention" : undefined}
      action={
        <s-button variant={m.state === "attention" ? "secondary" : "tertiary"} disabled={boolAttr(busy)} onClick={() => submit("undo", [m.backupId])}>
          {tr.t("overview.native.undo")}
        </s-button>
      }
    >
      <s-text>{m.title}</s-text>
      {m.state === "attention" ? (
        <RowNote tone="attention">{m.note ?? tr.t("overview.native.attention")}</RowNote>
      ) : (
        <RowNote>{tr.t("overview.native.movedAt", { date: formatDateTime(m.movedAt, tr.locale) })}</RowNote>
      )}
    </WonRow>
  );

  return (
    <s-stack direction="block" gap="base">
      <Notice result={fetcher.data ?? result} />
      {native.state === "loading" ? <s-paragraph color="subdued">{tr.t("overview.native.loading")}</s-paragraph> : null}
      {native.state === "error" ? <s-paragraph>{native.message ?? tr.t("overview.native.error")}</s-paragraph> : null}
      {discounts.length > 0 ? (
        <div>
          {discounts.map((d) => (
            <WonRow
              key={d.id}
              action={mode === "each" && d.movable ? moveButton([d], tr.t("overview.native.move")) : undefined}
            >
              <s-text type="strong">{d.title}</s-text>
              <RowNote>{d.movable ? describeNative(d, tr) : (d.reason ?? tr.t(BLOCKED_KEYS[d.blockedReason ?? "other"]))}</RowNote>
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
      {conflicts.length > 0 ? (
        <div>
          <s-text type="strong">{tr.t("overview.native.conflictsTitle")}</s-text>
          {conflicts.map((c, i) => (
            <WonRow key={`${i}-${c.nativeTitle}-${c.ruleName}`} tone="attention">
              <s-text>{c.nativeTitle}</s-text>
              <RowNote tone="attention">{c.message}</RowNote>
            </WonRow>
          ))}
        </div>
      ) : null}
      {attention.length > 0 ? (
        <div>
          <s-text type="strong">{tr.t("overview.native.attentionTitle")}</s-text>
          {attention.map(undoRow)}
        </div>
      ) : null}
      {moved.length > 0 ? (
        <div>
          <s-text type="strong">{tr.t("overview.native.movedTitle")}</s-text>
          {moved.map(undoRow)}
        </div>
      ) : null}
      <MoveDialog id={DIALOG_ID} discounts={pending} onConfirm={() => submit("move", pending.map((d) => d.id))} />
    </s-stack>
  );
}
