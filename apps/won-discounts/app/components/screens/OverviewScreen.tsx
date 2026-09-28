// Přehled v0 — the admin home screen, as a presentational component. Rendered
// by the embedded route (app/routes/app._index.tsx, the shop's stored config)
// and by the dev harness (app/routes/dev.preview.$.tsx, a fixture config), so
// the harness screenshots the real screen (audit P2-5). Props are plain
// serializable data built by buildOverviewProps(); no raw enums reach the UI.

import type { WonDiscountsConfig } from "@won/core/discounts/config";

export interface OverviewScreenProps {
  schemaVersion: number;
  ruleCount: number;
  /** The stored config belongs to a newer app version (DATA-3): changes are not saved. */
  readOnly: boolean;
}

export function buildOverviewProps(
  config: WonDiscountsConfig,
  opts: { readOnly: boolean },
): OverviewScreenProps {
  return {
    schemaVersion: config.schemaVersion,
    ruleCount: config.modules.codes.rules.length,
    readOnly: opts.readOnly,
  };
}

/** Czech plural: 1 pravidlo, 2–4 pravidla, 0 and 5+ pravidel. */
export function ruleCountLabel(count: number): string {
  if (count === 1) return "1 pravidlo";
  if (count >= 2 && count <= 4) return `${count} pravidla`;
  return `${count} pravidel`;
}

export function OverviewScreen({ schemaVersion, ruleCount, readOnly }: OverviewScreenProps) {
  return (
    <s-page heading="Won Discounts">
      {readOnly ? (
        <s-banner tone="warning" heading="Nastavení jen pro čtení">
          Nastavení uložila novější verze aplikace. Dokud se aktualizace nedokončí, změny se neuloží.
        </s-banner>
      ) : null}
      <s-section heading="Stav">
        <s-paragraph>
          Konfigurace: verze {schemaVersion} · {ruleCountLabel(ruleCount)}
        </s-paragraph>
        <s-paragraph>Vložení do tématu: zatím neověřeno</s-paragraph>
      </s-section>
    </s-page>
  );
}
