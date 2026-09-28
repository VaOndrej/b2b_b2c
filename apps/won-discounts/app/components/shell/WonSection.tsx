// The ONE section shell for the Won Discounts admin (doctrine §17 + A7), copied
// from Won Toasts and adapted (localized state pill, discount glyphs, a wrapping
// aside, deep-link anchors). Every screen draws its sections with WonSection and
// the groups inside them with WonBlock; a visual difference between two sections
// is a bug, not a styling choice.
//
// A section has three fixed slots before its body:
//   1. IDENTITY — a neutral glyph + the title.
//   2. STATE    — one line of the current configuration in human words, from the
//                 shared formatters (model/describe.ts, §17a), plus Live/Off or
//                 the Pro marker. Readable without interacting (§11d).
//   3. PROOF    — optional consequence / mini preview (§10), or an `aside`.
//
// Colour discipline (§11a, §17e): the glyph is NEUTRAL. Blue = selected, amber =
// Pro, green = live, red = needs attention; a per-section hue would invent a
// fifth meaning.
//
// Collapsing NEVER unmounts the body: hidden fields must still submit (§17d).

import { useEffect, useId, useState, type CSSProperties, type ReactNode } from "react";

import { useT } from "../../i18n/context";
import { needsAttention, statusLabel, type RuleStatus } from "../model/rule-status";
import { PlanBadge } from "./PlanBadge";
import {
  WON_AMBER,
  WON_ATTENTION,
  WON_CARD_SHADOW,
  WON_FAINT,
  WON_FONT,
  WON_INK,
  WON_LINE,
  WON_LIVE,
  WON_MUTED,
  WON_SURFACE,
  WON_WASH,
} from "./tokens";

export type SectionGlyphName =
  | "tag"
  | "code"
  | "cart"
  | "store"
  | "move"
  | "alert"
  | "calendar"
  | "layers"
  | "spark"
  | "receipt"
  | "target"
  | "sliders"
  | "plan"
  | "check";

/** Small neutral line glyphs: identity, not meaning (§17e). */
function Glyph({ name }: { name: SectionGlyphName }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "code":
      return (
        <svg {...common}>
          <path d="M9 8l-5 4 5 4" />
          <path d="M15 8l5 4-5 4" />
        </svg>
      );
    case "cart":
      return (
        <svg {...common}>
          <path d="M3 4h2l2.2 10.5a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6" />
          <circle cx="9.5" cy="19.5" r="1.2" />
          <circle cx="17" cy="19.5" r="1.2" />
        </svg>
      );
    case "store":
      return (
        <svg {...common}>
          <path d="M4 9l1.5-5h13L20 9" />
          <path d="M4 9h16v2a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 14a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 11z" />
          <path d="M5.5 13.5V20h13v-6.5" />
        </svg>
      );
    case "move":
      return (
        <svg {...common}>
          <path d="M4 12h13" />
          <path d="M13 7l5 5-5 5" />
          <path d="M20 5v14" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 4l9 16H3z" />
          <path d="M12 10v4" />
          <circle cx="12" cy="17" r=".6" fill="currentColor" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common}>
          <path d="M12 4l8 4-8 4-8-4z" />
          <path d="M4 12l8 4 8-4" />
          <path d="M4 16l8 4 8-4" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />
        </svg>
      );
    case "receipt":
      return (
        <svg {...common}>
          <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
          <path d="M9 8h6M9 12h6M9 16h3" />
        </svg>
      );
    case "target":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3.5" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "sliders":
      return (
        <svg {...common}>
          <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
          <circle cx="16" cy="7" r="2" />
          <circle cx="10" cy="17" r="2" />
        </svg>
      );
    case "plan":
      return (
        <svg {...common}>
          <path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4 6.8 19.1l1-5.8L3.5 9.2l5.9-.9z" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l2.6 2.5L16 9.5" />
        </svg>
      );
    case "tag":
    default:
      return (
        <svg {...common}>
          <path d="M3 12V4h8l9 9-8 8z" />
          <circle cx="7.5" cy="8.5" r="1.3" />
        </svg>
      );
  }
}

/**
 * State legible at rest (§11d). Green ONLY for "really running" — `on` for a
 * switch-like thing (the embed), `status` for a rule (model/rule-status.ts:
 * Běží / Naplánováno / Skončilo / Nepropsáno / Neběží / Vypnuto).
 */
export function StatusPill({ on, status }: { on?: boolean; status?: RuleStatus }) {
  const tr = useT();
  const live = status ? status.kind === "live" : on === true;
  const attention = status ? needsAttention(status) : false;
  const label = status ? statusLabel(status, tr) : on ? tr.t("common.live") : tr.t("common.off");
  const color = live ? WON_LIVE : attention ? WON_ATTENTION : "#5f6b78";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: ".01em",
        padding: "2px 9px 2px 7px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        color,
        background: live ? "rgba(26,143,75,.10)" : attention ? "rgba(180,35,24,.07)" : WON_WASH,
        border: `1px solid ${live ? "rgba(26,143,75,.28)" : attention ? "rgba(180,35,24,.3)" : WON_LINE}`,
      }}
    >
      <span
        aria-hidden="true"
        style={{ width: 6, height: 6, borderRadius: 999, background: live ? WON_LIVE : attention ? WON_ATTENTION : "#c3cad2", flex: "0 0 auto" }}
      />
      {label}
    </span>
  );
}

/** The collapse affordance: a clear chevron in a ring, pointing down when open. */
function Chevron({ open }: { open: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 26,
        height: 26,
        borderRadius: 999,
        border: `1px solid #c9d0d8`,
        background: "#fff",
        color: WON_INK,
        transition: "transform .18s ease",
        transform: open ? "rotate(90deg)" : "none",
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 6l6 6-6 6" />
      </svg>
    </span>
  );
}

/** The quiet second line of a list row (A7: one style, not re-typed per screen). */
export function RowNote({ children, tone }: { children: ReactNode; tone?: "attention" }) {
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.4, color: tone === "attention" ? WON_ATTENTION : WON_MUTED, marginTop: 2 }}>{children}</div>
  );
}

/** Opens (and scrolls to) a collapsible section whose anchor is the URL hash (§13c deep links). */
function useHashOpen(anchor: string | undefined, setOpen: (open: boolean) => void): void {
  useEffect(() => {
    if (!anchor || typeof window === "undefined") return;
    if (window.location.hash === `#${anchor}`) {
      setOpen(true);
      document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    }
  }, [anchor, setOpen]);
}

export interface WonSectionProps {
  title: string;
  glyph?: SectionGlyphName;
  /** The state-at-rest line, from model/describe.ts (§17a) — never hand-built at the call site. */
  summary?: string;
  /** One extra sentence under the summary. */
  hint?: string;
  /** Live/Off marker for a switch-like thing. Omit for sections that are neither. */
  on?: boolean;
  /** A rule's real state (model/rule-status.ts); wins over `on`. */
  status?: RuleStatus;
  /** Pro-gated section: amber edge + marker; `locked` sells it. */
  pro?: boolean;
  locked?: boolean;
  /** §10 consequence / mini preview under the header. */
  proof?: ReactNode;
  /** Opt-in second column for the section's local consequence (§17f); wraps under the body on narrow screens. */
  aside?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** DOM id for deep links (`#value`); a matching URL hash opens a collapsed section. */
  anchor?: string;
  children?: ReactNode;
}

export function WonSection({
  title,
  glyph = "tag",
  summary,
  hint,
  on,
  status,
  pro,
  locked = false,
  proof,
  aside,
  collapsible = false,
  defaultOpen = true,
  anchor,
  children,
}: WonSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  useHashOpen(anchor, setOpen);
  const bodyId = useId();
  const expanded = collapsible ? open : true;

  const header: ReactNode = (
    <>
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 30,
          height: 30,
          borderRadius: 9,
          flex: "0 0 auto",
          background: WON_WASH,
          border: `1px solid ${WON_LINE}`,
          color: "#48525f",
        }}
      >
        <Glyph name={glyph} />
      </span>
      <span style={{ flex: "1 1 auto", minWidth: 0, textAlign: "left" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: WON_INK, letterSpacing: "-0.01em" }}>{title}</span>
          {pro ? <PlanBadge tier="pro" locked={locked} /> : null}
          {status ? <StatusPill status={status} /> : on !== undefined ? <StatusPill on={on} /> : null}
        </span>
        {summary ? (
          <span style={{ display: "block", marginTop: 3, fontSize: 12.5, lineHeight: 1.35, color: WON_MUTED }}>
            {summary}
          </span>
        ) : null}
        {hint ? (
          <span style={{ display: "block", marginTop: 3, fontSize: 12.5, lineHeight: 1.4, color: WON_FAINT }}>
            {hint}
          </span>
        ) : null}
      </span>
      {collapsible ? <Chevron open={expanded} /> : null}
    </>
  );

  const headerRow: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 12, width: "100%" };
  const hasBody = children !== undefined && children !== null && children !== false;

  return (
    <section
      id={anchor}
      style={{
        fontFamily: WON_FONT,
        background: WON_SURFACE,
        border: `1px solid ${WON_LINE}`,
        borderRadius: 14,
        boxShadow: WON_CARD_SHADOW,
        padding: 16,
        minWidth: 0,
        scrollMarginTop: 16,
        // Amber edge = Pro, readable before any text (§16a/§16b).
        ...(pro ? { borderColor: "rgba(217,168,58,.55)" } : null),
      }}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          style={{ ...headerRow, border: 0, background: "transparent", padding: 0, margin: 0, cursor: "pointer", font: "inherit", color: "inherit" }}
        >
          {header}
        </button>
      ) : (
        <div style={headerRow}>{header}</div>
      )}

      {proof ? <div style={{ marginTop: 12 }}>{proof}</div> : null}

      {hasBody || aside ? (
        // display:none, never unmounted — hidden fields must still submit (§17d).
        <div id={bodyId} style={{ display: expanded ? "block" : "none", marginTop: 14 }}>
          {aside ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "flex-start" }}>
              <div style={{ flex: "1 1 320px", minWidth: 0 }}>{children}</div>
              <div style={{ flex: "1 1 220px", maxWidth: 360, minWidth: 0 }}>{aside}</div>
            </div>
          ) : (
            children
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * A titled block INSIDE a section — one level quieter. `collapsible` implements
 * §9a (rank by frequency, collapse the rest); `summary` keeps a collapsed block
 * honest (§9d). Hidden, never unmounted.
 */
export function WonBlock({
  title,
  summary,
  pro,
  locked = false,
  collapsible = false,
  defaultOpen = true,
  anchor,
  children,
}: {
  title: string;
  summary?: string;
  pro?: boolean;
  locked?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  anchor?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  useHashOpen(anchor, setOpen);
  const bodyId = useId();
  const expanded = collapsible ? open : true;

  const head = (
    <>
      <span style={{ flex: "1 1 auto", minWidth: 0, textAlign: "left" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: WON_INK }}>{title}</span>
          {pro ? <PlanBadge tier="pro" locked={locked} /> : null}
        </span>
        {summary ? (
          <span style={{ display: "block", marginTop: 2, fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED }}>{summary}</span>
        ) : null}
      </span>
      {collapsible ? <Chevron open={expanded} /> : null}
    </>
  );

  const row: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 10, width: "100%" };

  return (
    <div
      id={anchor}
      style={{
        fontFamily: WON_FONT,
        border: `1px solid ${WON_LINE}`,
        borderRadius: 11,
        padding: 12,
        background: WON_WASH,
        minWidth: 0,
        scrollMarginTop: 16,
        ...(pro ? { borderColor: WON_AMBER, background: "rgba(217,168,58,.05)" } : null),
      }}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          style={{ ...row, border: 0, background: "transparent", padding: 0, margin: 0, cursor: "pointer", font: "inherit", color: "inherit" }}
        >
          {head}
        </button>
      ) : (
        <div style={row}>{head}</div>
      )}
      <div id={bodyId} style={{ display: expanded ? "block" : "none", marginTop: 10 }}>
        {children}
      </div>
    </div>
  );
}

/** A section list row: text on the left, one action on the right; wraps on phones. */
export function WonRow({ children, action, tone }: { children: ReactNode; action?: ReactNode; tone?: "attention" }) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "8px 14px",
        padding: "10px 0",
        borderTop: `1px solid ${WON_LINE}`,
        ...(tone === "attention" ? { boxShadow: `inset 3px 0 0 ${WON_ATTENTION}`, paddingLeft: 10 } : null),
      }}
    >
      <div style={{ flex: "1 1 220px", minWidth: 0 }}>{children}</div>
      {action ? <div style={{ flex: "0 0 auto" }}>{action}</div> : null}
    </div>
  );
}
