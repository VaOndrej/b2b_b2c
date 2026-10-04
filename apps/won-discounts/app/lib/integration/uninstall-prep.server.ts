// „Připravit na odinstalaci“ (MVP 7, contract M3; mezery A7, decision P4). After an uninstall the app has no access
// and can put nothing back, so BEFORE it the merchant gets one button that
//   1. ends every sale (Výprodej) that is not ended — the prices go back from the sale's own backup (endOutletRun);
//   2. restores every Shopify discount the app moved into Won from its backup (the existing undo).
// Won's own discounts and settings are left alone: Shopify removes the app's discounts with the app.
//   planUninstallPrep(ctx)  what the button would do — read-only, shown before the click;
//   runUninstallPrep(ctx)   does it, one item after another; a failure never stops the rest and is listed.
// Works on any plan (leaving must never need Pro). The session shop only (SEC-2).

import { errorText } from "../sync/transport";
import type { ShopCtx } from "./context.server";
import { undoNativeDiscount } from "./native.server";
import { endOutletRun, OUTLET_NOT_ENDED, type OutletDeps } from "./outlet.server";
import { ctxPlan } from "./sync-status.server";

export interface UninstallPrepPlan {
  /** Sales that would be ended (their prices restored): the variant's GID and the sale's id. */
  outlets: { id: string; variantId: string }[];
  /** Moved Shopify discounts that would be restored. */
  natives: { id: string; title: string }[];
}

export interface UninstallPrepResult {
  ended: number;
  restored: number;
  failed: { what: "outlet" | "native"; id: string; detail: string }[];
}

/** Test seams: the two operations (default: the app's own). */
export interface UninstallPrepDeps {
  endOutlet?: (ctx: ShopCtx, runId: string) => Promise<{ ok: true } | { ok: false; detail: string }>;
  restoreNative?: (ctx: ShopCtx, backupId: string) => Promise<{ ok: true } | { ok: false; detail: string }>;
}

export async function planUninstallPrep(ctx: Pick<ShopCtx, "db" | "shop">): Promise<UninstallPrepPlan> {
  const [outlets, natives] = await Promise.all([
    ctx.db.outletRun.findMany({ where: { shop: ctx.shop, status: { in: [...OUTLET_NOT_ENDED] } }, orderBy: { createdAt: "asc" }, select: { id: true, variantId: true } }),
    ctx.db.nativeDiscountBackup.findMany({ where: { shop: ctx.shop, status: "moved" }, orderBy: { createdAt: "asc" }, select: { id: true, title: true } }),
  ]);
  return { outlets, natives };
}

const outletDeps = (ctx: ShopCtx): OutletDeps => ({
  shop: ctx.shop,
  db: ctx.db,
  client: ctx.client,
  plan: () => ctxPlan(ctx),
  ...(ctx.now ? { now: ctx.now } : {}),
  ...(ctx.logger ? { logger: ctx.logger } : {}),
});

async function defaultEndOutlet(ctx: ShopCtx, runId: string) {
  const result = await endOutletRun(outletDeps(ctx), runId, "manual");
  if (result.ok) return { ok: true as const };
  return { ok: false as const, detail: result.reason === "failed" ? result.message : "invalid" };
}

async function defaultRestoreNative(ctx: ShopCtx, backupId: string) {
  const result = await undoNativeDiscount(ctx, backupId);
  if (result.ok) return { ok: true as const };
  return { ok: false as const, detail: "message" in result && typeof result.message === "string" ? result.message : result.reason };
}

export async function runUninstallPrep(ctx: ShopCtx, deps: UninstallPrepDeps = {}): Promise<UninstallPrepResult> {
  const plan = await planUninstallPrep(ctx);
  const out: UninstallPrepResult = { ended: 0, restored: 0, failed: [] };
  const step = async (what: "outlet" | "native", id: string, run: () => Promise<{ ok: true } | { ok: false; detail: string }>) => {
    try {
      const result = await run();
      if (result.ok) out[what === "outlet" ? "ended" : "restored"] += 1;
      else out.failed.push({ what, id, detail: result.detail });
    } catch (error) {
      // A re-auth Response must reach the route; anything else is this item's failure.
      if (error instanceof Response) throw error;
      out.failed.push({ what, id, detail: errorText(error) });
    }
  };
  // Prices first: a sale left running after the uninstall leaves a wrong price in the store for good.
  for (const run of plan.outlets) await step("outlet", run.id, () => (deps.endOutlet ?? defaultEndOutlet)(ctx, run.id));
  for (const backup of plan.natives) await step("native", backup.id, () => (deps.restoreNative ?? defaultRestoreNative)(ctx, backup.id));
  return out;
}
