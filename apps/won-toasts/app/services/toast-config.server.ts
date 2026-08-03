// Per-shop Won Toasts config service. The admin writes here; the app-proxy
// route reads here. Every read returns a COMPLETE, resolved config (partial or
// missing stored values are layered over @won/core defaults), so a fresh
// install and an older config shape are both render-safe.

import {
  resolveToastConfig,
  TOAST_CONFIG_VERSION,
} from "@won/core/toasts/config.defaults";
import type {
  MilestoneRuleConfig,
  StoredToastConfig,
  ToastAppConfig,
  ToastMessages,
  ToastPlan,
} from "@won/core/toasts/config.types";

import type { PrismaClient } from "../generated/prisma/client";
import db from "../db.server";

export interface ToastConfigWrite {
  enabled?: boolean;
  plan?: ToastPlan;
  global?: StoredToastConfig["global"];
  theme?: StoredToastConfig["theme"];
  messages?: ToastMessages;
  milestones?: MilestoneRuleConfig[];
}

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
function rowToConfig(row: {
  enabled: boolean;
  plan: string;
  global: unknown;
  theme: unknown;
  messages: unknown;
  milestones: unknown;
}): ToastAppConfig {
  const stored: StoredToastConfig = {
    enabled: row.enabled,
    plan: row.plan === "pro" ? "pro" : "free",
    global: isPlainObject(row.global)
      ? (row.global as StoredToastConfig["global"])
      : undefined,
    theme: isPlainObject(row.theme)
      ? (row.theme as StoredToastConfig["theme"])
      : undefined,
    messages: isPlainObject(row.messages)
      ? (row.messages as ToastMessages)
      : undefined,
    milestones: Array.isArray(row.milestones)
      ? (row.milestones as MilestoneRuleConfig[])
      : undefined,
  };
  return resolveToastConfig(stored);
}

export function createToastConfigService(prisma: PrismaClient) {
  async function getRawConfig(shop: string) {
    const normalizedShop = normalizeShop(shop);
    return prisma.toastAppConfig.upsert({
      where: { shop: normalizedShop },
      create: { shop: normalizedShop, version: TOAST_CONFIG_VERSION },
      update: {},
    });
  }

  /** Full resolved config for a shop (defaults + stored overrides). */
  async function getToastConfig(shop: string): Promise<ToastAppConfig> {
    const row = await getRawConfig(shop);
    return rowToConfig(row);
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
    if (isPlainObject(input.messages)) data.messages = input.messages;
    if (Array.isArray(input.milestones)) data.milestones = input.milestones;

    const row = await prisma.toastAppConfig.update({
      where: { shop: normalizedShop },
      data,
    });
    return rowToConfig(row);
  }

  async function deleteShopData(shop: string): Promise<void> {
    const normalizedShop = normalizeShop(shop);
    await prisma.toastAppConfig.deleteMany({
      where: { shop: normalizedShop },
    });
  }

  return {
    getRawConfig,
    getToastConfig,
    updateToastConfig,
    deleteShopData,
  };
}

const toastConfigService = createToastConfigService(db);

export const getToastConfig = toastConfigService.getToastConfig;
export const updateToastConfig = toastConfigService.updateToastConfig;
export const deleteShopData = toastConfigService.deleteShopData;
