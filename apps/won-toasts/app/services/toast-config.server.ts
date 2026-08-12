// Per-shop Won Toasts config service. The admin writes here; the app-proxy
// route reads here. Every read returns a COMPLETE, resolved config (partial or
// missing stored values are layered over @won/core defaults), so a fresh
// install and an older config shape are both render-safe.

import {
  resolveToastConfig,
  TOAST_CONFIG_VERSION,
} from "@won/core/toasts/config.defaults";
import { applyConfigOverlay } from "@won/core/toasts/config-overlay";
import type {
  MilestoneRuleConfig,
  StoredToastConfig,
  ToastAppConfig,
  ToastMessages,
  ToastPlan,
} from "@won/core/toasts/config.types";
import type { ToastTargeting } from "@won/core/toasts/targeting";
import type { NotificationRule } from "@won/core/toasts/notifications";
import type { ExclusionSettings } from "@won/core/toasts/exclusions";
import type { LocaleSettings } from "@won/core/toasts/locales";

import type { Prisma, PrismaClient } from "../generated/prisma/client";
import db from "../db.server";

export interface ToastConfigWrite {
  enabled?: boolean;
  plan?: ToastPlan;
  global?: StoredToastConfig["global"];
  theme?: StoredToastConfig["theme"];
  byType?: StoredToastConfig["byType"];
  cartEvents?: StoredToastConfig["cartEvents"];
  messages?: ToastMessages;
  locales?: Partial<LocaleSettings>;
  milestones?: MilestoneRuleConfig[];
  targeting?: Partial<ToastTargeting>;
  notifications?: NotificationRule[];
  exclusions?: Partial<ExclusionSettings>;
}

// How many auto-saved versions to keep per shop.
const VERSION_CAP = 15;

function normalizeShop(shop: string): string {
  const normalized = String(shop ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    throw new Error("Authenticated shop is required.");
  }
  return normalized;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Turn a persisted row into a resolved, complete config. */
function rowToStored(row: {
  enabled: boolean;
  plan: string;
  global: unknown;
  theme: unknown;
  byType?: unknown;
  cartEvents?: unknown;
  messages: unknown;
  locales?: unknown;
  milestones: unknown;
  targeting: unknown;
  notifications: unknown;
  exclusions: unknown;
}): StoredToastConfig {
  const stored: StoredToastConfig = {
    enabled: row.enabled,
    plan: row.plan === "pro" ? "pro" : "free",
    global: isPlainObject(row.global)
      ? (row.global as StoredToastConfig["global"])
      : undefined,
    theme: isPlainObject(row.theme)
      ? (row.theme as StoredToastConfig["theme"])
      : undefined,
    byType: isPlainObject(row.byType)
      ? (row.byType as StoredToastConfig["byType"])
      : undefined,
    cartEvents: isPlainObject(row.cartEvents)
      ? (row.cartEvents as StoredToastConfig["cartEvents"])
      : undefined,
    messages: isPlainObject(row.messages)
      ? (row.messages as ToastMessages)
      : undefined,
    locales: isPlainObject(row.locales)
      ? (row.locales as Partial<LocaleSettings>)
      : undefined,
    milestones: Array.isArray(row.milestones)
      ? (row.milestones as MilestoneRuleConfig[])
      : undefined,
    targeting: isPlainObject(row.targeting)
      ? (row.targeting as Partial<ToastTargeting>)
      : undefined,
    notifications: Array.isArray(row.notifications)
      ? (row.notifications as NotificationRule[])
      : undefined,
    exclusions: isPlainObject(row.exclusions)
      ? (row.exclusions as Partial<ExclusionSettings>)
      : undefined,
  };
  return stored;
}

function rowToConfig(row: Parameters<typeof rowToStored>[0]): ToastAppConfig {
  return resolveToastConfig(rowToStored(row));
}

export function createToastConfigService(prisma: PrismaClient) {
  async function getRawConfig(shop: string) {
    const normalizedShop = normalizeShop(shop);
    return prisma.toastAppConfig.upsert({
      where: { shop: normalizedShop },
      // A shop only ever reaches here after installing the app AND enabling the
      // theme app embed (the merchant's real opt-in), so a fresh install is on
      // by default. The unknown-shop path still serves resolveToastConfig(null)
      // (enabled:false) — that safety default is deliberate and untouched.
      create: { shop: normalizedShop, version: TOAST_CONFIG_VERSION, enabled: true },
      update: {},
    });
  }

  /** Full resolved config for a shop (defaults + stored overrides). */
  async function getToastConfig(shop: string): Promise<ToastAppConfig> {
    const row = await getRawConfig(shop);
    return rowToConfig(row);
  }

  /** MVP13c live A/B: resolve the shop's config with an experiment variant
   *  overlay applied over the stored config (defaults still fill in). Used to
   *  serve the variant arm alongside the control config. */
  async function resolveConfigWithOverlay(
    shop: string,
    overlay: unknown,
  ): Promise<ToastAppConfig> {
    const row = await getRawConfig(shop);
    const merged = applyConfigOverlay(rowToStored(row), overlay);
    return resolveToastConfig(merged);
  }

  async function updateToastConfig(
    shop: string,
    input: ToastConfigWrite,
  ): Promise<ToastAppConfig> {
    const normalizedShop = normalizeShop(shop);
    await getRawConfig(normalizedShop);

    const data: Record<string, unknown> = { version: TOAST_CONFIG_VERSION };
    if (typeof input.enabled === "boolean") data.enabled = input.enabled;
    if (input.plan === "pro" || input.plan === "free") data.plan = input.plan;
    if (isPlainObject(input.global)) data.global = input.global;
    if (isPlainObject(input.theme)) data.theme = input.theme;
    if (isPlainObject(input.byType)) data.byType = input.byType;
    if (isPlainObject(input.cartEvents)) data.cartEvents = input.cartEvents;
    if (isPlainObject(input.messages)) data.messages = input.messages;
    if (isPlainObject(input.locales)) data.locales = input.locales;
    if (Array.isArray(input.milestones)) data.milestones = input.milestones;
    if (isPlainObject(input.targeting)) data.targeting = input.targeting;
    if (Array.isArray(input.notifications)) data.notifications = input.notifications;
    if (isPlainObject(input.exclusions)) data.exclusions = input.exclusions;

    const row = await prisma.toastAppConfig.update({
      where: { shop: normalizedShop },
      data,
    });
    await snapshotVersion(normalizedShop, row);
    return rowToConfig(row);
  }

  // Persist a rollback snapshot of the saved row, capped per shop. Best-effort —
  // a history hiccup must never break a save.
  async function snapshotVersion(
    shop: string,
    row: Record<string, unknown>,
  ): Promise<void> {
    try {
      const snapshot = {
        enabled: row.enabled,
        plan: row.plan,
        global: row.global ?? null,
        theme: row.theme ?? null,
        byType: row.byType ?? null,
        cartEvents: row.cartEvents ?? null,
        messages: row.messages ?? null,
        locales: row.locales ?? null,
        milestones: row.milestones ?? null,
        targeting: row.targeting ?? null,
        notifications: row.notifications ?? null,
        exclusions: row.exclusions ?? null,
      };
      await prisma.configVersion.create({
        data: { shop, data: snapshot as unknown as Prisma.InputJsonValue },
      });
      const old = await prisma.configVersion.findMany({
        where: { shop },
        orderBy: { createdAt: "desc" },
        skip: VERSION_CAP,
        select: { id: true },
      });
      if (old.length) {
        await prisma.configVersion.deleteMany({
          where: { id: { in: old.map((v) => v.id) } },
        });
      }
    } catch {
      // ignore — history is non-critical
    }
  }

  /** Recent rollback points (newest first). */
  async function listConfigVersions(shop: string) {
    const normalizedShop = normalizeShop(shop);
    return prisma.configVersion.findMany({
      where: { shop: normalizedShop },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
      take: VERSION_CAP,
    });
  }

  /** Rollback points WITH their snapshot data — for the MVP13b timeline diff. */
  async function listConfigVersionsWithData(shop: string) {
    const normalizedShop = normalizeShop(shop);
    return prisma.configVersion.findMany({
      where: { shop: normalizedShop },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, data: true },
      take: VERSION_CAP,
    });
  }

  /** Restore a stored version into the live config (does not itself snapshot). */
  async function restoreConfigVersion(
    shop: string,
    versionId: string,
  ): Promise<ToastAppConfig | null> {
    const normalizedShop = normalizeShop(shop);
    const version = await prisma.configVersion.findFirst({
      where: { id: versionId, shop: normalizedShop },
    });
    if (!version || !isPlainObject(version.data)) return null;
    const d = version.data as Record<string, unknown>;
    const row = await prisma.toastAppConfig.update({
      where: { shop: normalizedShop },
      data: {
        version: TOAST_CONFIG_VERSION,
        enabled: d.enabled === true,
        plan: d.plan === "pro" ? "pro" : "free",
        global: (d.global ?? null) as never,
        theme: (d.theme ?? null) as never,
        byType: (d.byType ?? null) as never,
        cartEvents: (d.cartEvents ?? null) as never,
        messages: (d.messages ?? null) as never,
        locales: (d.locales ?? null) as never,
        milestones: (d.milestones ?? null) as never,
        targeting: (d.targeting ?? null) as never,
        notifications: (d.notifications ?? null) as never,
        exclusions: (d.exclusions ?? null) as never,
      },
    });
    return rowToConfig(row);
  }

  async function deleteShopData(shop: string): Promise<void> {
    const normalizedShop = normalizeShop(shop);
    await prisma.toastAppConfig.deleteMany({
      where: { shop: normalizedShop },
    });
    await prisma.configVersion.deleteMany({
      where: { shop: normalizedShop },
    });
  }

  return {
    getRawConfig,
    getToastConfig,
    resolveConfigWithOverlay,
    updateToastConfig,
    listConfigVersions,
    listConfigVersionsWithData,
    restoreConfigVersion,
    deleteShopData,
  };
}

const toastConfigService = createToastConfigService(db);

export const getRawConfig = toastConfigService.getRawConfig;
export const getToastConfig = toastConfigService.getToastConfig;
export const resolveConfigWithOverlay = toastConfigService.resolveConfigWithOverlay;
export const updateToastConfig = toastConfigService.updateToastConfig;
export const listConfigVersions = toastConfigService.listConfigVersions;
export const listConfigVersionsWithData = toastConfigService.listConfigVersionsWithData;
export const restoreConfigVersion = toastConfigService.restoreConfigVersion;
export const deleteShopData = toastConfigService.deleteShopData;
