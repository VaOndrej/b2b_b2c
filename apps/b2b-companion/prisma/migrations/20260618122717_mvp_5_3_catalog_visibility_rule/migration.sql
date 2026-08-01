-- CreateTable
CREATE TABLE "CatalogVisibilityRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "catalogId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "handle" TEXT,
    "visibilityMode" TEXT NOT NULL DEFAULT 'HIDDEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CatalogVisibilityRule_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "PriceCatalog" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogVisibilityRule_catalogId_scope_targetId_key" ON "CatalogVisibilityRule"("catalogId", "scope", "targetId");
