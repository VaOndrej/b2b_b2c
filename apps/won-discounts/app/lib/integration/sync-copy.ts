// What a sync did, for the merchant (§4c, §12): the sync layer records steps
// with stable machine keys and one-line technical details (app/lib/sync
// SyncStep, English); this module turns the FAILED ones into sentences in the
// admin language — which rule did not reach Shopify, what that means at
// checkout — with the technical detail kept in parentheses (never hidden).
// The sentences are UiText (i18n key + params): the screen words them in the
// page's language. Pure; unit tested (tests/integration/sync-copy.test.ts).

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
  switch (step.step) {
    case "shop.read":
      return { key: "sync.problem.shopRead", params: { detail } };
    case "shop_config.build":
      return { key: "sync.problem.tooLarge" };
    case "sync.stopped":
    case "shop_config.phase1.write":
    case "shop_config.phase1.verify":
    case "shop_config.phase1.rollback":
      return { key: "sync.problem.campaignHeld", params: { detail } };
    case "shop_config.write":
      return /campaign switch/i.test(step.detail)
        ? { key: "sync.problem.campaignHeld", params: { detail } }
        : { key: "sync.problem.config", params: { detail } };
    case "shop_config.verify":
      return { key: "sync.problem.config", params: { detail } };
    case "shop_config.rollback":
      return /no valid previous config|could not restore/i.test(step.detail)
        ? { key: "sync.problem.configLost", params: { detail } }
        : { key: "sync.problem.config", params: { detail } };
    case "products":
    case "products.set":
    case "products.clear":
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

/**
 * Did this run leave the shop function config APPLIED (written — or already
 * equal — and verified)? A held, failed or rolled-back write does not count.
 */
export function shopConfigApplied(steps: readonly SyncStep[]): boolean {
  const written = steps.some((step) => step.step === "shop_config.write" && step.ok);
  const verifyFailed = steps.some((step) => step.step === "shop_config.verify" && !step.ok);
  return written && !verifyFailed;
}
