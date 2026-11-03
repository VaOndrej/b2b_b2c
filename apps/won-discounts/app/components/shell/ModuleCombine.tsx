// "Sčítá se s" of a module (Množstevní slevy, Milníky, Výprodej): its one list, stored by /app/combine
// (lib/integration/combine.server.ts). The checkboxes are the rule editor's (CombineTypes); the state sentence is
// combineSummary's.
// It is a part of the page's one form (shell/one-save.tsx): no form, no button; its fields are prefixed and the page's
// Save posts them to /app/combine with the hidden fields combinePart() lists.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useT } from "../../i18n/context";
import type { MessageKey } from "../../i18n";
import { COMBINE_ACTION, COMBINE_FIELD, COMBINE_OFFERED, combineSummary, MODULE_COMBINE_FIELD, MODULE_COMBINE_INTENT, type CombineModule, type CombineType } from "../model/combine";
import { partField } from "../model/one-save";
import { CombineTypes } from "./CombineTypes";
import type { SavePart } from "./one-save";
import { RowNote, WonRow, WonSection } from "./WonSection";

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

/**
 * `form`: the page's form when the section sits OUTSIDE it (Milníky: under the preview, which must stay outside the
 * form). The checkboxes then have no name; what they hold is kept in hidden fields inside the form (a portal), and the
 * form is told of every change, the way the page's other outside controls do it. Remount it on the page's Discard.
 */
export function CombinePart({ module, stored, form }: { module: CombineModule; stored: readonly CombineType[]; form?: HTMLFormElement | null }) {
  const tr = useT();
  const { t } = tr;
  const summary = combineSummary(stored, tr);
  const name = (field: string) => partField(COMBINE_PART, field);
  const outside = form !== undefined;
  const [types, setTypes] = useState<readonly CombineType[]>(stored);
  const listRef = useRef<HTMLDivElement>(null);
  const told = useRef(stored);
  useEffect(() => {
    const list = listRef.current;
    if (!outside || !list) return;
    const read = () => setTypes(COMBINE_OFFERED[module].filter((type) => list.querySelector<HTMLElement & { checked?: boolean }>(`s-checkbox[value="${type}"]`)?.checked === true));
    list.addEventListener("change", read);
    return () => list.removeEventListener("change", read);
  }, [module, outside]);
  useEffect(() => {
    if (!outside || told.current === types) return;
    told.current = types;
    form?.dispatchEvent(new Event("change", { bubbles: true }));
  }, [form, outside, types]);
  return (
    <WonSection title={t("combine.title")} glyph="sliders" anchor="combine-types" summary={summary.charAt(0).toUpperCase() + summary.slice(1)}>
      <div ref={listRef} data-won-module-combine={module} data-won-save-part={COMBINE_PART}>
        <WonRow>
          <s-stack direction="block" gap="small-200">
            <RowNote>{t(`combine.module.intro.${module}` as MessageKey)}</RowNote>
            <CombineTypes owner={module} checked={stored} name={outside ? () => "" : name} />
          </s-stack>
        </WonRow>
      </div>
      {outside && form
        ? createPortal(
            <div hidden data-won-save-part-fields={COMBINE_PART}>
              <input type="hidden" name={name(COMBINE_FIELD.posted)} value="1" />
              {types.map((type) => (
                <input key={type} type="hidden" name={name(COMBINE_FIELD.types)} value={type} />
              ))}
            </div>,
            form,
          )
        : null}
    </WonSection>
  );
}
