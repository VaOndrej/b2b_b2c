// Wording matrix (doctrine §8b): N events × M languages as a grid, not a flat
// stack. Each row: a per-event ON/OFF toggle, human title (§4c), the event's
// accent swatch and a concrete example; the language is a column header shown
// ONCE. Rows can carry extra inline settings (e.g. milestone threshold) so a
// merchant configures everything in ONE place — no "Advanced" (§7c).

import type { ReactNode } from "react";

import type { ToastMessages, ToastTheme } from "@won/core/toasts/config.types";
import { accentFor } from "@won/core/toasts/presentation";

import { EVENT_META, languageName } from "../lib/labels";
import { WON_FONT } from "../lib/tokens";

export interface RowToggle {
  name: string;
  checked: boolean;
}

export function MessageMatrix({
  theme,
  locales,
  messages,
  toggleFor,
  extraFor,
  referenceLocale,
  wordingCollapsible = false,
}: {
  theme: ToastTheme;
  locales: string[];
  messages: ToastMessages;
  /** Optional per-event ON/OFF switch (rendered in the row header). */
  toggleFor?: (key: string) => RowToggle | null;
  /** Optional extra inline settings shown under a row (e.g. a threshold). */
  extraFor?: (key: string) => ReactNode;
  /** When translating, show the merchant's ACTUAL default copy for this locale as
   *  the reference (falling back to the built-in example) so they're not
   *  translating blind against a placeholder. */
  referenceLocale?: string;
  /** Single-locale on/off view (Toasts): render sexy toggle CARDS with the
   *  wording tucked behind a per-row "Edit wording" disclosure (§9a). The grid
   *  form (translations, multi-locale) is unaffected. */
  wordingCollapsible?: boolean;
}) {
  // §9a + "make the on/off sexy": one card per event — accent stripe, bold title,
  // a concrete example, a prominent switch; the wording field hides behind a small
  // disclosure so the default view is just clean on/off rows.
  if (wordingCollapsible && locales.length === 1) {
    const loc = locales[0];
    return (
      <s-stack direction="block" gap="small-100">
        {EVENT_META.map((ev) => {
          const accent = accentFor(theme, ev.key);
          const toggle = toggleFor?.(ev.key) ?? null;
          const extra = extraFor?.(ev.key) ?? null;
          return (
            <div
              key={ev.key}
              style={{
                fontFamily: WON_FONT,
                border: "1px solid #e3e6ea",
                borderRadius: 12,
                overflow: "hidden",
                background: "#fff",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 14px",
                  borderLeft: `4px solid ${accent}`,
                }}
              >
                <div style={{ flex: "1 1 auto", minWidth: 0 }}>
                  {/* Polaris s-text (not raw divs) so the type size/scale matches
                      the rest of the admin exactly — no hand-picked px. */}
                  <div><s-text type="strong">{ev.title}</s-text></div>
                  <div><s-text color="subdued">e.g. “{ev.example}”</s-text></div>
                </div>
                {toggle ? (
                  <s-switch
                    label={ev.title}
                    labelAccessibilityVisibility="exclusive"
                    name={toggle.name}
                    value="on"
                    checked={toggle.checked}
                  />
                ) : null}
              </div>
              <details style={{ borderTop: "1px dashed #eceff3" }}>
                <summary
                  style={{ cursor: "pointer", padding: "7px 14px", fontSize: 12, color: "#5c6975" }}
                >
                  Edit wording
                </summary>
                <div style={{ padding: "0 14px 12px" }}>
                  <s-text-field
                    label={`${ev.title} wording`}
                    labelAccessibilityVisibility="exclusive"
                    name={`msg_${ev.key}_${loc}`}
                    value={messages[ev.key]?.[loc] ?? ""}
                    placeholder={ev.example}
                  />
                </div>
              </details>
              {extra ? (
                <div style={{ padding: "0 14px 12px", borderTop: "1px dashed #eceff3" }}>{extra}</div>
              ) : null}
            </div>
          );
        })}
      </s-stack>
    );
  }

  const multi = locales.length > 1;
  const gridTemplateColumns = `minmax(200px, 260px) ${locales
    .map(() => "minmax(0, 1fr)")
    .join(" ")}`;

  return (
    <div style={{ display: "grid", gridTemplateColumns, columnGap: 16, rowGap: 14, alignItems: "start" }}>
      {multi ? (
        <>
          <div />
          {locales.map((loc) => (
            <div key={`h-${loc}`} style={{ fontSize: 12, fontWeight: 600, color: "#6b7280", paddingBottom: 2 }}>
              {languageName(loc)}
            </div>
          ))}
        </>
      ) : null}

      {EVENT_META.map((ev) => {
        const accent = accentFor(theme, ev.key);
        const toggle = toggleFor?.(ev.key) ?? null;
        const extra = extraFor?.(ev.key) ?? null;
        const reference = referenceLocale
          ? (messages[ev.key]?.[referenceLocale] ?? "").trim()
          : "";
        return (
          <div key={ev.key} style={{ display: "contents" }}>
            {/* Row header: accent swatch + ON/OFF toggle (or plain title) + example. */}
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start", paddingTop: 6 }}>
              <span
                aria-hidden="true"
                style={{ width: 4, alignSelf: "stretch", minHeight: 34, borderRadius: 4, background: accent, flex: "0 0 auto" }}
              />
              <div style={{ minWidth: 0 }}>
                {toggle ? (
                  <s-switch label={ev.title} name={toggle.name} value="on" checked={toggle.checked} />
                ) : (
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#1a1f24" }}>{ev.title}</div>
                )}
                <div style={{ fontSize: 12, color: "#8892a0" }}>
                  {reference ? `Your default: “${reference}”` : `e.g. “${ev.example}”`}
                </div>
              </div>
            </div>

            {locales.map((loc) => (
              <s-text-field
                key={`${ev.key}-${loc}`}
                label={`${ev.title} — ${languageName(loc)}`}
                labelAccessibilityVisibility="exclusive"
                name={`msg_${ev.key}_${loc}`}
                value={messages[ev.key]?.[loc] ?? ""}
                placeholder={ev.example}
              />
            ))}

            {extra ? (
              <div style={{ gridColumn: "1 / -1", paddingLeft: 14, paddingTop: 2 }}>{extra}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
