// MVP7 — portable config export/import (JSON). Export is a plain snapshot;
// import re-validates every section through the same sanitizers the admin uses,
// so an untrusted/older file can never produce an unusable config. Round-trips
// cleanly: resolveToastConfig(importConfig(exportConfig(cfg))) === cfg.

import type { StoredToastConfig, ToastAppConfig } from "./config.types.ts";
import {
  mergeMessages,
  sanitizeGlobalSettings,
  sanitizeMilestones,
  sanitizeTargeting,
  sanitizeTheme,
} from "./config.defaults.ts";
import { sanitizeNotifications } from "./notifications.ts";
import { sanitizeExclusions } from "./exclusions.ts";
import { sanitizeLocaleSettings } from "./locales.ts";

export function exportConfig(config: ToastAppConfig): string {
  return JSON.stringify(
    {
      version: config.version,
      enabled: config.enabled,
      plan: config.plan,
      global: config.global,
      theme: config.theme,
      messages: config.messages,
      locales: config.locales,
      milestones: config.milestones,
      targeting: config.targeting,
      notifications: config.notifications,
      exclusions: config.exclusions,
    },
    null,
    2,
  );
}

export function importConfig(json: string): StoredToastConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }
  const p = parsed as Record<string, unknown>;
  const out: StoredToastConfig = {};

  if (typeof p.enabled === "boolean") out.enabled = p.enabled;
  if (p.plan === "pro" || p.plan === "free") out.plan = p.plan;

  const global = sanitizeGlobalSettings(p.global);
  // sanitizeGlobalSettings intentionally omits `summarizeConcurrent`; carry it.
  if (
    typeof p.global === "object" &&
    p.global !== null &&
    typeof (p.global as Record<string, unknown>).summarizeConcurrent === "boolean"
  ) {
    global.summarizeConcurrent = (p.global as { summarizeConcurrent: boolean }).summarizeConcurrent;
  }
  if (Object.keys(global).length > 0) out.global = global;

  const theme = sanitizeTheme(p.theme);
  if (Object.keys(theme).length > 0) out.theme = theme;

  out.messages = mergeMessages(p.messages);
  out.locales = sanitizeLocaleSettings(p.locales);
  out.milestones = sanitizeMilestones(p.milestones);
  out.targeting = sanitizeTargeting(p.targeting);
  out.notifications = sanitizeNotifications(p.notifications);
  out.exclusions = sanitizeExclusions(p.exclusions);

  return out;
}
