-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ToastAppConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "global" JSONB,
    "theme" JSONB,
    "byType" JSONB,
    "cartEvents" JSONB,
    "messages" JSONB,
    "locales" JSONB,
    "milestones" JSONB,
    "targeting" JSONB,
    "notifications" JSONB,
    "exclusions" JSONB,
    "benchmarkOptOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_ToastAppConfig" ("byType", "cartEvents", "createdAt", "enabled", "exclusions", "global", "id", "locales", "messages", "milestones", "notifications", "plan", "shop", "targeting", "theme", "updatedAt", "version") SELECT "byType", "cartEvents", "createdAt", "enabled", "exclusions", "global", "id", "locales", "messages", "milestones", "notifications", "plan", "shop", "targeting", "theme", "updatedAt", "version" FROM "ToastAppConfig";
DROP TABLE "ToastAppConfig";
ALTER TABLE "new_ToastAppConfig" RENAME TO "ToastAppConfig";
CREATE UNIQUE INDEX "ToastAppConfig_shop_key" ON "ToastAppConfig"("shop");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
