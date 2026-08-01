CREATE TABLE "DiscountRule" (
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

CREATE UNIQUE INDEX "DiscountRule_configId_canonicalKey_key"
ON "DiscountRule"("configId", "canonicalKey");

CREATE TABLE "DiscountCombinationBlacklistRule" (
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

CREATE UNIQUE INDEX "DiscountCombinationBlacklistRule_configId_canonicalPairKey_key"
ON "DiscountCombinationBlacklistRule"("configId", "canonicalPairKey");

CREATE TABLE "DiscountSegmentCap" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "configId" TEXT NOT NULL,
  "segment" TEXT NOT NULL,
  "maxCombinedPercentOff" REAL NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DiscountSegmentCap_configId_fkey" FOREIGN KEY ("configId") REFERENCES "MarginGuardConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DiscountSegmentCap_configId_segment_key"
ON "DiscountSegmentCap"("configId", "segment");
