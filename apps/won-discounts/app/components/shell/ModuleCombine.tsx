// "Sčítá se s" of a module (Množstevní slevy, Milníky, Výprodej): its one list, stored by /app/combine
// (lib/integration/combine.server.ts). The checkboxes are the rule editor's (CombineTypes); the state sentence is
// combineSummary's.
//   - ModuleCombine: its own form with its own Save (pages not on the one save yet).
//   - CombinePart: a part of the page's one form (shell/one-save.tsx): no form, no button; its fields are prefixed and
//     the page's Save posts them to /app/combine with the hidden fields combinePart() lists.

import { useFetcher } from "react-router";

import { useT } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import { COMBINE_ACTION, combineSummary, MODULE_COMBINE_FIELD, MODULE_COMBINE_INTENT, type CombineModule, type CombineType } from "../model/combine";
import { partField } from "../model/one-save";
import type { UiResult } from "../model/types";
import { boolAttr } from "./attrs";
import { CombineTypes } from "./CombineTypes";
import { useFormActions } from "./form-actions";
import { Notice } from "./Notice";
import type { SavePart } from "./one-save";
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

/** The key of Sčítá se s among a page's parts. */
export const COMBINE_PART = "combine";

/** How the page's one save posts Sčítá se s: what its own form posted around the list. */
export function combinePart(module: CombineModule, configVersion: string | null, action: string = COMBINE_ACTION): SavePart {
  return {
    key: COMBINE_PART,
    action,
    extra: { [MODULE_COMBINE_FIELD.intent]: MODULE_COMBINE_INTENT.save, [MODULE_COMBINE_FIELD.module]: module, ...(configVersion ? { [MODULE_COMBINE_FIELD.configVersion]: configVersion } : {}) },
    label: "combine.title",
  };
}

export function CombinePart({ module, stored }: { module: CombineModule; stored: readonly CombineType[] }) {
  const tr = useT();
  const { t } = tr;
  const summary = combineSummary(stored, tr);
  return (
    <WonSection title={t("combine.title")} glyph="sliders" anchor="combine-types" summary={summary.charAt(0).toUpperCase() + summary.slice(1)}>
      <div data-won-module-combine={module} data-won-save-part={COMBINE_PART}>
        <WonRow>
          <s-stack direction="block" gap="small-200">
            <RowNote>{t(`combine.module.intro.${module}` as MessageKey)}</RowNote>
            <CombineTypes owner={module} checked={stored} name={(field) => partField(COMBINE_PART, field)} />
          </s-stack>
        </WonRow>
      </div>
    </WonSection>
  );
}
