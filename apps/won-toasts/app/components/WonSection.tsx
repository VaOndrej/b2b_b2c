// The ONE section shell for the whole admin (doctrine §17 + A7).
//
// Why this exists: every config screen used to be `s-section heading="Look"` →
// a bold title → a wall of fields of identical visual weight. A merchant read
// "Placement" and learned nothing — not that it's set to bottom-right, 40 px,
// max 3; not what the setting does. Sections described their SCHEMA, never their
// STATE or their CONSEQUENCE. That single defect is what made the admin read as
// "flat" and "nic neříkající".
//
// So a section has three fixed slots before its body:
//   1. IDENTITY  — a neutral glyph + the title.
//   2. STATE     — a one-line summary of the current configuration, from a shared
//                  formatter in @won/core (§17: never a hand-built string), plus
//                  an On/Off or Pro marker. Readable without interacting (§11d).
//   3. PROOF     — an optional tiny illustration of the mechanism (§10).
//
// Colour discipline (§11a): the glyph is deliberately NEUTRAL. Blue means
// selected, amber means Pro, green means live — giving each section its own hue
// would invent a fourth meaning and collide with all three.
//
// Collapsing NEVER unmounts the body: hidden fields must still submit, because
// one Save Bar covers the whole form (§8b).

import { useId, useState, type CSSProperties, type ReactNode } from "react";

import {
  WON_CARD_SHADOW,
  WON_FAINT,
  WON_FONT,
  WON_INK,
  WON_LINE,
  WON_LIVE,
  WON_MUTED,
  WON_SURFACE,
  WON_WASH,
} from "../lib/tokens";
import { PlanBadge } from "./PlanBadge";

export type SectionGlyphName =
  | "look"
  | "placement"
  | "timing"
  | "shield"
  | "code"
  | "target"
  | "toast"
  | "history";

/**
 * Small neutral line glyphs. Monochrome on purpose — they carry identity, not
 * meaning, so they must not compete with the three semantic colours (§11a).
 */
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
    case "look":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
        </svg>
      );
    case "placement":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <rect x="12.5" y="12.5" width="6" height="4" rx="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "timing":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />
          <path d="M9 12l2 2 4-4" />
        </svg>
      );
    case "code":
      return (
        <svg {...common}>
          <path d="M9 8l-5 4 5 4" />
          <path d="M15 8l5 4-5 4" />
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
    case "history":
      return (
        <svg {...common}>
          <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
          <path d="M3 4v4h4" />
          <path d="M12 8v4.5l3 1.8" />
        </svg>
      );
    case "toast":
    default:
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="7" rx="2" />
          <path d="M6 17.5h12" />
        </svg>
      );
  }
}

/** "Live" / "Off" state, legible at rest (§11d). */
export function StatusPill({ on }: { on: boolean }) {
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
        color: on ? WON_LIVE : "#6b7684",
        background: on ? "rgba(26,143,75,.10)" : WON_WASH,
        border: `1px solid ${on ? "rgba(26,143,75,.28)" : WON_LINE}`,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: 999,
          background: on ? WON_LIVE : "#c3cad2",
          flex: "0 0 auto",
        }}
      />
      {on ? "Live" : "Off"}
    </span>
  );
}

export interface WonSectionProps {
  title: string;
  glyph?: SectionGlyphName;
  /**
   * The state-at-rest line. MUST come from a describe*() formatter in
   * @won/core (§17) — never assembled by hand at the call site, or two screens
   * will eventually describe the same config differently.
   */
  summary?: string;
  /** Extra explanation shown under the summary. Keep it to one sentence. */
  hint?: string;
  /** Live/Off marker. Omit for sections that are neither. */
  on?: boolean;
  /** Pro-gated section: shows the amber marker and, when `locked`, sells it. */
  pro?: boolean;
  /** Merchant is on Free and this section is Pro. */
  locked?: boolean;
  /** The §10 Effect Proof / mechanism illustration for this section. */
  proof?: ReactNode;
  /**
   * Opt-in second column holding this section's LOCAL consequence (a mini
   * preview). Sections without a meaningful local consequence stay single
   * column — a proof on a trivial toggle is noise (§10d).
   */
  aside?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function WonSection({
  title,
  glyph = "toast",
  summary,
  hint,
  on,
  pro,
  locked = false,
  proof,
  aside,
  collapsible = false,
  defaultOpen = true,
  children,
}: WonSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
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
          <span style={{ fontSize: 15, fontWeight: 700, color: WON_INK, letterSpacing: "-0.01em" }}>
            {title}
          </span>
          {pro ? <PlanBadge tier="pro" locked={locked} /> : null}
          {on !== undefined ? <StatusPill on={on} /> : null}
        </span>
        {/* The state line — this is the whole point of §17. */}
        {summary ? (
          <span
            style={{
              display: "block",
              marginTop: 3,
              fontSize: 12.5,
              lineHeight: 1.35,
              color: WON_MUTED,
            }}
          >
            {summary}
          </span>
        ) : null}
        {hint ? (
          <span
            style={{
              display: "block",
              marginTop: 3,
              fontSize: 12.5,
              lineHeight: 1.4,
              color: WON_FAINT,
            }}
          >
            {hint}
          </span>
        ) : null}
      </span>

      {collapsible ? (
        <span
          aria-hidden="true"
          style={{
            flex: "0 0 auto",
            color: "#98a2ae",
            transition: "transform .18s ease",
            transform: expanded ? "rotate(90deg)" : "none",
            lineHeight: 1,
            fontSize: 14,
          }}
        >
          ▸
        </span>
      ) : null}
    </>
  );

  const headerRow: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    width: "100%",
  };

  return (
    <section
      style={{
        fontFamily: WON_FONT,
        background: WON_SURFACE,
        border: `1px solid ${WON_LINE}`,
        borderRadius: 14,
        boxShadow: WON_CARD_SHADOW,
        padding: 18,
        // Amber edge for a Pro section, so plan state reads before any text
        // (§16a/§16b — amber is the only plan signal).
        ...(pro ? { borderColor: "rgba(217,168,58,.55)" } : null),
      }}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          style={{
            ...headerRow,
            border: 0,
            background: "transparent",
            padding: 0,
            margin: 0,
            cursor: "pointer",
            font: "inherit",
            color: "inherit",
          }}
        >
          {header}
        </button>
      ) : (
        <div style={headerRow}>{header}</div>
      )}

      {proof ? <div style={{ marginTop: 12 }}>{proof}</div> : null}

      {/* display:none, never unmounted — hidden fields must still submit (§8b). */}
      <div id={bodyId} style={{ display: expanded ? "block" : "none", marginTop: 14 }}>
        {aside ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) minmax(200px,280px)",
              gap: 18,
              alignItems: "start",
            }}
          >
            <div style={{ minWidth: 0 }}>{children}</div>
            <div style={{ minWidth: 0 }}>{aside}</div>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/**
 * A titled block INSIDE a section — the level below §17. Same three-slot idea,
 * one step quieter, so a section can hold several related groups without every
 * group shouting like a section header.
 *
 * `collapsible` implements §9a (rank by frequency, collapse the rest) and §9d
 * (a collapsed block states its state — that's what `summary` is for). As in
 * WonSection the body is hidden, never unmounted, so its fields keep submitting.
 */
export function WonBlock({
  title,
  summary,
  pro,
  locked = false,
  collapsible = false,
  defaultOpen = true,
  children,
}: {
  title: string;
  summary?: string;
  pro?: boolean;
  locked?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
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
          <span
            style={{
              display: "block",
              marginTop: 2,
              fontSize: 12.5,
              lineHeight: 1.4,
              color: WON_MUTED,
            }}
          >
            {summary}
          </span>
        ) : null}
      </span>
      {collapsible ? (
        <span
          aria-hidden="true"
          style={{
            flex: "0 0 auto",
            color: "#98a2ae",
            transition: "transform .18s ease",
            transform: expanded ? "rotate(90deg)" : "none",
            lineHeight: 1,
            fontSize: 13,
          }}
        >
          ▸
        </span>
      ) : null}
    </>
  );

  const row: CSSProperties = {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    width: "100%",
  };

  return (
    <div
      style={{
        fontFamily: WON_FONT,
        border: `1px solid ${WON_LINE}`,
        borderRadius: 11,
        padding: 14,
        background: WON_WASH,
        ...(pro ? { borderColor: "rgba(217,168,58,.45)", background: "rgba(217,168,58,.05)" } : null),
      }}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          style={{
            ...row,
            border: 0,
            background: "transparent",
            padding: 0,
            margin: 0,
            cursor: "pointer",
            font: "inherit",
            color: "inherit",
          }}
        >
          {head}
        </button>
      ) : (
        <div style={row}>{head}</div>
      )}
      <div id={bodyId} style={{ display: expanded ? "block" : "none", marginTop: 12 }}>
        {children}
      </div>
    </div>
  );
}
