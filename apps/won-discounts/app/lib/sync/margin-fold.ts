// What checkout runs when a margin collection is too large to read (MVP 2
// audit P1-1, fix round 2): the sync folds such a collection's values into
// the payload's global values and into every other collection's own values
// (products.ts collectionLimits / foldMarginCollections). Everything else that
// judges a floor outside the payload must use the SAME folded settings — the
// cost mirror's keep/delete decision after a refused write (cost-lane), Try
// Cart, the impact overview and the rule editor's note — so what the admin
// says and what checkout does never differ. The collections come from the run
// that APPLIED the live shop config (runs.ts appliedRun — audit fix round 3):
// what checkout runs, never a newer products-only refresh that did not write
// the payload, nor a campaign switch's phase 1 (it keeps the live margin part:
// audit fix round 4). A refresh whose limits differ from the live fold escalates to
// a full sync (sync.server.ts), so the two meet again.

import type { WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import { foldMarginCollections } from "./products";
import { appliedRun } from "./runs";
import type { SyncStep } from "./types";

/** A margin collection the last product pass could not read. */
export interface MarginTooLargeFact {
  collectionId: string;
  /** Its Shopify title at the sync ("" when unknown). */
  title: string;
  /** Products in it; null = Shopify only counted "at least 10 000". */
  count: number | null;
}

/** The margin collections a run's steps report too large to read (folded into the payload that run built). */
export function foldedIn(steps: readonly SyncStep[]): MarginTooLargeFact[] {
  return steps
    .filter((step) => step.step === "margin.too_large" && typeof step.params?.collectionId === "string")
    .map((step) => ({
      collectionId: String(step.params!.collectionId),
      title: typeof step.params?.collection === "string" ? step.params.collection : "",
      count: typeof step.params?.count === "number" ? step.params.count : null,
    }));
}

/**
 * The margin collections the LIVE shop config folds: those the run that
 * applied it reported too large ([] when none, or nothing applied yet).
 */
export async function marginTooLargeOf(db: PrismaClient, shop: string): Promise<MarginTooLargeFact[]> {
  const run = await appliedRun(db, shop);
  return run ? foldedIn(run.steps) : [];
}

/** The gated config as checkout runs it: the collections too large to read folded in (unchanged when none). */
export function withTooLargeFolded<T extends WonDiscountsConfig>(config: T, tooLarge: readonly Pick<MarginTooLargeFact, "collectionId">[]): T {
  if (tooLarge.length === 0) return config;
  return foldMarginCollections(config, new Set(tooLarge.map((c) => c.collectionId))) as T;
}

/** The gated config as checkout runs it, reading the too-large collections for it (one bounded query). */
export async function foldedForCheckout<T extends WonDiscountsConfig>(db: PrismaClient, shop: string, gated: T): Promise<T> {
  if (gated.modules.margin.perCollection.length === 0) return gated;
  return withTooLargeFolded(gated, await marginTooLargeOf(db, shop));
}
