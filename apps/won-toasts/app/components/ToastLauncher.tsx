// Status-first launcher for the Toasts page (doctrine A3 + §17).
//
// It used to be four outcome groups × seven cards, each card carrying a
// CATEGORY description ("The add/remove/update toasts — the core of the app").
// A merchant read it once, learned it, and from day two it said nothing — while
// eating the entire first screen before anything editable. The page enumerated
// features; it never answered "what is running on my store, and is it working?"
//
// So the split is by STATE, not by category:
//   • Running now      — what is live, what it currently says, how often it
//                        showed. Real numbers or an honest "Collecting data"
//                        (§5 — never fabricate), never a decorative zero.
//   • Available to add — what is off, with the blurb that sells it. This is the
//                        one place a category pitch earns its space (§15).
//
// The outcome grouping A3 asks for survives as a small eyebrow on each available
// card, which keeps the taxonomy without four more headings.

import { PlanBadge } from "./PlanBadge";
import {
  WON_FAINT,
  WON_FONT,
  WON_INK,
  WON_LINE,
  WON_LIVE,
  WON_MUTED,
  WON_WASH,
  selectionRing,
} from "../lib/tokens";

export interface LauncherItem {
  key: string;
  label: string;
  /** The sales pitch — shown only while the toast is OFF. */
  blurb: string;
  /** Outcome family, e.g. "Urgency & scarcity". */
  group: string;
  pro?: boolean;
  on?: boolean;
  /**
   * What this toast currently SAYS to shoppers, already rendered for humans.
   * Shown only while it's live — that's the state a merchant can't get anywhere
   * else on the page.
   */
  state?: string;
  /**
   * Real impressions in the reporting window. `undefined` means "we have no
   * data", which is rendered as such — a hard 0 would read as "it ran and
   * nobody saw it", a different and unproven claim (§12b).
   */
  impressions?: number;
}

function formatCount(n: number): string {
  // Thin spaces group thousands the way the rest of the admin does.
  return n.toLocaleString("en-US").replace(/,/g, " ");
}

function Card({
  item,
  active,
  onSelect,
  live,
  windowLabel,
}: {
  item: LauncherItem;
  active: boolean;
  onSelect: (key: string) => void;
  live: boolean;
  windowLabel: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => onSelect(item.key)}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 5,
        textAlign: "left",
        padding: "11px 13px",
        minHeight: live ? 74 : 68,
        borderRadius: 12,
        cursor: "pointer",
        fontFamily: "inherit",
        width: "100%",
        transition: "border-color .15s ease, background .15s ease, box-shadow .15s ease",
        ...selectionRing(active),
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 7, width: "100%" }}>
        {live ? (
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: 999,
              flex: "0 0 auto",
              background: WON_LIVE,
            }}
          />
        ) : null}
        <span style={{ fontSize: 13.5, fontWeight: 700, color: WON_INK, flex: "1 1 auto", minWidth: 0 }}>
          {item.label}
        </span>
        {item.pro ? <PlanBadge tier="pro" /> : null}
      </span>

      {live ? (
        <>
          {/* What it says right now — quoted, so it reads as the merchant's own
              copy rather than as UI chrome. */}
          {item.state ? (
            <span
              style={{
                fontSize: 12,
                lineHeight: 1.35,
                color: WON_MUTED,
                display: "-webkit-box",
                WebkitLineClamp: 1,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                width: "100%",
              }}
            >
              “{item.state}”
            </span>
          ) : null}
          <span style={{ fontSize: 11.5, fontWeight: 600, color: WON_FAINT }}>
            {item.impressions === undefined
              ? "Collecting data"
              : `Shown ${formatCount(item.impressions)}× ${windowLabel}`}
          </span>
        </>
      ) : (
        <>
          <span
            style={{
              fontSize: 10.5,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              fontWeight: 700,
              color: WON_FAINT,
            }}
          >
            {item.group}
          </span>
          <span
            style={{
              fontSize: 12,
              lineHeight: 1.35,
              color: WON_MUTED,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {item.blurb}
          </span>
        </>
      )}
    </button>
  );
}

function ZoneHeading({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: WON_INK }}>{title}</span>
      {note ? <span style={{ fontSize: 12, color: WON_FAINT }}>{note}</span> : null}
    </div>
  );
}

export function ToastLauncher({
  items,
  selected,
  onSelect,
  /** How the impression numbers are scoped, e.g. "in the last 7 days". */
  windowLabel = "in the last 7 days",
}: {
  items: LauncherItem[];
  selected: string;
  onSelect: (key: string) => void;
  windowLabel?: string;
}) {
  const running = items.filter((i) => i.on);
  const available = items.filter((i) => !i.on);

  const grid = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))",
    gap: 10,
  } as const;

  return (
    <div role="tablist" aria-label="Toast types" style={{ marginBottom: 16, fontFamily: WON_FONT }}>
      <div style={{ marginBottom: running.length && available.length ? 18 : 0 }}>
        <ZoneHeading
          title="Running now"
          note={`${running.length} of ${items.length} live on your store`}
        />
        {running.length === 0 ? (
          // §15 — the empty state teaches instead of apologising, and §13b says
          // it must point forward rather than shrug.
          <div
            style={{
              border: `1px dashed ${WON_LINE}`,
              background: WON_WASH,
              borderRadius: 12,
              padding: "14px 16px",
              fontSize: 12.5,
              lineHeight: 1.5,
              color: WON_MUTED,
            }}
          >
            Nothing is showing to shoppers yet. Pick a toast below to set it up —
            cart toasts are the usual first one, because they need no extra data.
          </div>
        ) : (
          <div style={grid}>
            {running.map((it) => (
              <Card
                key={it.key}
                item={it}
                live
                active={selected === it.key}
                onSelect={onSelect}
                windowLabel={windowLabel}
              />
            ))}
          </div>
        )}
      </div>

      {available.length > 0 ? (
        <div>
          <ZoneHeading title="Available to turn on" note="Off right now" />
          <div style={grid}>
            {available.map((it) => (
              <Card
                key={it.key}
                item={it}
                live={false}
                active={selected === it.key}
                onSelect={onSelect}
                windowLabel={windowLabel}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
