// Shared setup for the sync tests: engine payload builders are FAKES here (the
// real ones live in @won/core and are wired in app/lib/sync/wiring.server.ts),
// so these tests pin the sync's own behaviour: what it writes, in which order,
// how it retries and what it records.

import { sanitizeConfig, type WonDiscountsConfig } from "@won/core/discounts/config";

import type { PrismaClient } from "../../../app/generated/prisma/client.ts";
import type { ConfigView as SyncConfigView, SyncDeps, SyncNodeRole } from "../../../app/lib/sync/types.ts";
import type { FakeShopify } from "./fake-shopify.ts";

export const NOW = new Date("2026-09-28T12:00:00Z");
/** NOW in the fake shop's zone (Europe/Prague, CEST = UTC+2). */
export const NOW_SHOP_LOCAL = "2026-09-28T14:00:00";

export interface BuilderLog {
  /** The config each buildShopFunctionConfig call received (market countries filled in by the sync). */
  shopConfigs: SyncConfigView[];
  shopConfigNow: string[];
  shopConfigCalls: { now: string; shopTimezone: string; forceNoCampaign: boolean }[];
  nodeVars: { role: SyncNodeRole; now: string }[];
  indexInputs: { productId: string; variantIds: readonly string[]; collectionIds: readonly string[] }[][];
}

type CampaignView = WonDiscountsConfig["campaigns"][number];

/** Same selection rule as the engine: the current live campaign, else the next one. */
export function selectedCampaign(campaigns: readonly CampaignView[], now: string): CampaignView | null {
  const live = campaigns.filter((c) => !c.killed && c.window.end > now);
  const current = live.find((c) => c.window.start <= now);
  if (current) return current;
  return [...live].sort((a, b) => (a.window.start < b.window.start ? -1 : 1))[0] ?? null;
}

export const campaignVersion = (c: { id: string; window: { start: string; end: string } } | null) =>
  c ? `v:${c.id}:${c.window.start}:${c.window.end}` : null;

export function codeRule(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Rule ${id}`,
    method: "code",
    codes: [`${id.toUpperCase().replace(/[^A-Z0-9]/g, "")}10`],
    value: { kind: "percentage", percent: 10 },
    target: { kind: "order" },
    ...overrides,
  };
}

export function autoRule(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Auto ${id}`,
    method: "automatic",
    value: { kind: "percentage", percent: 5 },
    target: { kind: "order" },
    ...overrides,
  };
}

export function configWith(rules: unknown[], extra: Record<string, unknown> = {}): WonDiscountsConfig {
  const { config, issues } = sanitizeConfig({ modules: { codes: { rules } }, ...extra });
  const dropped = issues.filter((issue) => /dropped|removed|disabled/i.test(issue.message));
  if (dropped.length) throw new Error(`test config lost data: ${JSON.stringify(dropped)}`);
  return config;
}

type Builders = Pick<SyncDeps, "buildShopFunctionConfig" | "buildNodeVars" | "productRuleIndex" | "verifyShopFunctionConfig">;

export function fakeBuilders(log: BuilderLog, overrides: Partial<Builders> = {}) {
  const builders: Builders = {
    buildShopFunctionConfig(config, options) {
      log.shopConfigs.push(config);
      log.shopConfigNow.push(options.now);
      log.shopConfigCalls.push({ now: options.now, shopTimezone: options.shopTimezone, forceNoCampaign: options.forceNoCampaign === true });
      const campaign = options.forceNoCampaign ? null : selectedCampaign(config.campaigns as CampaignView[], options.now);
      const json = JSON.stringify({
        schemaVersion: 1,
        campaignId: campaign?.id ?? null,
        campaignVarsVersion: campaignVersion(campaign),
        rules: config.modules.codes.rules.map((rule) => ({ id: rule.id, enabled: rule.enabled, codes: rule.codes ?? [] })),
        campaigns: campaign ? [{ id: campaign.id, overrides: campaign.overrides }] : [],
      });
      const bytes = Buffer.byteLength(json, "utf8");
      return { json, bytes, fits: bytes <= 9000 };
    },
    buildNodeVars(role, config, now) {
      log.nodeVars.push({ role, now });
      const campaign = selectedCampaign(config.campaigns as CampaignView[], now);
      return {
        role: role.kind,
        ...(role.kind === "code" ? { ruleId: role.ruleId } : {}),
        campaignId: campaign?.id ?? null,
        campaignStart: campaign?.window.start ?? "1970-01-01T00:00:00",
        campaignEnd: campaign?.window.end ?? "1970-01-01T00:00:00",
        varsVersion: campaignVersion(campaign),
      };
    },
    productRuleIndex(config, products) {
      log.indexInputs.push(products.map((p) => ({ ...p })));
      const index = new Map<string, { ruleIds: string[]; variantRuleIds: Record<string, string[]> }>();
      for (const product of products) {
        const whole = new Set<string>();
        const variantRuleIds: Record<string, string[]> = {};
        for (const rule of config.modules.codes.rules) {
          const target = rule.target;
          if (target.kind === "products") {
            if (target.productIds.includes(product.productId)) whole.add(rule.id);
            for (const variant of product.variantIds) {
              if (target.variantIds.includes(variant)) (variantRuleIds[variant] ??= []).push(rule.id);
            }
          }
          if (target.kind === "collections" && product.collectionIds.some((c) => target.ids.includes(c))) whole.add(rule.id);
        }
        index.set(product.productId, { ruleIds: [...whole].sort(), variantRuleIds });
      }
      return index;
    },
    verifyShopFunctionConfig(json) {
      const bytes = Buffer.byteLength(json, "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        return { ok: false, bytes, reason: "not_json" };
      }
      if (bytes > 10_000) return { ok: false, bytes, reason: "too_large" };
      if (!Array.isArray((parsed as { rules?: unknown } | null)?.rules)) return { ok: false, bytes, reason: "invalid_shape" };
      return { ok: true, bytes };
    },
    ...overrides,
  };
  return builders;
}

export interface TestDeps extends SyncDeps {
  sleeps: number[];
  log: BuilderLog;
  messages: string[];
}

export function makeDeps(fake: FakeShopify, db: PrismaClient, overrides: Partial<SyncDeps> = {}): TestDeps {
  const log: BuilderLog = { shopConfigs: [], shopConfigNow: [], shopConfigCalls: [], nodeVars: [], indexInputs: [] };
  const sleeps: number[] = [];
  const messages: string[] = [];
  const logger = {
    info: (message: string) => void messages.push(`info: ${message}`),
    warn: (message: string) => void messages.push(`warn: ${message}`),
    error: (message: string) => void messages.push(`error: ${message}`),
  };
  return {
    client: fake,
    db,
    ...fakeBuilders(log),
    now: () => NOW,
    logger,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    retry: { attempts: 4, baseDelayMs: 100, maxDelayMs: 1000, pollAttempts: 3, pollDelayMs: 10 },
    ...overrides,
    sleeps,
    log,
    messages,
  };
}
