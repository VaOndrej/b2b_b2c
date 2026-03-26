PRAGMA foreign_keys=OFF;

CREATE TABLE "new_DiscountRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "configId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "canonicalKey" TEXT NOT NULL,
  "targetId" TEXT,
  "code" TEXT,
  "segment" TEXT,
  "percentOff" REAL NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "stackMode" TEXT NOT NULL DEFAULT 'STACKABLE',
  "minPricePercentOfBasePrice" REAL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DiscountRule_configId_fkey" FOREIGN KEY ("configId") REFERENCES "MarginGuardConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT OR IGNORE INTO "new_DiscountRule" (
  "id",
  "configId",
  "scope",
  "canonicalKey",
  "targetId",
  "code",
  "segment",
  "percentOff",
  "priority",
  "stackMode",
  "minPricePercentOfBasePrice",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "configId",
  "scope",
  CASE
    WHEN "scope" = 'COLLECTION' THEN
      'COLLECTION|' ||
      CASE WHEN "segment" IN ('B2B', 'B2C', 'ALL') THEN "segment" ELSE 'ALL' END ||
      '|COLLECTION:' || TRIM(COALESCE("targetId", ''))
    WHEN "scope" = 'PRODUCT' THEN
      'PRODUCT|' ||
      CASE WHEN "segment" IN ('B2B', 'B2C', 'ALL') THEN "segment" ELSE 'ALL' END ||
      '|PRODUCT:' || TRIM(COALESCE("targetId", ''))
    WHEN "scope" = 'COUPON' THEN
      'COUPON|' ||
      CASE WHEN "segment" IN ('B2B', 'B2C', 'ALL') THEN "segment" ELSE 'ALL' END ||
      '|COUPON:' || UPPER(TRIM(COALESCE("code", "targetId", '')))
    ELSE
      'GLOBAL|' ||
      CASE WHEN "segment" IN ('B2B', 'B2C', 'ALL') THEN "segment" ELSE 'ALL' END ||
      '|GLOBAL'
  END AS "canonicalKey",
  "targetId",
  "code",
  "segment",
  "percentOff",
  "priority",
  "stackMode",
  "minPricePercentOfBasePrice",
  "createdAt",
  "updatedAt"
FROM "DiscountRule"
ORDER BY "createdAt" ASC, "id" ASC;

DROP TABLE "DiscountRule";
ALTER TABLE "new_DiscountRule" RENAME TO "DiscountRule";
CREATE UNIQUE INDEX "DiscountRule_configId_canonicalKey_key"
ON "DiscountRule"("configId", "canonicalKey");

CREATE TABLE "new_DiscountCombinationBlacklistRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "configId" TEXT NOT NULL,
  "canonicalPairKey" TEXT NOT NULL,
  "leftType" TEXT NOT NULL,
  "leftValue" TEXT NOT NULL,
  "rightType" TEXT NOT NULL,
  "rightValue" TEXT NOT NULL,
  "segment" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DiscountCombinationBlacklistRule_configId_fkey" FOREIGN KEY ("configId") REFERENCES "MarginGuardConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT OR IGNORE INTO "new_DiscountCombinationBlacklistRule" (
  "id",
  "configId",
  "canonicalPairKey",
  "leftType",
  "leftValue",
  "rightType",
  "rightValue",
  "segment",
  "createdAt",
  "updatedAt"
)
SELECT
  "id",
  "configId",
  (CASE WHEN "segment" IN ('B2B', 'B2C', 'ALL') THEN "segment" ELSE 'ALL' END) ||
  '|' ||
  MIN(
    CASE
      WHEN "leftType" = 'COUPON_CODE' THEN 'COUPON_CODE:' || UPPER(TRIM(COALESCE("leftValue", '')))
      WHEN "leftType" = 'SCOPE' THEN 'SCOPE:' || CASE WHEN TRIM(COALESCE("leftValue", '')) IN ('GLOBAL', 'COLLECTION', 'PRODUCT', 'COUPON') THEN TRIM(COALESCE("leftValue", '')) ELSE 'GLOBAL' END
      ELSE 'RULE_ID:' || TRIM(COALESCE("leftValue", ''))
    END,
    CASE
      WHEN "rightType" = 'COUPON_CODE' THEN 'COUPON_CODE:' || UPPER(TRIM(COALESCE("rightValue", '')))
      WHEN "rightType" = 'SCOPE' THEN 'SCOPE:' || CASE WHEN TRIM(COALESCE("rightValue", '')) IN ('GLOBAL', 'COLLECTION', 'PRODUCT', 'COUPON') THEN TRIM(COALESCE("rightValue", '')) ELSE 'GLOBAL' END
      ELSE 'RULE_ID:' || TRIM(COALESCE("rightValue", ''))
    END
  ) ||
  '|' ||
  MAX(
    CASE
      WHEN "leftType" = 'COUPON_CODE' THEN 'COUPON_CODE:' || UPPER(TRIM(COALESCE("leftValue", '')))
      WHEN "leftType" = 'SCOPE' THEN 'SCOPE:' || CASE WHEN TRIM(COALESCE("leftValue", '')) IN ('GLOBAL', 'COLLECTION', 'PRODUCT', 'COUPON') THEN TRIM(COALESCE("leftValue", '')) ELSE 'GLOBAL' END
      ELSE 'RULE_ID:' || TRIM(COALESCE("leftValue", ''))
    END,
    CASE
      WHEN "rightType" = 'COUPON_CODE' THEN 'COUPON_CODE:' || UPPER(TRIM(COALESCE("rightValue", '')))
      WHEN "rightType" = 'SCOPE' THEN 'SCOPE:' || CASE WHEN TRIM(COALESCE("rightValue", '')) IN ('GLOBAL', 'COLLECTION', 'PRODUCT', 'COUPON') THEN TRIM(COALESCE("rightValue", '')) ELSE 'GLOBAL' END
      ELSE 'RULE_ID:' || TRIM(COALESCE("rightValue", ''))
    END
  ) AS "canonicalPairKey",
  "leftType",
  "leftValue",
  "rightType",
  "rightValue",
  "segment",
  "createdAt",
  "updatedAt"
FROM "DiscountCombinationBlacklistRule"
ORDER BY "createdAt" ASC, "id" ASC;

DROP TABLE "DiscountCombinationBlacklistRule";
ALTER TABLE "new_DiscountCombinationBlacklistRule" RENAME TO "DiscountCombinationBlacklistRule";
CREATE UNIQUE INDEX "DiscountCombinationBlacklistRule_configId_canonicalPairKey_key"
ON "DiscountCombinationBlacklistRule"("configId", "canonicalPairKey");

PRAGMA foreign_keys=ON;
