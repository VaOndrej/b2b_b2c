import { DEFAULT_CONFIG } from "./defaults.ts";
import { PRODUCT_WITH_PRODUCT_MODES } from "./enums.ts";
import { isRecord, sanitizeBoolWithIssue, sanitizeEnum } from "./sanitize-helpers.ts";
import type { ConfigIssue, EngineSettings } from "./types.ts";

export function sanitizeEngine(v: unknown, issues: ConfigIssue[]): EngineSettings {
  const def = DEFAULT_CONFIG.engine.combination;
  const c = isRecord(v) && isRecord(v.combination) ? v.combination : {};
  return {
    ...(isRecord(v) && v.unknownMarketLowest === true ? { unknownMarketLowest: true as const } : {}),
    combination: {
      outletWithAnything: sanitizeBoolWithIssue(
        c.outletWithAnything,
        def.outletWithAnything,
        "engine.combination.outletWithAnything",
        issues,
      ),
      productWithProduct: sanitizeEnum(
        c.productWithProduct,
        PRODUCT_WITH_PRODUCT_MODES,
        def.productWithProduct,
        "engine.combination.productWithProduct",
        issues,
      ),
      productWithOrder: sanitizeBoolWithIssue(
        c.productWithOrder,
        def.productWithOrder,
        "engine.combination.productWithOrder",
        issues,
      ),
      productWithShipping: sanitizeBoolWithIssue(
        c.productWithShipping,
        def.productWithShipping,
        "engine.combination.productWithShipping",
        issues,
      ),
      orderWithShipping: sanitizeBoolWithIssue(
        c.orderWithShipping,
        def.orderWithShipping,
        "engine.combination.orderWithShipping",
        issues,
      ),
    },
  };
}
