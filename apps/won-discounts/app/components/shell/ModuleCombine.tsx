// "Sčítá se s" of a module (Množstevní slevy, Milníky, Výprodej): its one list, saved on its own to /app/combine
// (lib/integration/combine.server.ts), so it never mixes with the page's own form. The checkboxes are the rule
// editor's (CombineTypes); the state sentence is combineSummary's.

import { useFetcher } from "react-router";

import { useT } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import { combineSummary, MODULE_COMBINE_FIELD, MODULE_COMBINE_INTENT, type CombineModule, type CombineType } from "../model/combine";
import type { UiResult } from "../model/types";
import { boolAttr } from "./attrs";
import { CombineTypes } from "./CombineTypes";
import { useFormActions } from "./form-actions";
import { Notice } from "./Notice";
import { RowNote, WonRow, WonSection } from "./WonSection";

export function ModuleCombine({ module, stored, configVersion }: { module: CombineModule; stored: readonly CombineType[]; configVersion: string | null }) {
  const tr = useT();
  const { t } = tr;
  const fetcher = useFetcher<UiResult>();
  const actions = useFormActions();
  const summary = combineSummary(stored, tr);
  return (
    <WonSection title={t("combine.title")} glyph="sliders" anchor="combine-types" summary={summary.charAt(0).toUpperCase() + summary.slice(1)}>
      <fetcher.Form method="post" action={actions.combine} data-won-module-combine={module}>
        <input type="hidden" name={MODULE_COMBINE_FIELD.intent} value={MODULE_COMBINE_INTENT.save} />
        <input type="hidden" name={MODULE_COMBINE_FIELD.module} value={module} />
        {configVersion ? <input type="hidden" name={MODULE_COMBINE_FIELD.configVersion} value={configVersion} /> : null}
        <s-stack direction="block" gap="base">
          {fetcher.data ? <Notice result={fetcher.data} /> : null}
          <WonRow>
            <s-stack direction="block" gap="small-200">
              <RowNote>{t(`combine.module.intro.${module}` as MessageKey)}</RowNote>
              <CombineTypes owner={module} checked={stored} />
            </s-stack>
          </WonRow>
          <div>
            <s-button type="submit" variant="primary" disabled={boolAttr(fetcher.state !== "idle")}>
              {t("combine.module.save")}
            </s-button>
          </div>
        </s-stack>
      </fetcher.Form>
    </WonSection>
  );
}
