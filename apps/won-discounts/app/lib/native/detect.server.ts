// Detection of native Shopify discounts (spec §4.1, rozhodnutí "Nativní slevy
// Shopify": detection always, Free). Reads every discount node (paged, API-2)
// and sorts it into:
//   movable     Basic / Free shipping, ACTIVE or SCHEDULED, expressible in Won
//   notMovable  live, but staying in Shopify, with a human reason (BXGY, other
//               apps' discounts, specific customers, …)
//   expired     EXPIRED discounts of any type (informational)
//   conflicts   live natives that fight a Won rule (only when `config` is given)
// Won's own nodes (WonNode ids, or app discounts with this app's key) are not
// "outside Won" and are left out entirely.

import type { WonDiscountsConfig } from "@won/core/discounts/config";

import { classifyNative } from "./classify.ts";
import { findConflicts } from "./conflicts.ts";
import { notMovableReasonText } from "./copy.ts";
import { DETECT_CODES, DETECT_ITEMS, DETECT_PAGE_SIZE } from "./documents.ts";
import { normalizeNode } from "./normalize.ts";
import { type RequestOptions, runGql } from "./request.server.ts";
import type {
  AdminClient,
  NativeDetection,
  NativeDiscount,
  NativeLocale,
  NotMovableReason,
  ShopContext,
} from "./types.ts";

/** Upper bound on pages read (DETECT_PAGE_SIZE each): a runaway cursor never loops forever. */
export const DETECT_MAX_PAGES = 300;

export interface DetectOptions extends RequestOptions {
  /** The shop's Won config: enables conflict detection. */
  config?: WonDiscountsConfig;
  /** discountNodeId of every WonNode row of the shop. */
  wonNodeIds?: Iterable<string>;
  /** This app's API key (client_id): app discounts with it are Won's own. */
  ownAppKey?: string | null;
  locale?: NativeLocale;
}

/** Detection could not finish; `message` is a human sentence. */
export class NativeDetectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeDetectError";
  }
}

function detectErrorText(detail: string, locale: NativeLocale): string {
  return locale === "en"
    ? `Could not read the discounts from Shopify (${detail}). Try again in a moment.`
    : `Slevy se nepodařilo načíst ze Shopify (${detail}). Zkus to za chvíli znovu.`;
}

/** Shop currency + time zone (the mapping needs both). */
export async function readShopContext(
  client: AdminClient,
  options: RequestOptions = {},
): Promise<{ ok: true; shop: ShopContext } | { ok: false; message: string }> {
  const result = await runGql(client, "shop", undefined, options);
  if (!result.ok) return { ok: false, message: result.message };
  const shop = result.data?.shop;
  if (typeof shop?.currencyCode !== "string") return { ok: false, message: "shop currency missing" };
  return {
    ok: true,
    shop: { currencyCode: shop.currencyCode, ianaTimezone: typeof shop.ianaTimezone === "string" ? shop.ianaTimezone : "UTC" },
  };
}

export async function detectNativeDiscounts(client: AdminClient, options: DetectOptions = {}): Promise<NativeDetection> {
  const locale = options.locale ?? "cs";
  const own = new Set(options.wonNodeIds ?? []);
  const ownAppKey = options.ownAppKey ?? null;

  const shopResult = await readShopContext(client, options);
  if (!shopResult.ok) throw new NativeDetectError(detectErrorText(shopResult.message, locale));
  const shop = shopResult.shop;

  const detection: NativeDetection = { shop, movable: [], notMovable: [], expired: [], conflicts: [] };
  const live: NativeDiscount[] = [];
  let after: string | null = null;
  let complete = false;

  for (let page = 0; page < DETECT_MAX_PAGES; page++) {
    const result = await runGql(
      client,
      "list",
      { after, first: DETECT_PAGE_SIZE, items: DETECT_ITEMS, codes: DETECT_CODES },
      options,
    );
    if (!result.ok) throw new NativeDetectError(detectErrorText(result.message, locale));
    const connection = result.data?.discountNodes;
    const nodes: unknown[] = Array.isArray(connection?.nodes) ? connection.nodes : [];
    for (const raw of nodes) {
      const node = normalizeNode(raw, shop);
      if (!node) continue; // malformed node: skipped, the rest still counts (API-2)
      const id = node.movableType ? node.native.id : node.id;
      if (own.has(id)) continue;
      if (!node.movableType) {
        if (ownAppKey && node.app?.appKey === ownAppKey) continue;
        if (node.status === "EXPIRED") {
          detection.expired.push({ id: node.id, title: node.title, kind: node.kind });
          continue;
        }
        const reason: NotMovableReason =
          node.kind === "code_bxgy" || node.kind === "automatic_bxgy"
            ? { code: "bxgy" }
            : node.kind === "code_app" || node.kind === "automatic_app"
              ? { code: "other_app", appTitle: node.app?.title ?? null }
              : { code: "unknown_type" };
        detection.notMovable.push({
          id: node.id,
          title: node.title,
          kind: node.kind,
          status: node.status,
          reasonCode: reason.code,
          reason: notMovableReasonText(reason, locale),
        });
        continue;
      }
      const native = node.native;
      if (native.status === "EXPIRED") {
        detection.expired.push({ id: native.id, title: native.title, kind: native.kind });
        continue;
      }
      live.push(native);
      const reason = classifyNative(native);
      if (reason) {
        detection.notMovable.push({
          id: native.id,
          title: native.title,
          kind: native.kind,
          status: native.status,
          reasonCode: reason.code,
          reason: notMovableReasonText(reason, locale),
        });
      } else {
        detection.movable.push(native);
      }
    }
    const next = connection?.pageInfo?.hasNextPage === true ? connection.pageInfo.endCursor : null;
    if (typeof next !== "string" || nodes.length === 0) {
      complete = true;
      break;
    }
    after = next;
  }
  if (!complete) {
    throw new NativeDetectError(
      detectErrorText(locale === "en" ? "too many discounts to read at once" : "slev je příliš mnoho na jedno načtení", locale),
    );
  }

  if (options.config) detection.conflicts = findConflicts(live, options.config, locale);
  return detection;
}
