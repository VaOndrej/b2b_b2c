// Small building blocks of the rule editor sections.

import type { ReactNode } from "react";

import type { DiscountRule } from "@won/core/discounts/config";

import type { Translator } from "../../i18n";
import { useT } from "../../i18n/context";
import type { RuleFormDefaults } from "../model/rule-form";
import { WON_ATTENTION, WON_FONT } from "../shell/tokens";

/** What every section needs from the editor: the live draft, the defaults, the currencies, errors. */
export interface EditorView {
  draft: DiscountRule;
  defaults: RuleFormDefaults;
  /** Market currencies with editable fields. */
  codes: string[];
  timezone: string | null;
  errorFor: (field: string) => string | undefined;
  tr: Translator;
}

/** Hidden, never unmounted: the fields keep submitting (§17d). */
export function Shown({ when, children }: { when: boolean; children: ReactNode }) {
  return <div style={{ display: when ? "block" : "none" }}>{children}</div>;
}

/** Per-currency fields side by side on desktop, stacked on a phone. */
export function FieldGrid({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 180px), 1fr))", gap: 12 }}>
      {children}
    </div>
  );
}

export function FieldMessage({ text }: { text?: string }) {
  if (!text) return null;
  return <div style={{ color: WON_ATTENTION, fontSize: 12.5, fontFamily: WON_FONT }}>{text}</div>;
}

export function PickerRow({
  label,
  countText,
  onPick,
  unavailable,
}: {
  label: string;
  /** "3 produkty" — or null when nothing is selected. */
  countText: string | null;
  onPick: () => void;
  unavailable: boolean;
}) {
  const { t } = useT();
  return (
    <s-stack direction="block" gap="small-200">
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-button onClick={onPick}>{label}</s-button>
        <s-text color="subdued">{countText ?? t("editor.pick.none")}</s-text>
      </s-stack>
      {unavailable ? <s-text color="subdued">{t("editor.pick.unavailable")}</s-text> : null}
    </s-stack>
  );
}
