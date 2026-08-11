// MVP13c — experiment persistence + lifecycle. One active experiment per shop
// (queue); each carries its control/variant configs, split, holdout, guardrail
// baseline, and a readable audit log. The decision maths live in
// @won/core/toasts/experiment-engine — this layer only stores and transitions.

import { auditEntry, type AuditOutcome } from "@won/core/toasts/experiment-engine";

import type { PrismaClient, Prisma } from "../generated/prisma/client";
import db from "../db.server";

function normalizeShop(shop: string): string {
  const s = String(shop ?? "").trim().toLowerCase();
  if (!s) throw new Error("shop is required");
  return s;
}

export interface StartExperimentInput {
  name: string;
  control: unknown;
  variant: unknown;
  variantPercent?: number;
  holdoutPercent?: number;
  gatingMode?: "test_first" | "apply_now";
  baseline?: unknown;
  source?: "manual" | "ai" | "auto_pilot";
}

const ACTIVE_STATUS = "running";
const clampPct = (n: unknown, d: number) =>
  Number.isFinite(Number(n)) ? Math.min(100, Math.max(0, Math.round(Number(n)))) : d;

export function createExperimentService(prisma: PrismaClient) {
  async function getActiveExperiment(shop: string) {
    return prisma.experiment.findFirst({
      where: { shop: normalizeShop(shop), status: ACTIVE_STATUS },
      orderBy: { createdAt: "desc" },
    });
  }

  /** Start an experiment — rejected (null) if one is already running (queue). */
  async function startExperiment(shop: string, input: StartExperimentInput) {
    const normalizedShop = normalizeShop(shop);
    const existing = await getActiveExperiment(normalizedShop);
    if (existing) return null;

    const started = auditEntry({
      experimentId: "pending",
      outcome: "started",
      detail: input.name,
    });
    return prisma.experiment.create({
      data: {
        shop: normalizedShop,
        name: String(input.name ?? "Experiment").slice(0, 120),
        status: ACTIVE_STATUS,
        control: (input.control ?? {}) as Prisma.InputJsonValue,
        variant: (input.variant ?? {}) as Prisma.InputJsonValue,
        variantPercent: clampPct(input.variantPercent, 50),
        holdoutPercent: clampPct(input.holdoutPercent, 0),
        gatingMode: input.gatingMode === "apply_now" ? "apply_now" : "test_first",
        baseline: (input.baseline ?? null) as Prisma.InputJsonValue,
        source: input.source ?? "manual",
        audit: [started] as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Transition an experiment to a terminal outcome and append an audit entry. */
  async function decideExperiment(
    shop: string,
    id: string,
    outcome: AuditOutcome,
    detail?: string,
  ) {
    const normalizedShop = normalizeShop(shop);
    const exp = await prisma.experiment.findFirst({ where: { id, shop: normalizedShop } });
    if (!exp) return null;

    const statusByOutcome: Partial<Record<AuditOutcome, string>> = {
      promoted: "promoted",
      reverted: "reverted",
      expired: "expired",
      guardrail_rollback: "reverted",
    };
    const status = statusByOutcome[outcome] ?? exp.status;
    const prevAudit = Array.isArray(exp.audit) ? (exp.audit as unknown[]) : [];
    const entry = auditEntry({ experimentId: id, outcome, detail });

    return prisma.experiment.update({
      where: { id },
      data: {
        status,
        decidedAt: new Date(),
        audit: [...prevAudit, entry] as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async function listExperiments(shop: string) {
    return prisma.experiment.findMany({
      where: { shop: normalizeShop(shop) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  async function deleteShopExperiments(shop: string): Promise<void> {
    await prisma.experiment.deleteMany({ where: { shop: normalizeShop(shop) } });
  }

  return {
    getActiveExperiment,
    startExperiment,
    decideExperiment,
    listExperiments,
    deleteShopExperiments,
  };
}

const experimentService = createExperimentService(db);

export const getActiveExperiment = experimentService.getActiveExperiment;
export const startExperiment = experimentService.startExperiment;
export const decideExperiment = experimentService.decideExperiment;
export const listExperiments = experimentService.listExperiments;
export const deleteShopExperiments = experimentService.deleteShopExperiments;
