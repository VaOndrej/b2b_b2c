// "Neshody ve sčítání slev" (docs/won-discounts/navrh-kombinace-2026-10-13.md, "Neshoda"): every discount that
// allows others which do not allow it back, once, with the two ways to set it straight in one save — "Povolit i u
// druhé strany" and "Zakázat i tady" (posted to /app/combine, lib/integration/combine.server.ts) — and where its
// list is. Said before the click: a button that changes a whole type makes other mismatches. Every plan's: a
// mismatch is in the config, not a cart.

import { useFetcher } from "react-router";

import { useT } from "../../i18n/context";
import { MISMATCH_FIELD, MISMATCH_INTENT, mismatchText, type CombineMismatchView } from "../model/combine-mismatch";
import type { UiResult } from "../model/types";
import { boolAttr } from "./attrs";
import { Finding } from "./Finding";
import { useFormActions } from "./form-actions";
import { Notice } from "./Notice";
import { RowNote, WonSection } from "./WonSection";

function FixButton({ id, mode, configVersion, label, variant }: { id: string; mode: "allow" | "deny"; configVersion: string | null; label: string; variant: "primary" | "secondary" }) {
  const fetcher = useFetcher<UiResult>();
  const actions = useFormActions();
  return (
    <fetcher.Form method="post" action={actions.combine} data-won-mismatch-fix={mode} style={{ display: "inline" }}>
      <input type="hidden" name={MISMATCH_FIELD.intent} value={MISMATCH_INTENT} />
      <input type="hidden" name={MISMATCH_FIELD.id} value={id} />
      <input type="hidden" name={MISMATCH_FIELD.mode} value={mode} />
      {configVersion ? <input type="hidden" name="configVersion" value={configVersion} /> : null}
      <s-button type="submit" variant={variant} disabled={boolAttr(fetcher.state !== "idle")}>
        {label}
      </s-button>
      {fetcher.data && !fetcher.data.ok ? <Notice result={fetcher.data} /> : null}
    </fetcher.Form>
  );
}

export function MismatchSection({ mismatches, configVersion }: { mismatches: readonly CombineMismatchView[]; configVersion: string | null }) {
  const tr = useT();
  const { t } = tr;
  if (mismatches.length === 0) return null;
  return (
    <WonSection title={t("combine.mismatch.title")} glyph="sliders" summary={tr.tp("combine.mismatch.summary", mismatches.length)} anchor="mismatches" state="attention">
      <s-stack direction="block" gap="base">
        <RowNote>{t("combine.mismatch.intro")}</RowNote>
        {mismatches.map((m) => (
          <Finding
            key={m.id}
            marker={{ "data-won-mismatch": m.id }}
            what={mismatchText(m, tr)}
            how={
              m.allowNew > 0 || m.denyNew > 0 ? (
                <>
                  {m.allowNew > 0 ? <div>{tr.tp("combine.mismatch.newAllow", m.allowNew)}</div> : null}
                  {m.denyNew > 0 ? <div>{tr.tp("combine.mismatch.newDeny", m.denyNew)}</div> : null}
                </>
              ) : undefined
            }
            actions={
              <>
                <FixButton id={m.id} mode="allow" configVersion={configVersion} label={t("combine.mismatch.allow")} variant="primary" />
                <FixButton id={m.id} mode="deny" configVersion={configVersion} label={t("combine.mismatch.deny")} variant="secondary" />
                <s-button href={m.href} variant="tertiary">
                  {t("combine.mismatch.open")}
                </s-button>
              </>
            }
          />
        ))}
      </s-stack>
    </WonSection>
  );
}
