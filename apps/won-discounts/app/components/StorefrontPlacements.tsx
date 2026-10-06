// Where on the storefront a module can show itself (feedback 2, body 5 a 7): one row per place — what the
// customer sees there and the ONE button that adds it in the theme editor (§13: the merchant never has to
// find the block by hand). Shared by Odměny and Kampaně; the links come from model/embed.ts.
// Feedback 3, bod 5: every row says where it stands in the live theme with the same three labels as every
// other placement (green "V tématu", red "Chybí v tématu", grey "Neověřeno"); a missing one gets the
// primary button.

import { useT } from "../i18n/context";
import type { MessageKey } from "../i18n";
import { placementOf, type PlacementLinks } from "./model/embed";
import type { PlacementKey, ThemePlacements } from "./model/types";
import { PlacementPill, RowNote, WonRow } from "./shell/WonSection";

export interface PlacementRow {
  place: keyof PlacementLinks;
  /** Which fact of the theme read answers "is it there". */
  key: PlacementKey;
  /** What shows there. */
  text: MessageKey;
  /** The button of a place that is switched on in the embed's settings (the top bar); a block's button is "Přidat do tématu". */
  action?: MessageKey;
}

export function StorefrontPlacements({ links, rows, placed = {} }: { links: PlacementLinks; rows: readonly PlacementRow[]; placed?: ThemePlacements }) {
  const { t } = useT();
  const shown = rows.filter((row) => links[row.place]);
  if (shown.length === 0) return <RowNote>{t("placements.noLinks")}</RowNote>;
  return (
    <div data-won-placements>
      {shown.map((row) => {
        const placement = placementOf(placed[row.key]);
        return (
          <WonRow
            key={row.place}
            tone={placement === "missing" ? "attention" : undefined}
            action={
              <s-button href={links[row.place]!} target="_top" variant={placement === "missing" ? "primary" : "secondary"}>
                {t(row.action ?? (placement === "in_theme" ? "placement.open" : "placement.add"))}
              </s-button>
            }
          >
            <PlacementPill placement={placement} />
            <RowNote>{t(row.text)}</RowNote>
          </WonRow>
        );
      })}
    </div>
  );
}
