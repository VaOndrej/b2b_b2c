// saveConfig / saveAndSync outcomes → the admin's typed results (pure).

import type { SaveConfigResult } from "../config.server";
import { SHOPIFY_MAX_ACTIVE_DISCOUNT_FUNCTIONS } from "../config-guards.server";
import type { UiFailure } from "../../components/model/types";

/** Every refusal saveConfig can give → the UI's typed failure (each has its own copy + fix, result-copy.ts). */
export function uiFailureFromSave(res: Exclude<SaveConfigResult, { ok: true }>): UiFailure {
  switch (res.reason) {
    case "too_many_code_rules":
      return { ok: false, reason: "too_many_code_rules", count: res.count, limit: res.limit, shopifyLimit: SHOPIFY_MAX_ACTIVE_DISCOUNT_FUNCTIONS };
    case "code_hash_collision":
      return { ok: false, reason: "code_hash_collision", codes: res.collisions.map((group) => [...group]) };
    case "function_config_too_large":
      return { ok: false, reason: "function_config_too_large", bytes: res.bytes, budget: res.budget };
    case "config_too_large":
      return { ok: false, reason: "config_too_large", bytes: res.bytes, limit: res.limit };
    case "newer_schema":
      return { ok: false, reason: "newer_schema" };
    case "unreadable_config":
      return { ok: false, reason: "unreadable_config" };
    default:
      return { ok: false, reason: "error" };
  }
}
