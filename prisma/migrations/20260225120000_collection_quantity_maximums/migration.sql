CREATE TABLE "CollectionQuantityRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "configId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "segment" TEXT,
    "maxOrderQuantity" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CollectionQuantityRule_configId_fkey" FOREIGN KEY ("configId") REFERENCES "MarginGuardConfig" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CollectionQuantityRule_configId_collectionId_segment_key"
ON "CollectionQuantityRule"("configId", "collectionId", "segment");
