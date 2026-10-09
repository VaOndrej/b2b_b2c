// A home tile (feedback 3, body 2 a 3; doctrine §19d): one part of the app as ONE link — glyph, name, the
// state label the module page shows too (model/module-status.ts), what the part is FOR (so the merchant knows
// what is under the tile before clicking), under it what is ACTIVE now (one sentence from the real settings)
// and, when there is something to resolve, how many things. Nothing inside a tile is a control of its own:
// the whole tile leads to the page. A Pro part on Free is amber and still leads to its page.
//
// A module page switches its views with a lower tile (ViewTile: a button, the chosen one in selection blue), so a
// long page becomes a few tiles and one panel at a time. A view tile carries only what CHANGES — the name, the
// state label, one sentence of what is set, the things to resolve. What the part is for is said once, in the
// header of the section the tile opens (doctrine §19e: the state once and on top, the explanation once and at
// the content).
//
// The grid is two columns (also at 390 px, decided 6 Oct 2026) and three from 900 px of page width.

import type { CSSProperties, ReactNode } from "react";

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
@media (min-width:1100px){.won-tiles--5{grid-template-columns:repeat(5,minmax(0,1fr))}}
.won-tile{height:100%;box-sizing:border-box}
.won-tile__about{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.won-tile__active{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.won-tile-button{display:grid;width:100%;margin:0;padding:0;border:0;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer;border-radius:14px}
.won-tile-button:focus-visible{outline:2px solid #1a73e8;outline-offset:2px}
.won-tile__about-short{display:none}
.won-view-tile{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 10px;align-content:start;height:100%;box-sizing:border-box}
.won-view-tile__glyph{grid-row:1 / span 3}
.won-view-tile__labels,.won-view-tile__text{grid-column:2}
@media (max-width:520px){.won-tile{padding:12px!important;min-height:138px}.won-tile__head{flex-direction:column;align-items:flex-start!important;gap:8px!important}
.won-tile__about{-webkit-line-clamp:2}
.won-tile__about--long{display:none}.won-tile__about-short{display:inline}
.won-tile__active{display:block;overflow:visible;-webkit-line-clamp:unset}
.won-view-tile{row-gap:8px}
.won-view-tile__glyph{grid-row:1}
.won-view-tile__labels{align-self:center}
.won-view-tile__labels [data-won-state]{max-width:100%;box-sizing:border-box;white-space:normal!important;border-radius:10px!important;line-height:1.25}
.won-view-tile__text{grid-column:1 / -1}}
`;

/** `columns={4}`: a page with four parts keeps them in one row on a desktop; `{5}` five on a wide one (three a row below 1 100 px). */
export function ModuleTiles({ label, children, columns = 3 }: { label: string; children: ReactNode; columns?: 3 | 4 | 5 }) {
  return (
    <nav aria-label={label}>
      <style data-won-tiles-css="" dangerouslySetInnerHTML={{ __html: GRID_CSS }} />
      <div className={columns === 4 ? "won-tiles won-tiles--4" : columns === 5 ? "won-tiles won-tiles--5" : "won-tiles"} data-won-tiles>
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
  /**
   * What is active / set now, from the real settings. Absent = nothing to say. Two lines on a wide tile; on a narrow
   * one it is never cut (it wraps): this line is why the tile exists (audit N3).
   */
  active?: string;
  /** The module's state; absent for a part that neither runs nor stops (Přehledy, Nastavení). */
  status?: ModuleStatus;
  /** Said instead of the count when the thing to resolve is not on this part's page (another part's failed write holds it back, audit N13). */
  issueText?: string;
  /** Things to resolve under a tile that has no state of its own (a page's "na webu" panel: what is missing in the theme). */
  issues?: number;
  /** A Pro part. `locked` = the shop's plan does not run it. */
  pro?: boolean;
  locked?: boolean;
}

export interface ModuleTileProps extends TileContent {
  href: string;
  /** What the part is for: what the merchant finds under the tile (never more than three lines). */
  about: string;
  /** The same in one short sentence, for a narrow tile (two columns at 390 px), so it is never cut mid-sentence (audit N3). */
  aboutShort?: string;
}

/** The surface of a tile: amber = a Pro part the plan does not run, blue = the chosen view (§11a). */
function tileFrame({ pro = false, locked = false, selected = false }: { pro?: boolean; locked?: boolean; selected?: boolean }): CSSProperties {
  return {
    fontFamily: WON_FONT,
    background: locked ? WON_AMBER_TINT : selected ? "#f2f7ff" : WON_SURFACE,
    // ONE `border` declaration (never the shorthand plus `borderColor`): React drops the colour of a tile that
    // stops being selected and the border then falls back to the text colour — a third, dark border (audit N18).
    // Blue = selected (§11a), also on a Pro tile: which panel is open is not a plan signal.
    border: `1px solid ${selected ? WON_SELECT : locked ? WON_AMBER : pro ? "rgba(217,168,58,.55)" : WON_LINE}`,
    borderRadius: 14,
    boxShadow: selected ? `0 0 0 1px ${WON_SELECT}, 0 2px 8px rgba(26,115,232,.16)` : WON_CARD_SHADOW,
    minWidth: 0,
  };
}

function TileGlyph({ name, className }: { name: SectionGlyphName; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={className}
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
      <SectionGlyph name={name} />
    </span>
  );
}

/** The name with the Pro marker and the state label beside it. */
function TileLabels({ title, status, pro = false, locked = false, className }: Pick<TileContent, "title" | "status" | "pro" | "locked"> & { className?: string }) {
  return (
    <span className={className} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 8px", minWidth: 0 }}>
      <span style={{ fontSize: 14.5, fontWeight: 700, color: WON_INK, letterSpacing: "-0.01em", overflowWrap: "anywhere" }}>{title}</span>
      {pro ? <PlanBadge tier="pro" locked={locked} /> : null}
      {status ? <StatusPill state={status.state} /> : null}
    </span>
  );
}

const ACTIVE_STYLE: CSSProperties = { fontSize: 12.5, lineHeight: 1.4, fontWeight: 600, color: WON_INK, overflowWrap: "anywhere" };

/** Things to resolve: the module's own count, else the tile's. */
function issueCount({ status, issues }: Pick<TileContent, "status" | "issues">): number {
  return status?.issues ?? issues ?? 0;
}

function TileIssues({ issueText, className, gap, ...counted }: Pick<TileContent, "status" | "issues" | "issueText"> & { className?: string; gap: number }) {
  const tr = useT();
  const issues = issueCount(counted);
  if (issues <= 0) return null;
  return (
    <div className={className} data-won-tile-issues style={{ marginTop: gap, fontSize: 12.5, fontWeight: 600, color: WON_ATTENTION }}>
      {issueText ?? tr.tp("tile.issues", issues)}
    </div>
  );
}

function TileBody({ title, glyph, about, aboutShort, active, status, issues, issueText, pro = false, locked = false, marker }: Omit<ModuleTileProps, "href" | "id"> & { marker: Record<string, string> }) {
  const hasIssues = issueCount({ status, issues }) > 0;
  return (
    <div className="won-tile" {...marker} {...(locked ? { "data-won-tile-locked": "" } : {})} style={{ ...tileFrame({ pro, locked }), padding: 16 }}>
      <div className="won-tile__head" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <TileGlyph name={glyph} />
        <TileLabels title={title} status={status} pro={pro} locked={locked} />
      </div>
      <div className="won-tile__about" data-won-tile-about style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED, overflowWrap: "anywhere" }}>
        {aboutShort ? (
          <>
            <span className="won-tile__about--long">{about}</span>
            <span className="won-tile__about-short">{aboutShort}</span>
          </>
        ) : (
          about
        )}
      </div>
      {active || hasIssues ? (
        <div style={{ marginTop: 10, paddingTop: 9, borderTop: `1px solid ${WON_LINE}` }}>
          {active ? (
            <div className="won-tile__active" data-won-tile-active style={ACTIVE_STYLE}>
              {active}
            </div>
          ) : null}
          <TileIssues status={status} issues={issues} issueText={issueText} gap={active ? 4 : 0} />
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

/**
 * A tile that opens one panel of the page it is on (a button; the chosen one is marked in selection blue). Lower
 * than a home tile: the glyph beside the name, the label, the sentence of what is set (it wraps, never cut) and
 * the things to resolve.
 */
export function ViewTile({ selected, onPick, id, title, glyph, active, status, issues, issueText, pro = false, locked = false }: TileContent & { selected: boolean; onPick: () => void }) {
  return (
    <button data-won-view-tile={id} {...(locked ? { "data-won-tile-locked": "" } : {})} aria-pressed={selected} type="button" className="won-tile-button" onClick={onPick}>
      <div className="won-view-tile" data-won-view-body={id} {...(locked ? { "data-won-tile-locked": "" } : {})} style={{ ...tileFrame({ pro, locked, selected }), padding: 12 }}>
        <TileGlyph name={glyph} className="won-view-tile__glyph" />
        <TileLabels title={title} status={status} pro={pro} locked={locked} className="won-view-tile__labels" />
        {active ? (
          <div className="won-view-tile__text" data-won-tile-active style={ACTIVE_STYLE}>
            {active}
          </div>
        ) : null}
        <TileIssues status={status} issues={issues} issueText={issueText} className="won-view-tile__text" gap={0} />
      </div>
    </button>
  );
}
