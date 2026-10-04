// Billing (MVP 7, contract M1; spec §7, A9): Pro is one flat plan — $29 a month in USD, a 14-day trial, no yearly
// plan — bought through Shopify Billing (Admin GraphQL appSubscriptionCreate; a test charge outside production).
//
// The plan in force is what SHOPIFY says about the shop's active subscriptions, mirrored in ShopEntitlement:
//   reconcilePlan(db, client, shop)        reads currentAppInstallation.activeSubscriptions and writes the row. Called
//                                          by Tarif (every load, and on the return from the confirmation page) and by
//                                          the scheduler's daily billing.reconcile;
//   recordSubscriptionUpdate(db, shop, …)  the app_subscriptions/update webhook: Pro the moment the charge is
//                                          accepted, Free the moment it is cancelled, expires or freezes;
//   storedPlan(db, shop)                   the one answer for plan.server.ts resolvePlan (BILL-1): Pro only for a row
//                                          saying an ACTIVE subscription of OUR plan, checked within
//                                          ENTITLEMENT_STALE_MS; anything else — no row, another status, a check
//                                          that old — is Free.
// A failed read never changes the row (a paying shop is not thrown to Free by a hiccup); the staleness bound is
// what makes "Free on uncertainty" hold in the end. The sync notices a changed plan by itself (ShopSyncState
// .appliedPlan ≠ the plan → resync; a downgrade lets running campaigns and sales finish, A6).
// The session shop only (SEC-2). No money is ever charged by this module outside `requestProSubscription`.

import type { ShopPlan } from "@won/core/discounts/plan-gate";

import type { PrismaClient } from "../generated/prisma/client";
import type { AdminClient } from "./admin-client.server";

export const PRO_PLAN = { name: "Won Discounts Pro", amount: "29.00", currency: "USD", interval: "EVERY_30_DAYS", trialDays: 14 } as const;

/** A Pro row not confirmed by Shopify for this long no longer counts (3 daily reconciles missed). */
export const ENTITLEMENT_STALE_MS = 72 * 3_600_000;

// Validated with the Shopify dev MCP (admin 2026-07): no scope beyond the app's own installation.
const ACTIVE_SUBSCRIPTIONS = `query WonBillingActiveSubscriptions {
  currentAppInstallation {
    activeSubscriptions { id name status test trialDays createdAt }
  }
}`;

const SUBSCRIBE = `mutation WonBillingSubscribe($name: String!, $returnUrl: URL!, $test: Boolean, $trialDays: Int, $amount: Decimal!, $currency: CurrencyCode!) {
  appSubscriptionCreate(
    name: $name
    returnUrl: $returnUrl
    test: $test
    trialDays: $trialDays
    lineItems: [{ plan: { appRecurringPricingDetails: { price: { amount: $amount, currencyCode: $currency }, interval: EVERY_30_DAYS } } }]
  ) {
    confirmationUrl
    userErrors { field message }
  }
}`;

const CANCEL = `mutation WonBillingCancel($id: ID!) {
  appSubscriptionCancel(id: $id) {
    appSubscription { id status }
    userErrors { field message }
  }
}`;

interface ActiveSubscription {
  id: string;
  name: string;
  status: string;
  test?: boolean | null;
  trialDays?: number | null;
  createdAt?: string | null;
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The shop's active subscriptions; throws when Shopify did not answer (the caller decides what "unknown" means). */
async function activeSubscriptions(client: AdminClient): Promise<ActiveSubscription[]> {
  const result = await client.graphql<{ currentAppInstallation?: { activeSubscriptions?: ActiveSubscription[] } | null }>(ACTIVE_SUBSCRIPTIONS);
  if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
  const list = result.data?.currentAppInstallation?.activeSubscriptions;
  if (!Array.isArray(list)) throw new Error("Shopify did not return the app installation");
  return list;
}

const isOurs = (sub: { name?: string | null }) => sub.name === PRO_PLAN.name;

function trialEnd(sub: ActiveSubscription): Date | null {
  const created = sub.createdAt ? Date.parse(sub.createdAt) : Number.NaN;
  if (Number.isNaN(created) || !sub.trialDays || sub.trialDays <= 0) return null;
  return new Date(created + sub.trialDays * 86_400_000);
}

/** The plan the row stands for at `now` (see the header). */
function planOfRow(row: { plan: string; status: string | null; checkedAt: Date } | null, now: Date): ShopPlan {
  if (!row || row.plan !== "pro" || row.status !== "ACTIVE") return "free";
  return now.getTime() - row.checkedAt.getTime() <= ENTITLEMENT_STALE_MS ? "pro" : "free";
}

export async function storedPlan(db: PrismaClient, shop: string, now: Date = new Date()): Promise<ShopPlan> {
  return planOfRow(await db.shopEntitlement.findUnique({ where: { shop }, select: { plan: true, status: true, checkedAt: true } }), now);
}

export interface EntitlementView {
  plan: ShopPlan;
  /** The trial's last day, while it is still ahead. */
  trialEndsAt: Date | null;
  /** A test charge (dev stores): no money moves. */
  test: boolean;
}

/** What Tarif says about the plan in force. */
export async function entitlementView(db: PrismaClient, shop: string, now: Date = new Date()): Promise<EntitlementView> {
  const row = await db.shopEntitlement.findUnique({ where: { shop } });
  const plan = planOfRow(row, now);
  const trial = plan === "pro" && row?.trialEndsAt && row.trialEndsAt.getTime() > now.getTime() ? row.trialEndsAt : null;
  return { plan, trialEndsAt: trial, test: plan === "pro" && row?.test === true };
}

export interface ReconcileResult {
  plan: ShopPlan;
  /** The plan in force differs from the one before this call. */
  changed: boolean;
  /** Shopify answered; false = the row was left as it was. */
  known: boolean;
}

/** Mirror Shopify's answer into ShopEntitlement (see the header). Never throws. */
export async function reconcilePlan(db: PrismaClient, client: AdminClient, shop: string, now: Date = new Date()): Promise<ReconcileResult> {
  const before = await storedPlan(db, shop, now);
  let subs: ActiveSubscription[];
  try {
    subs = await activeSubscriptions(client);
  } catch {
    return { plan: before, changed: false, known: false };
  }
  const ours = subs.find((sub) => isOurs(sub) && sub.status === "ACTIVE") ?? subs.find(isOurs) ?? null;
  const data = {
    plan: ours?.status === "ACTIVE" ? "pro" : "free",
    subscriptionId: ours?.id ?? null,
    status: ours?.status ?? null,
    trialEndsAt: ours ? trialEnd(ours) : null,
    test: ours?.test === true,
    checkedAt: now,
  };
  await db.shopEntitlement.upsert({ where: { shop }, create: { shop, ...data }, update: data });
  const plan: ShopPlan = data.plan === "pro" ? "pro" : "free";
  return { plan, changed: plan !== before, known: true };
}

/** The plan an `app_subscriptions/update` payload stands for; null = not our plan (ignore it). */
export function planFromSubscriptionUpdate(payload: unknown): ShopPlan | null {
  const sub = (payload as { app_subscription?: { name?: unknown; status?: unknown } | null } | null)?.app_subscription;
  if (!sub || typeof sub !== "object" || sub.name !== PRO_PLAN.name) return null;
  return sub.status === "ACTIVE" ? "pro" : "free";
}

/** The webhook's write: idempotent (a redelivery changes nothing). Null = not our plan. */
export async function recordSubscriptionUpdate(db: PrismaClient, shop: string, payload: unknown, now: Date = new Date()): Promise<{ plan: ShopPlan; changed: boolean } | null> {
  const plan = planFromSubscriptionUpdate(payload);
  if (plan === null) return null;
  const sub = (payload as { app_subscription: { admin_graphql_api_id?: unknown; status?: unknown } }).app_subscription;
  const before = await storedPlan(db, shop, now);
  const data = {
    plan,
    subscriptionId: typeof sub.admin_graphql_api_id === "string" ? sub.admin_graphql_api_id : null,
    status: typeof sub.status === "string" ? sub.status : null,
    checkedAt: now,
  };
  // The trial end and the test flag come from the next reconcile (the webhook payload does not carry them).
  await db.shopEntitlement.upsert({ where: { shop }, create: { shop, ...data }, update: data });
  return { plan, changed: plan !== before };
}

export type SubscribeResult = { ok: true; confirmationUrl: string } | { ok: false; detail: string };

/** Ask Shopify for the Pro subscription; the merchant accepts it on the returned confirmation page. */
export async function requestProSubscription(client: AdminClient, returnUrl: string, opts: { test: boolean }): Promise<SubscribeResult> {
  try {
    const result = await client.graphql<{ appSubscriptionCreate?: { confirmationUrl?: string | null; userErrors?: { message: string }[] } | null }>(SUBSCRIBE, {
      name: PRO_PLAN.name,
      returnUrl,
      test: opts.test,
      trialDays: PRO_PLAN.trialDays,
      amount: PRO_PLAN.amount,
      currency: PRO_PLAN.currency,
    });
    if (result.errors?.length) return { ok: false, detail: result.errors.map((e) => e.message).join("; ") };
    const created = result.data?.appSubscriptionCreate;
    const refused = (created?.userErrors ?? []).map((e) => e.message).join("; ");
    if (refused) return { ok: false, detail: refused };
    return created?.confirmationUrl ? { ok: true, confirmationUrl: created.confirmationUrl } : { ok: false, detail: "Shopify returned no confirmation page" };
  } catch (error) {
    if (error instanceof Response) throw error;
    return { ok: false, detail: errorText(error) };
  }
}

export type CancelResult = { ok: true; cancelled: number } | { ok: false; detail: string };

/** Cancel every active subscription of OUR plan (there is one at most; others are never touched). */
export async function cancelProSubscription(client: AdminClient): Promise<CancelResult> {
  try {
    let cancelled = 0;
    for (const sub of (await activeSubscriptions(client)).filter(isOurs)) {
      const result = await client.graphql<{ appSubscriptionCancel?: { userErrors?: { message: string }[] } | null }>(CANCEL, { id: sub.id });
      const refused = [...(result.errors ?? []), ...(result.data?.appSubscriptionCancel?.userErrors ?? [])].map((e) => e.message).join("; ");
      if (refused) return { ok: false, detail: refused };
      cancelled += 1;
    }
    return { ok: true, cancelled };
  } catch (error) {
    if (error instanceof Response) throw error;
    return { ok: false, detail: errorText(error) };
  }
}

/** A real charge only in production; everywhere else Shopify makes it a test charge. */
export function isTestCharge(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.NODE_ENV !== "production";
}
