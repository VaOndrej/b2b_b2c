// Where on the storefront a module can show itself (feedback 2, body 5 a 7): one row per place — what the
// customer sees there and the ONE button that adds it in the theme editor (§13: the merchant never has to
// find the block by hand). Shared by Odměny and Kampaně; the links come from model/embed.ts.

import { useT } from "../i18n/context";
import type { MessageKey } from "../i18n";
import type { PlacementLinks } from "./model/embed";
import { RowNote, WonRow } from "./shell/WonSection";

export interface PlacementRow {
  place: keyof PlacementLinks;
  /** What shows there. */
  text: MessageKey;
  /** The button. */
  action: MessageKey;
}

export function StorefrontPlacements({ links, rows }: { links: PlacementLinks; rows: readonly PlacementRow[] }) {
  const { t } = useT();
  const shown = rows.filter((row) => links[row.place]);
  if (shown.length === 0) return <RowNote>{t("placements.noLinks")}</RowNote>;
  return (
    <div data-won-placements>
      {shown.map((row) => (
        <WonRow
          key={row.place}
          action={
            <s-button href={links[row.place]!} target="_top" variant="secondary">
              {t(row.action)}
            </s-button>
          }
        >
          <RowNote>{t(row.text)}</RowNote>
        </WonRow>
      ))}
    </div>
  );
}
