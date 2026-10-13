// "Sčítá se s": one checkbox per type of discount the owner of the list can meet (model/combine.ts; the rule is
// @won/core combine.ts). The same control in the rule editor, on Množstevní slevy, Milníky and Výprodej, and for
// the default list in Nastavení. It posts the ticked types and a marker that the list was in the form, so the
// server tells "none ticked" from "not posted" (it parses the form again, SEC-1).

import { useT } from "../../i18n/context";
import { COMBINE_FIELD, COMBINE_OFFERED, combineTypeLabel, type CombineOwner, type CombineType } from "../model/combine";
import { boolAttr } from "./attrs";

export function CombineTypes({ owner, checked, disabled = false }: { owner: CombineOwner; checked: readonly CombineType[]; disabled?: boolean }) {
  const tr = useT();
  return (
    <s-stack direction="block" gap="small-200">
      <input type="hidden" name={COMBINE_FIELD.posted} value="1" />
      {COMBINE_OFFERED[owner].map((type) => (
        <s-checkbox key={type} name={COMBINE_FIELD.types} value={type} label={combineTypeLabel(type, tr)} checked={boolAttr(checked.includes(type))} disabled={boolAttr(disabled)} />
      ))}
    </s-stack>
  );
}
