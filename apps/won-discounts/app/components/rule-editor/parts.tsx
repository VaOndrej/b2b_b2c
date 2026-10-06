// Small building blocks of the rule editor sections.

import type { ReactNode } from "react";

import type { DiscountRule } from "@won/core/discounts/config";

import type { Translator } from "../../i18n";
import { useT } from "../../i18n/context";
import { EDITOR_ANCHOR_ALIASES, type EditorAnchor } from "../model/describe";
import type { RuleFormDefaults } from "../model/rule-form";
import type { CurrencyView } from "../model/types";
import { boolAttr } from "../shell/attrs";
import { WON_ATTENTION, WON_FAINT, WON_FONT, WON_MUTED } from "../shell/tokens";

/** What every section needs from the editor: the live draft, the defaults, the currencies, errors. */
export interface EditorView {
  draft: DiscountRule;
  defaults: RuleFormDefaults;
  /** Market currencies with editable fields. */
  codes: string[];
  /** The same currencies with the markets that sell in them (the preview lists only the targeted ones). */
  currencyViews: CurrencyView[];
  timezone: string | null;
  /** B11: the stored config is read-only — every field and button is disabled, not just Save. */
  readOnly: boolean;
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

/**
 * P3: the quiet marker at the field that fixes a problem — a small dot and one
 * short sentence, drawn BESIDE the field from the live draft (a Polaris field's
 * `error` attribute must not change while the merchant types). Red = the rule
 * does not run (or not everywhere) because of this field; `info` = a fact about
 * the field that needs no fix (a rule scheduled for later).
 */
export function FieldMark({ text, tone = "attention", children }: { text?: string | null; tone?: "attention" | "info"; children?: ReactNode }) {
  if (!text) return null;
  const color = tone === "attention" ? WON_ATTENTION : WON_MUTED;
  return (
    <div data-won-mark={tone} style={{ display: "flex", alignItems: "baseline", gap: 7, fontFamily: WON_FONT, fontSize: 12.5, lineHeight: 1.4, color, marginTop: 4 }}>
      <span aria-hidden="true" style={{ flex: "0 0 auto", width: 7, height: 7, borderRadius: 999, background: tone === "attention" ? WON_ATTENTION : WON_FAINT, transform: "translateY(-1px)" }} />
      <span style={{ minWidth: 0 }}>
        {text}
        {children ? <> {children}</> : null}
      </span>
    </div>
  );
}

/** A deep-link target inside a section (`#target`, `#markets`): an id the hash jump scrolls to. */
export function Anchor({ id, children, hidden = false }: { id: EditorAnchor; children: ReactNode; hidden?: boolean }) {
  return (
    <div id={id} style={{ display: hidden ? "none" : "block", scrollMarginTop: 16 }}>
      {children}
    </div>
  );
}

const FIELDS = "s-number-field, s-text-field, s-text-area, s-date-field";
const CONTROLS = `${FIELDS}, s-checkbox, s-switch, s-button, input[type=radio]`;

/**
 * Jump to an editor anchor (§13c, P3): open a collapsed section around it,
 * scroll to it and focus the field to fill in — the first empty visible field,
 * else the first control. Also the landing of `/app/discounts/<id>#<anchor>`
 * (old `#more` links land on the conditions). False when there is no such anchor.
 */
export function jumpToAnchor(raw: string): boolean {
  if (typeof document === "undefined") return false;
  const id = EDITOR_ANCHOR_ALIASES[raw] ?? raw;
  if (!/^[a-z]+$/.test(id)) return false;
  const el = document.getElementById(id);
  if (!el) return false;
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.tagName !== "SECTION") continue;
    // WonSection's header button (collapsible): the body is hidden, never unmounted.
    const header = node.querySelector<HTMLButtonElement>(':scope > button[aria-expanded="false"]');
    header?.click();
  }
  window.requestAnimationFrame(() => {
    el.scrollIntoView({ block: "start", behavior: "smooth" });
    const visible = (candidate: Element) => (candidate as HTMLElement).offsetParent !== null && !(candidate as { disabled?: boolean }).disabled;
    const fields = [...el.querySelectorAll(FIELDS)].filter(visible);
    const target = fields.find((f) => !(f as unknown as { value?: string }).value) ?? fields[0] ?? [...el.querySelectorAll(CONTROLS)].filter(visible)[0];
    (target as HTMLElement | undefined)?.focus?.({ preventScroll: true });
  });
  return true;
}

/** An in-page link to an editor anchor: the status sentence, a marker's "go to the field". */
export function AnchorLink({ to, children, tone }: { to: EditorAnchor; children: ReactNode; tone?: "attention" }) {
  return (
    <a
      href={`#${to}`}
      onClick={(event) => {
        if (jumpToAnchor(to)) event.preventDefault();
      }}
      style={{ color: tone === "attention" ? WON_ATTENTION : "inherit", textDecoration: "underline", textUnderlineOffset: 2, fontWeight: 600 }}
    >
      {children}
    </a>
  );
}

export function PickerRow({
  label,
  countText,
  onPick,
  unavailable,
  attention,
  disabled = false,
}: {
  label: string;
  /** "3 produkty" — or null when nothing is selected. */
  countText: string | null;
  onPick: () => void;
  unavailable: boolean;
  /** P3: nothing is selected and the rule cannot run without it — the sentence shown in the attention tone. */
  attention?: string;
  disabled?: boolean;
}) {
  const { t } = useT();
  return (
    <s-stack direction="block" gap="small-200">
      <s-stack direction="inline" gap="base" alignItems="center">
        <s-button onClick={onPick} disabled={boolAttr(disabled)}>
          {label}
        </s-button>
        {countText || !attention ? <s-text color="subdued">{countText ?? t("editor.pick.none")}</s-text> : null}
      </s-stack>
      {!countText ? <FieldMark text={attention} /> : null}
      {unavailable ? <s-text color="subdued">{t("editor.pick.unavailable")}</s-text> : null}
    </s-stack>
  );
}
