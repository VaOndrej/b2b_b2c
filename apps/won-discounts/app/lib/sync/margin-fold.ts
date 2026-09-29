// What checkout runs when a margin collection is too large to read (MVP 2
// audit P1-1, fix round 2): the sync folds such a collection's values into
// the payload's global values and into every other collection's own values
// (products.ts collectionLimits / foldMarginCollections). Everything else that
// judges a floor outside the payload must use the SAME folded settings — the
// cost mirror's keep/delete decision after a refused write (cost-lane), Try
// Cart, the impact overview and the rule editor's note — so what the admin
// says and what checkout does never differ. The collections come from the
// newest recorded run that planned the products.

import type { WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../generated/prisma/client";
import { foldMarginCollections } from "./products";
import { parseSteps } from "./runs";

/** A margin collection the last product pass could not read. */
export interface MarginTooLargeFact {
  collectionId: string;
  /** Its Shopify title at the sync ("" when unknown). */
  title: string;
  /** Products in it; null = Shopify only counted "at least 10 000". */
  count: number | null;
}

/**
 * The margin collections the newest run that PLANNED the products could not
 * read ([] when none, or when no such run is recorded). A background
 * additions lane or a failed shop read plans nothing and is skipped.
 */
export async function marginTooLargeOf(db: PrismaClient, shop: string): Promise<MarginTooLargeFact[]> {
  const runs = await db.syncRun.findMany({ where: { shop }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 20, select: { steps: true } });
  for (const run of runs) {
    const steps = parseSteps(run.steps);
    if (!steps.some((step) => step.step === "products.scope" || step.step === "products" || step.step === "margin.too_large")) continue;
    return steps
      .filter((step) => step.step === "margin.too_large" && typeof step.params?.collectionId === "string")
      .map((step) => ({
        collectionId: String(step.params!.collectionId),
        title: typeof step.params?.collection === "string" ? step.params.collection : "",
        count: typeof step.params?.count === "number" ? step.params.count : null,
      }));
  }
  return [];
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
