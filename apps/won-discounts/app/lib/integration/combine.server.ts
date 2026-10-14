// "Sčítá se s" outside a rule's editor:
//   combineAction(ctx, form)        /app/combine — `intent=save`: a module's one list (Množstevní slevy, Milníky,
//                                   Výprodej; `modules.<module>.combine.types`, only what it is offered);
//                                   `intent=fix`: one mismatch set straight in one save (core fixCombineMismatch).
//   mismatchViews                   re-exported from components/model/combine-mismatch.ts (pure).
// The form is parsed here (SEC-1); every save goes through saveConfigSection (F12, the lock, the sync).

import { fixCombineMismatch } from "@won/core/discounts/combine-config";
import type { WonDiscountsConfig } from "@won/core/discounts/config";

import { MODULE_COMBINE_FIELD, MODULE_COMBINE_INTENT, readCombineModule, readCombineTypes } from "../../components/model/combine";
import { MISMATCH_FIELD, MISMATCH_INTENT } from "../../components/model/combine-mismatch";

export { mismatchViews } from "../../components/model/combine-mismatch";
import type { FormDataLike } from "../../components/model/rule-form";
import type { UiResult } from "../../components/model/types";
import type { ShopCtx } from "./context.server";
import { readSaveOptions, saveConfigSection } from "./settings.server";
import { ctxPlan } from "./sync-status.server";

export async function combineAction(ctx: ShopCtx, form: FormDataLike): Promise<UiResult> {
  if (form.get(MISMATCH_FIELD.intent) === MISMATCH_INTENT) return fixAction(ctx, form);
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

/** Every list of the shop: what a fix may touch (F12 compares these). */
const everyList = (config: WonDiscountsConfig) => ({
  rules: config.modules.codes.rules.map((r) => [r.id, r.combine ?? null]),
  tiers: config.modules.tiers.combine,
  rewards: config.modules.rewards.combine,
  outlet: config.modules.outlet.combine,
});

async function fixAction(ctx: ShopCtx, form: FormDataLike): Promise<UiResult> {
  const id = form.get(MISMATCH_FIELD.id);
  const mode = form.get(MISMATCH_FIELD.mode);
  if (typeof id !== "string" || !id || (mode !== "allow" && mode !== "deny")) return { ok: false, reason: "bad_request" };
  const plan = await ctxPlan(ctx);
  return saveConfigSection(ctx, {
    ...readSaveOptions(form),
    path: "combine",
    pick: everyList,
    // The exceptions only where the plan runs them (BILL-1): on Free a fix changes types.
    apply: (config) => fixCombineMismatch(config, id, mode, { exceptions: plan === "pro" }),
  });
}
