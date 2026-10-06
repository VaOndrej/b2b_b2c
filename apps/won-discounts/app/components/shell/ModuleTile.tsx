// A home tile (feedback 3, body 2 a 3; doctrine §19d): one part of the app as ONE link — glyph, name, the
// state label the module page shows too (model/module-status.ts), what the part is FOR (so the merchant knows
// what is under the tile before clicking), under it what is ACTIVE now (one sentence from the real settings)
// and, when there is something to resolve, how many things. Nothing inside a tile is a control of its own:
// the whole tile leads to the page. A Pro part on Free is amber and still leads to its page.
//
// The same tile is the view switcher of a module page (ViewTile: a button, the chosen one in selection blue),
// so a long page becomes a few tiles and one panel at a time.
//
// The grid is two columns (also at 390 px, decided 6 Oct 2026) and three from 900 px of page width.

import type { ReactNode } from "react";

import { useT } from "../../i18n/context";
import type { ModuleStatus } from "../model/module-status";
import { PlanBadge } from "./PlanBadge";
import { SectionGlyph, StatusPill, type SectionGlyphName } from "./WonSection";
import { WON_AMBER, WON_AMBER_TINT, WON_ATTENTION, WON_CARD_SHADOW, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SELECT, WON_SURFACE, WON_WASH } from "./tokens";

const GRID_CSS = `
.won-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.won-tiles>*{display:grid;min-width:0}
.won-tile{min-height:104px}
@media (min-width:900px){.won-tiles{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.won-tiles--4{grid-template-columns:repeat(4,minmax(0,1fr))}}
.won-tile{height:100%;box-sizing:border-box}
.won-tile__about{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.won-tile__active{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.won-tile-button{display:grid;width:100%;margin:0;padding:0;border:0;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer;border-radius:14px}
.won-tile-button:focus-visible{outline:2px solid #1a73e8;outline-offset:2px}
@media (max-width:520px){.won-tile{padding:12px!important;min-height:138px}.won-tile__head{flex-direction:column;align-items:flex-start!important;gap:8px!important}}
`;

/** `columns={4}`: a page with four parts keeps them in one row on a desktop. */
export function ModuleTiles({ label, children, columns = 3 }: { label: string; children: ReactNode; columns?: 3 | 4 }) {
  return (
    <nav aria-label={label}>
      <style data-won-tiles-css="" dangerouslySetInnerHTML={{ __html: GRID_CSS }} />
      <div className={columns === 4 ? "won-tiles won-tiles--4" : "won-tiles"} data-won-tiles>
        {children}
      </div>
    </nav>
  );
}

export interface TileContent {
  /** The tile's key (tests and deep links read it). */
  id: string;
  title: string;
  glyph: SectionGlyphName;
  /** What the part is for: what the merchant finds under the tile (never more than three lines). */
  about: string;
  /** What is active / set now, from the real settings (never more than two lines). Absent = nothing to say. */
  active?: string;
  /** The module's state; absent for a part that neither runs nor stops (Přehledy, Nastavení). */
  status?: ModuleStatus;
  /** A Pro part. `locked` = the shop's plan does not run it. */
  pro?: boolean;
  locked?: boolean;
}

export interface ModuleTileProps extends TileContent {
  href: string;
}

function TileBody({ title, glyph, about, active, status, pro = false, locked = false, selected = false, marker }: TileContent & { selected?: boolean; marker: Record<string, string> }) {
  const tr = useT();
  const issues = status?.issues ?? 0;
  return (
    <div
      className="won-tile"
      {...marker}
      {...(locked ? { "data-won-tile-locked": "" } : {})}
      style={{
        fontFamily: WON_FONT,
        background: locked ? WON_AMBER_TINT : selected ? "#f2f7ff" : WON_SURFACE,
        border: `1px solid ${pro ? "rgba(217,168,58,.55)" : WON_LINE}`,
        borderRadius: 14,
        boxShadow: WON_CARD_SHADOW,
        padding: 16,
        minWidth: 0,
        ...(locked ? { borderColor: WON_AMBER } : null),
        // Blue = selected (§11a), also on a Pro tile: which panel is open is not a plan signal.
        ...(selected ? { borderColor: WON_SELECT, boxShadow: `0 0 0 1px ${WON_SELECT}, 0 2px 8px rgba(26,115,232,.16)` } : null),
      }}
    >
      <div className="won-tile__head" style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
          <SectionGlyph name={glyph} />
        </span>
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", minWidth: 0 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: WON_INK, letterSpacing: "-0.01em", overflowWrap: "anywhere" }}>{title}</span>
          {pro ? <PlanBadge tier="pro" locked={locked} /> : null}
          {status ? <StatusPill state={status.state} /> : null}
        </span>
      </div>
      <div className="won-tile__about" data-won-tile-about style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED, overflowWrap: "anywhere" }}>
        {about}
      </div>
      {active || issues > 0 ? (
        <div style={{ marginTop: 10, paddingTop: 9, borderTop: `1px solid ${WON_LINE}` }}>
          {active ? (
            <div className="won-tile__active" data-won-tile-active style={{ fontSize: 12.5, lineHeight: 1.4, fontWeight: 600, color: WON_INK, overflowWrap: "anywhere" }}>
              {active}
            </div>
          ) : null}
          {issues > 0 ? (
            <div data-won-tile-issues style={{ marginTop: active ? 4 : 0, fontSize: 12.5, fontWeight: 600, color: WON_ATTENTION }}>
              {tr.tp("tile.issues", issues)}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ModuleTile({ href, ...content }: ModuleTileProps) {
  return (
    <s-clickable href={href} borderRadius="large">
      <TileBody {...content} marker={{ "data-won-tile": content.id }} />
    </s-clickable>
  );
}

/** A tile that opens one panel of the page it is on (a button; the chosen one is marked in selection blue). */
export function ViewTile({ selected, onPick, ...content }: TileContent & { selected: boolean; onPick: () => void }) {
  return (
    <button data-won-view-tile={content.id} {...(content.locked ? { "data-won-tile-locked": "" } : {})} aria-pressed={selected} type="button" className="won-tile-button" onClick={onPick}>
      <TileBody {...content} selected={selected} marker={{ "data-won-view-body": content.id }} />
    </button>
  );
}
