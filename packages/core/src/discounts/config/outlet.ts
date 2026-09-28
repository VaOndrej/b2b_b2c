import { DEFAULT_CONFIG } from "./defaults.ts";
import { OUTLET_DISPLAY_MODES, REOPEN_ON_RETURN_MODES } from "./enums.ts";
import { isRecord, sanitizeEnum } from "./sanitize-helpers.ts";
import type { ConfigIssue, OutletModule } from "./types.ts";

export function sanitizeOutlet(v: unknown, issues: ConfigIssue[]): OutletModule {
  const def = DEFAULT_CONFIG.modules.outlet;
  const rec = isRecord(v) ? v : {};
  return {
    display: sanitizeEnum(rec.display, OUTLET_DISPLAY_MODES, def.display, "modules.outlet.display", issues),
    reopenOnReturnAfterEnd: sanitizeEnum(
      rec.reopenOnReturnAfterEnd,
      REOPEN_ON_RETURN_MODES,
      def.reopenOnReturnAfterEnd,
      "modules.outlet.reopenOnReturnAfterEnd",
      issues,
    ),
  };
}
