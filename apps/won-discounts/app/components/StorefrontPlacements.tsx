// Where on the storefront a module can show itself (feedback 2, body 5 a 7): one row per place — what the
// customer sees there and the ONE button that adds it in the theme editor (§13: the merchant never has to
// find the block by hand). Shared by Odměny and Kampaně; the links come from model/embed.ts.
// Feedback 3, bod 5: every row says where it stands in the live theme with the same three labels as every
// other placement (green "V tématu", red "Chybí v tématu", grey "Neověřeno"); a missing one gets the
// primary button.

import { useT } from "../i18n/context";
import type { MessageKey } from "../i18n";
import { editorOpenUrl, placementOf, spotAdvice, type PlacementLinks } from "./model/embed";
import type { PlacementKey, PlacementSpot, ThemePlacements } from "./model/types";
import { PlacementPill, type PlacementState, RowNote, WonRow } from "./shell/WonSection";

export interface PlacementRow {
  place: keyof PlacementLinks;
  /** Which fact of the theme read answers "is it there". */
  key: PlacementKey;
  /** What shows there. */
  text: MessageKey;
  /** The sentence once the place is in the theme (a place that is switched on needs no how-to any more, audit N7). */
  textOn?: MessageKey;
  /** The button of a place that is switched on in the embed's settings (the top bar); a block's button is "Přidat do tématu". */
  action?: MessageKey;
}

/**
 * Where a block landed, or — before it is added — where Shopify will put it (feedback 9 Oct 2026, 4th round: a
 * banner added to the home page lands at its very end, and nothing said so).
 */
export function SpotNote({ placement, spot, place, spotKey }: { placement: PlacementState; spot: PlacementSpot | undefined; place: "product" | "home" | "cart" | "topBar" | "topBarEmbed"; spotKey: string }) {
  const { t } = useT();
  const advice = placement === "in_theme" ? spotAdvice(spot) : null;
  if (advice) {
    return (
      <span data-won-placement-spot={spotKey} data-won-placement-move={advice.move ? "yes" : "no"}>
        <RowNote tone={advice.move ? "attention" : undefined}>{t(advice.key, advice.params)}</RowNote>
      </span>
    );
  }
  if (placement !== "missing" || (place !== "home" && place !== "product")) return null;
  return <RowNote>{t(place === "home" ? "placement.spot.howPage" : "placement.spot.howProduct")}</RowNote>;
}

export function StorefrontPlacements({ links, rows, placed = {} }: { links: PlacementLinks; rows: readonly PlacementRow[]; placed?: ThemePlacements }) {
  const { t } = useT();
  const shown = rows.filter((row) => links[row.place]);
  if (shown.length === 0) return <RowNote>{t("placements.noLinks")}</RowNote>;
  return (
    <div data-won-placements>
      {shown.map((row) => {
        const placement = placementOf(placed[row.key]);
        const move = placement === "in_theme" && spotAdvice(placed.spots?.[row.key])?.move === true;
        // In the theme already: the button opens the editor, it never adds a second block.
        const href = placement === "in_theme" && !row.action ? (editorOpenUrl(links[row.place], placed.spots?.[row.key]) ?? links[row.place]!) : links[row.place]!;
        return (
          <WonRow
            key={row.place}
            tone={placement === "missing" ? "attention" : undefined}
            action={
              <s-button href={href} target="_top" variant={placement === "missing" ? "primary" : "secondary"}>
                {t(row.action ?? (placement === "in_theme" ? "placement.open" : "placement.add"))}
              </s-button>
            }
          >
            <PlacementPill placement={placement} move={move} />
            <RowNote>{t(placement === "in_theme" && row.textOn ? row.textOn : row.text)}</RowNote>
            <SpotNote placement={placement} spot={placed.spots?.[row.key]} place={row.place} spotKey={row.key} />
          </WonRow>
        );
      })}
    </div>
  );
}
