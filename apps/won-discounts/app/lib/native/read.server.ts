// Full read of ONE native discount before a move: every product, variant,
// collection and redeem code, paged. The raw payload (with the extra pages
// merged in) is exactly what the backup stores, and restore rebuilds the
// discount from it through the same normalizeNode(), so there is one reading.

import { CONFIG_LIMITS } from "@won/core/discounts/config";

import { MAX_BACKUP_CODES } from "./classify.ts";
import { FULL_READ_CODES, FULL_READ_ITEMS, type GqlName } from "./documents.ts";
import { normalizeNode, type ListCursors } from "./normalize.ts";
import { type RequestOptions, runGql } from "./request.server.ts";
import type { AdminClient, NativeDiscount, NativeKind, NativeStatus, ShopContext } from "./types.ts";

/* eslint-disable @typescript-eslint/no-explicit-any -- raw GraphQL JSON is merged as-is into the snapshot */

export type ReadResult =
  | { ok: true; movableType: true; native: NativeDiscount; raw: any }
  | { ok: true; movableType: false; id: string; title: string; kind: NativeKind; status: NativeStatus }
  | { ok: false; notFound: true }
  | { ok: false; notFound: false; message: string };

interface ListSpec {
  cursor: keyof ListCursors;
  doc: GqlName;
  /** Path from `discount` to the connection. */
  path: string[];
  /** Stop paging past this many entries (the move refuses above it anyway). */
  cap: number;
}

const LISTS: ListSpec[] = [
  { cursor: "products", doc: "productsPage", path: ["customerGets", "items", "products"], cap: CONFIG_LIMITS.listItems + 1 },
  { cursor: "variants", doc: "variantsPage", path: ["customerGets", "items", "productVariants"], cap: CONFIG_LIMITS.listItems + 1 },
  { cursor: "collections", doc: "collectionsPage", path: ["customerGets", "items", "collections"], cap: CONFIG_LIMITS.listItems + 1 },
  { cursor: "codes", doc: "codesPage", path: ["codes"], cap: MAX_BACKUP_CODES },
];

function at(root: any, path: string[]): any {
  return path.reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), root);
}

function partialText(errors: string[]): string {
  return `Shopify returned the discount only in part: ${errors.join("; ")}`.slice(0, 500);
}

/** Longest a single list may be paged (250 per page): bounds a runaway cursor. */
const MAX_PAGES_PER_LIST = Math.ceil(MAX_BACKUP_CODES / 250) + 1;

export async function readNativeDiscount(
  client: AdminClient,
  id: string,
  shop: ShopContext,
  options: RequestOptions = {},
): Promise<ReadResult> {
  const first = await runGql(client, "one", { id, items: FULL_READ_ITEMS, codes: FULL_READ_CODES }, options);
  if (!first.ok) return { ok: false, notFound: false, message: first.message };
  // A field Shopify could not resolve comes back null: never read it as "no
  // limit / no end / no minimum" (F13). Anything partial refuses the move.
  if (first.partialErrors?.length) return { ok: false, notFound: false, message: partialText(first.partialErrors) };
  const raw = first.data?.discountNode;
  if (!raw) return { ok: false, notFound: true };

  const initial = normalizeNode(raw, shop);
  if (!initial) return { ok: false, notFound: false, message: "unreadable discount" };
  if (!initial.movableType) {
    return { ok: true, movableType: false, id: initial.id, title: initial.title, kind: initial.kind, status: initial.status };
  }
  // Too many codes to back up: no point paging them (classify refuses it).
  if (initial.native.codesCount > MAX_BACKUP_CODES) {
    return { ok: true, movableType: true, native: initial.native, raw };
  }

  for (const list of LISTS) {
    let cursor = initial.cursors[list.cursor];
    const connection = at(raw.discount, list.path);
    for (let page = 0; cursor && connection && page < MAX_PAGES_PER_LIST; page++) {
      if (!Array.isArray(connection.nodes)) connection.nodes = [];
      if (connection.nodes.length >= list.cap) break;
      const result = await runGql(client, list.doc, { id, after: cursor }, options);
      if (!result.ok) return { ok: false, notFound: false, message: result.message };
      if (result.partialErrors?.length) return { ok: false, notFound: false, message: partialText(result.partialErrors) };
      const next = at(result.data?.discountNode?.discount, list.path);
      if (!next) return { ok: false, notFound: false, message: `could not page ${list.cursor}` };
      connection.nodes.push(...(Array.isArray(next.nodes) ? next.nodes : []));
      connection.pageInfo = next.pageInfo ?? { hasNextPage: false, endCursor: null };
      cursor = next.pageInfo?.hasNextPage === true && typeof next.pageInfo.endCursor === "string" ? next.pageInfo.endCursor : null;
    }
  }

  const full = normalizeNode(raw, shop);
  if (!full || !full.movableType) return { ok: false, notFound: false, message: "unreadable discount" };
  return { ok: true, movableType: true, native: full.native, raw };
}
