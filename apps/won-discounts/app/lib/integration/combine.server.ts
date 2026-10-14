// "Sčítá se s" of a module (Množstevní slevy, Milníky, Výprodej): its one list, `modules.<module>.combine.types`.
// Every module's page posts it to /app/combine (shell/ModuleCombine); the form is parsed here (SEC-1), the
// list keeps only what the module is offered (COMBINE_OFFERED) and is saved through saveConfigSection.

import { MODULE_COMBINE_FIELD, MODULE_COMBINE_INTENT, readCombineModule, readCombineTypes } from "../../components/model/combine";
import type { FormDataLike } from "../../components/model/rule-form";
import type { UiResult } from "../../components/model/types";
import type { ShopCtx } from "./context.server";
import { readSaveOptions, saveConfigSection } from "./settings.server";

export async function combineAction(ctx: ShopCtx, form: FormDataLike): Promise<UiResult> {
  const module = readCombineModule(form);
  const types = module ? readCombineTypes(form, module) : null;
  if (form.get(MODULE_COMBINE_FIELD.intent) !== MODULE_COMBINE_INTENT.save || !module || !types) return { ok: false, reason: "bad_request" };
  return saveConfigSection(ctx, {
    ...readSaveOptions(form),
    path: `modules.${module}.combine`,
    pick: (config) => config.modules[module].combine,
    apply: (config) => ({ ...config, modules: { ...config.modules, [module]: { ...config.modules[module], combine: { types } } } }),
  });
}
