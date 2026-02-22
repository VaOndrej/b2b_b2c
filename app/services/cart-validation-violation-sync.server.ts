import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import prisma from "../db.server";
import { recordMarginViolation } from "./margin-guard-config.server";

interface FunctionRunLogLine {
  id?: string;
  quantity?: number;
  cost?: {
    amountPerQuantity?: { amount?: string };
    subtotalAmount?: { amount?: string };
    totalAmount?: { amount?: string };
  };
  merchandise?: {
    __typename?: string;
    product?: { id?: string };
  };
}

interface FunctionRunLog {
  storeName?: string;
  logTimestamp?: string;
  payload?: {
    input?: {
      cart?: {
        buyerIdentity?: {
          customer?: { hasAnyTag?: boolean } | null;
        } | null;
        lines?: FunctionRunLogLine[];
      };
      validation?: {
        metafield?: {
          jsonValue?: {
            globalMinPricePercent?: number;
            b2bGlobalMinPricePercent?: number;
            allowZeroFinalPrice?: boolean;
            perProductFloorPercents?: Record<string, number>;
            perProductAllowZeroFinalPrice?: Record<string, boolean>;
            perProductFloorPercentsB2C?: Record<string, number>;
            perProductFloorPercentsB2B?: Record<string, number>;
            perProductAllowZeroFinalPriceB2C?: Record<string, boolean>;
            perProductAllowZeroFinalPriceB2B?: Record<string, boolean>;
          };
        } | null;
      };
    };
    output?: {
      operations?: Array<{
        validationAdd?: { errors?: unknown[] };
      }>;
    };
  };
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolveBaseUnitPrice(line: FunctionRunLogLine): number {
  const quantity = Math.max(1, toNumber(line.quantity, 1));
  const subtotal = toNumber(line.cost?.subtotalAmount?.amount, NaN);
  if (Number.isFinite(subtotal)) {
    return roundMoney(subtotal / quantity);
  }
  return roundMoney(toNumber(line.cost?.amountPerQuantity?.amount, 0));
}

function resolveFinalUnitPrice(line: FunctionRunLogLine): number {
  const quantity = Math.max(1, toNumber(line.quantity, 1));
  const total = toNumber(line.cost?.totalAmount?.amount, NaN);
  if (Number.isFinite(total)) {
    return roundMoney(total / quantity);
  }
  return roundMoney(toNumber(line.cost?.amountPerQuantity?.amount, 0));
}

function hasBlockingErrors(log: FunctionRunLog): boolean {
  const operations = log.payload?.output?.operations ?? [];
  return operations.some(
    (operation) => (operation.validationAdd?.errors?.length ?? 0) > 0,
  );
}

function resolveSource(logTimestamp: string, lineId: string, productId: string): string {
  return `shopify_function_checkout:${logTimestamp}:${lineId}:${productId}`;
}

export async function syncLiveCheckoutViolationsFromFunctionLogs(
  shop: string,
): Promise<number> {
  const db = prisma as any;
  if (!db.marginViolationLog) {
    return 0;
  }

  const logsDir = path.resolve(process.cwd(), ".shopify", "logs");
  let files: string[] = [];
  try {
    files = await readdir(logsDir);
  } catch {
    return 0;
  }

  const candidateFiles = files
    .filter((name) => name.includes("extensions_margin-guard-cart-validation"))
    .sort()
    .reverse()
    .slice(0, 200);

  let insertedCount = 0;

  for (const fileName of candidateFiles) {
    const filePath = path.join(logsDir, fileName);
    let parsed: FunctionRunLog;
    try {
      parsed = JSON.parse(await readFile(filePath, "utf8")) as FunctionRunLog;
    } catch {
      continue;
    }

    if (parsed.storeName !== shop) {
      continue;
    }
    if (!hasBlockingErrors(parsed)) {
      continue;
    }

    const cart = parsed.payload?.input?.cart;
    const config = parsed.payload?.input?.validation?.metafield?.jsonValue ?? {};
    const lines = cart?.lines ?? [];
    const isB2B = Boolean(cart?.buyerIdentity?.customer?.hasAnyTag);
    const globalFloorPercent = isB2B
      ? toNumber(config.b2bGlobalMinPricePercent, 70)
      : toNumber(config.globalMinPricePercent, 70);
    const perProductFloors = isB2B
      ? (config.perProductFloorPercentsB2B ?? {})
      : (config.perProductFloorPercentsB2C ?? config.perProductFloorPercents ?? {});
    const perProductAllowZero = isB2B
      ? (config.perProductAllowZeroFinalPriceB2B ?? {})
      : (config.perProductAllowZeroFinalPriceB2C ??
        config.perProductAllowZeroFinalPrice ??
        {});
    const globalAllowZero = Boolean(config.allowZeroFinalPrice);
    const segment = isB2B ? "B2B" : "B2C";
    const logTimestamp = parsed.logTimestamp ?? fileName;

    for (const line of lines) {
      const productId =
        line.merchandise?.__typename === "ProductVariant"
          ? line.merchandise.product?.id
          : undefined;
      if (!productId) {
        continue;
      }

      const lineFloorPercent =
        perProductFloors[productId] != null
          ? toNumber(perProductFloors[productId], globalFloorPercent)
          : globalFloorPercent;
      const lineAllowZero =
        perProductAllowZero[productId] != null
          ? Boolean(perProductAllowZero[productId])
          : globalAllowZero;
      const basePrice = resolveBaseUnitPrice(line);
      const finalPrice = resolveFinalUnitPrice(line);
      const floorPrice = roundMoney(basePrice * (lineFloorPercent / 100));

      const violationAmount =
        finalPrice <= 0 && !lineAllowZero
          ? roundMoney(Math.max(0, floorPrice - finalPrice))
          : roundMoney(Math.max(0, floorPrice - finalPrice));

      if (violationAmount <= 0) {
        continue;
      }

      const source = resolveSource(
        logTimestamp,
        String(line.id ?? "unknown"),
        productId,
      );
      const exists = await db.marginViolationLog.findFirst({
        where: { source },
      });
      if (exists) {
        continue;
      }

      await recordMarginViolation({
        shop,
        productId,
        segment,
        basePrice,
        finalPrice,
        floorPrice,
        violationAmount,
        source,
      });
      insertedCount += 1;
    }
  }

  return insertedCount;
}
