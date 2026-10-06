// A home tile (feedback 3, body 2 a 3; doctrine §19d): one part of the app as ONE link — glyph, name, the
// state label the module page shows too (model/module-status.ts), one sentence with the real settings and,
// when there is something to resolve, how many things. Nothing inside a tile is a control of its own:
// the whole tile leads to the page. A Pro part on Free is amber and still leads to its page.
//
// The grid is two columns (also at 390 px, decided 6 Oct 2026) and three from 900 px of page width.

import type { ReactNode } from "react";

import { useT } from "../../i18n/context";
import type { ModuleStatus } from "../model/module-status";
import { PlanBadge } from "./PlanBadge";
import { SectionGlyph, StatusPill, type SectionGlyphName } from "./WonSection";
import { WON_AMBER, WON_AMBER_TINT, WON_ATTENTION, WON_CARD_SHADOW, WON_FONT, WON_INK, WON_LINE, WON_MUTED, WON_SURFACE, WON_WASH } from "./tokens";

const GRID_CSS = `
.won-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.won-tiles>*{display:grid;min-width:0}
.won-tile{min-height:104px}
@media (min-width:900px){.won-tiles{grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}}
.won-tile{height:100%;box-sizing:border-box}
.won-tile__body{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
@media (max-width:520px){.won-tile{padding:12px!important;min-height:138px}.won-tile__head{flex-direction:column;align-items:flex-start!important;gap:8px!important}}
`;

export function ModuleTiles({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav aria-label={label}>
      <style dangerouslySetInnerHTML={{ __html: GRID_CSS }} />
      <div className="won-tiles" data-won-tiles>
        {children}
      </div>
    </nav>
  );
}

export interface ModuleTileProps {
  /** The tile's key (tests and deep links read it). */
  id: string;
  href: string;
  title: string;
  glyph: SectionGlyphName;
  /** One sentence with the real settings (never more than two lines). */
  body: string;
  /** The module's state; absent for a part that neither runs nor stops (Přehledy, Nastavení). */
  status?: ModuleStatus;
  /** A Pro part. `locked` = the shop's plan does not run it. */
  pro?: boolean;
  locked?: boolean;
}

export function ModuleTile({ id, href, title, glyph, body, status, pro = false, locked = false }: ModuleTileProps) {
  const tr = useT();
  const issues = status?.issues ?? 0;
  return (
    <s-clickable href={href} borderRadius="large">
      <div
        className="won-tile"
        data-won-tile={id}
        {...(locked ? { "data-won-tile-locked": "" } : {})}
        style={{
          fontFamily: WON_FONT,
          background: locked ? WON_AMBER_TINT : WON_SURFACE,
          border: `1px solid ${pro ? "rgba(217,168,58,.55)" : WON_LINE}`,
          borderRadius: 14,
          boxShadow: WON_CARD_SHADOW,
          padding: 16,
          minWidth: 0,
          ...(locked ? { borderColor: WON_AMBER } : null),
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
        <div className="won-tile__body" style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.4, color: WON_MUTED, overflowWrap: "anywhere" }}>
          {body}
        </div>
        {issues > 0 ? (
          <div data-won-tile-issues style={{ marginTop: 6, fontSize: 12.5, fontWeight: 600, color: WON_ATTENTION }}>
            {tr.tp("tile.issues", issues)}
          </div>
        ) : null}
      </div>
    </s-clickable>
  );
}
