// What a sync did, for the merchant (§4c, §12): the sync layer records steps
// with stable machine keys and one-line technical details (app/lib/sync
// SyncStep, English); this module turns the FAILED ones into sentences in the
// admin language — which rule did not reach Shopify, what that means at
// checkout — with the technical detail kept in parentheses (never hidden).
// The sentences are UiText (i18n key + params): the screen words them in the
// page's language. Pure; unit tested (tests/integration/sync-copy.test.ts).

import { CONFIG_LIMITS } from "@won/core/discounts/config";

import { MAX_COLLECTION_PRODUCTS } from "../sync/products";
import type { SyncStep } from "../sync/types";
import type { SyncOutcomeView, UiText } from "../../components/model/types";

/** Technical details are shown shortened (they can carry whole GraphQL error lists). */
const DETAIL_MAX = 180;

export function shortDetail(detail: string): string {
  const text = detail.replace(/\s+/g, " ").trim();
  return text.length > DETAIL_MAX ? `${text.slice(0, DETAIL_MAX - 1)}…` : text;
}

/** The Won node key a step is about ("auto" | "code:<ruleId>"), or null. */
export function stepNodeKey(step: string): string | null {
  const m = /^(?:node\.[a-z]+|codes(?:\.[a-z]+)?):(auto|code:.+)$/.exec(step);
  return m ? m[1] : null;
}

/** The rule id of a code node key. */
export function ruleIdOfKey(key: string): string | null {
  return key.startsWith("code:") ? key.slice("code:".length) : null;
}

function ruleLabel(ruleId: string, names: ReadonlyMap<string, string>): string {
  const name = names.get(ruleId)?.trim();
  return name || ruleId;
}

/**
 * A rule's too-large collections as a step records them: `{collection: first title, count}` (audit fix
 * round 3), or — runs recorded before it — `{collections: "A, B" (titles joined), untitled: n}`.
 */
function tooLargeCollections(params: SyncStep["params"]): { collection: string; count: number } {
  const joined = params?.collections;
  const untitled = params?.untitled;
  if (typeof joined === "string" || typeof untitled === "number") {
    const titles = typeof joined === "string" && joined.trim() !== "" ? joined.split(", ") : [];
    return { collection: titles[0] ?? "", count: Math.max(1, titles.length + (typeof untitled === "number" ? untitled : 0)) };
  }
  return {
    collection: typeof params?.collection === "string" ? params.collection : "",
    count: typeof params?.count === "number" ? params.count : 1,
  };
}

function numberParam(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** One failed step → one sentence. */
export function stepProblem(step: SyncStep, names: ReadonlyMap<string, string>): UiText {
  const detail = shortDetail(step.detail);
  const key = stepNodeKey(step.step);
  if (key !== null) {
    const ruleId = ruleIdOfKey(key);
    if (ruleId === null) return { key: "sync.problem.automatic", params: { detail } };
    const rule = ruleLabel(ruleId, names);
    if (/still running/i.test(step.detail)) return { key: "sync.problem.codesRunning", params: { rule } };
    if (/unique|already (?:exists|taken|in use)|has already been taken/i.test(step.detail)) {
      return { key: "sync.problem.codeTaken", params: { rule, detail } };
    }
    return { key: "sync.problem.rule", params: { rule, detail } };
  }
  if (step.step.startsWith("products.too_large:")) {
    // Titles from the size read (products.ts collectionLimits), never GIDs; else "kolekce bez názvu".
    const rule = ruleLabel(step.step.slice("products.too_large:".length), names);
    const { collection, count } = tooLargeCollections(step.params);
    if (!collection) return { key: "sync.problem.collectionTooLargeUntitled", params: { rule, limit: MAX_COLLECTION_PRODUCTS } };
    return count > 1
      ? { key: "sync.problem.collectionTooLargeMany", params: { rule, collection, n: count - 1, limit: MAX_COLLECTION_PRODUCTS } }
      : { key: "sync.problem.collectionTooLarge", params: { rule, collection, limit: MAX_COLLECTION_PRODUCTS } };
  }
  if (step.step.startsWith("tiers.too_large:")) {
    // MVP 3: a Pro tier set's collections over the read limit (products.ts; params {collection: first title, count:
    // collections}) — its products get the whole-store set instead. Never the set id, never a GID.
    const { collection, count } = tooLargeCollections(step.params);
    const limit = MAX_COLLECTION_PRODUCTS;
    if (!collection) return { key: "sync.problem.tiersTooLargeUntitled", params: { limit } };
    return count > 1
      ? { key: "sync.problem.tiersTooLargeMany", params: { collection, n: count - 1, limit } }
      : { key: "sync.problem.tiersTooLarge", params: { collection, limit } };
  }
  if (step.step === "margin.too_large") {
    // The collection's title and size (products.ts collectionLimits): the stricter value applies to the whole store.
    // An exact count is ≤ 10 000 (Shopify counts exactly only up to it): the margin collections read first used the budget.
    const collection = typeof step.params?.collection === "string" ? step.params.collection : "";
    const count = typeof step.params?.count === "number" ? step.params.count : null;
    const limit = MAX_COLLECTION_PRODUCTS;
    if (!collection) {
      return count === null
        ? { key: "sync.problem.marginTooLargeUncountedUntitled", params: { limit } }
        : { key: "sync.problem.marginTooLargeUntitled", params: { count, limit } };
    }
    return count === null
      ? { key: "sync.problem.marginTooLargeUncounted", params: { collection, limit } }
      : { key: "sync.problem.marginTooLarge", params: { collection, count, limit } };
  }
  switch (step.step) {
    case "shop.read":
      return { key: "sync.problem.shopRead", params: { detail } };
    case "shop.currency":
      return { key: "sync.problem.currency" };
    case "shop_config.build": {
      // The tiers over their own cap (CONFIG_LIMITS.tierPayloadBytes, MVP 3 audit): the sync records the tier part's
      // bytes and budget (params `tiersBytes` / `tiersBudget`, or a detail naming the tiers) — said as a share, never bytes.
      const bytes = numberParam(step.params?.tiersBytes ?? step.params?.tierBytes);
      const budget = numberParam(step.params?.tiersBudget ?? step.params?.tierBudget) ?? CONFIG_LIMITS.tierPayloadBytes;
      if (bytes !== null && bytes > budget) return { key: "sync.problem.tiersOverCapPercent", params: { percent: Math.ceil((bytes * 100) / budget) } };
      if (/\btiers?\b/i.test(step.detail)) return { key: "sync.problem.tiersOverCap" };
      return { key: "sync.problem.tooLarge" };
    }
    case "shop_config.phase1.build":
      // Over the 9 000 B budget even folded to the global values (sync.server.ts phaseOnePayload): retrying
      // alone will not fit it — own sentence, never "the next sync finishes it" (audit fix round 5).
      return { key: "sync.problem.phase1TooLarge", params: { detail } };
    case "sync.stopped":
    case "shop_config.phase1.write":
    case "shop_config.phase1.verify":
    case "shop_config.phase1.rollback":
      return { key: "sync.problem.campaignHeld", params: { detail } };
    case "shop_config.write":
      if (/campaign switch/i.test(step.detail)) return { key: "sync.problem.campaignHeld", params: { detail } };
      // Held behind the products (sync.server.ts HOLD_DETAIL): why, in the admin's words.
      if (step.params?.held === "margin_refs") return { key: "sync.problem.configHeldMargin" };
      if (step.params?.held === "rule_refs") return { key: "sync.problem.configHeldRules" };
      if (step.params?.held === "products_unread") return { key: "sync.problem.configHeldProducts" };
      if (step.params?.held === "products_refused") return { key: "sync.problem.configHeldRefused" };
      return { key: "sync.problem.config", params: { detail } };
    case "shop_config.verify":
      return { key: "sync.problem.config", params: { detail } };
    case "shop_config.rollback":
      return /no valid previous config|could not restore/i.test(step.detail)
        ? { key: "sync.problem.configLost", params: { detail } }
        : { key: "sync.problem.config", params: { detail } };
    case "storefront_config.write":
    case "storefront_config.verify":
      // MVP 3 (sync/storefront.ts): the product-page table's settings (app-data metafield) — never fatal, checkout unaffected.
      return { key: "sync.problem.storefrontConfig", params: { detail } };
    case "products.tiers": {
      // MVP 3: the products' tier set (`tierRef`) written after the flip; the detail can carry product GIDs — never shown.
      const refused = typeof step.params?.refused === "number" && step.params.refused > 0 ? step.params.refused : null;
      return refused !== null ? { key: "sync.problem.productsTiersRefused", params: { n: refused } } : { key: "sync.problem.productsTiers" };
    }
    case "products.membership":
      // The live config's membership of some products could not be read (products.ts, audit fix round 4): the
      // config is held for their margin collections. Own sentence (audit fix round 5): this is a READ failure,
      // not the "could not write" story configHeldMargin tells — never reuse it here.
      return { key: "sync.problem.membershipReadFailed" };
    case "products.prune":
      // Bridges left after the flip: never a looser floor (the same one applies), retried by the next sync.
      return { key: "sync.problem.productsPrune" };
    case "products":
    case "products.set":
    case "products.clear":
    case "products.add":
    case "products.index":
      // Products Shopify refused one by one (products.ts sendProductWrites): counted, never listed by id. After the
      // breaker tripped (refused batches no longer split) no "the other products were written" (audit fix round 4).
      if (typeof step.params?.refused === "number" && step.params.refused > 0) {
        return { key: step.params.breaker ? "sync.problem.productsRefusedBreaker" : "sync.problem.productsRefused", params: { n: step.params.refused } };
      }
      return { key: "sync.problem.products", params: { detail } };
    case "nodes":
      return { key: "sync.problem.nodes", params: { detail } };
    default:
      return { key: "sync.problem.other", params: { detail } };
  }
}

function dedupe(texts: UiText[]): UiText[] {
  const seen = new Set<string>();
  return texts.filter((text) => {
    const id = JSON.stringify([text.key, text.params ?? {}]);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/** Every failed step as a sentence (in step order, duplicates dropped). */
export function syncProblems(steps: readonly SyncStep[], names: ReadonlyMap<string, string>): UiText[] {
  return dedupe(steps.filter((step) => !step.ok).map((step) => stepProblem(step, names)));
}

/** Steps that went through but the merchant should know about (the sync marks them `warning`). */
export function stepWarnings(steps: readonly SyncStep[]): UiText[] {
  return dedupe(
    steps
      .filter((step) => step.ok && step.warning)
      .map((step): UiText =>
        step.step === "products.oversized"
          ? { key: "sync.warning.oversized", params: { detail: shortDetail(step.detail) } }
          : { key: "sync.warning.other", params: { detail: shortDetail(step.detail) } },
      ),
  );
}

/** saveAndSync / resync `warnings` (English one-liners from the sync layer) → sentences. */
export function saveWarnings(warnings: readonly string[]): UiText[] {
  return dedupe(
    warnings.map((warning): UiText => {
      if (/time zone/i.test(warning)) return { key: "sync.warning.timezone" };
      if (/native discount codes/i.test(warning)) return { key: "sync.warning.nativeCodes" };
      if (/read_markets scope is not granted/i.test(warning)) return { key: "sync.warning.marketsScope" };
      if (/market countries changed/i.test(warning)) return { key: "sync.warning.marketsChanged" };
      if (/markets/i.test(warning)) return { key: "sync.warning.markets" };
      return { key: "sync.warning.other", params: { detail: shortDetail(warning) } };
    }),
  );
}

/** A finished sync (or resync) as the result banner shows it. */
export function syncOutcome(
  sync: { ok: boolean; steps: readonly SyncStep[] },
  warnings: readonly string[],
  names: ReadonlyMap<string, string>,
): SyncOutcomeView {
  return {
    ok: sync.ok,
    problems: syncProblems(sync.steps, names),
    warnings: [...stepWarnings(sync.steps), ...saveWarnings(warnings)],
  };
}

/** Rule id → name, for the sentences. */
export function ruleNames(config: { modules: { codes: { rules: readonly { id: string; name: string }[] } } }): Map<string, string> {
  return new Map(config.modules.codes.rules.map((rule) => [rule.id, rule.name]));
}

/** Did this run leave the shop function config APPLIED? (the sync layer's own fact, app/lib/sync/runs.ts) */
export { shopConfigApplied } from "../sync/runs";
