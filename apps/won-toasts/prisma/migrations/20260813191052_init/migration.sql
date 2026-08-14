-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToastAppConfig" (
    "id" TEXT NOT NULL,
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
    "industry" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToastAppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigVersion" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToastEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT,

    CONSTRAINT "ToastEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "firstName" TEXT,
    "city" TEXT,
    "product" TEXT,
    "customerId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "orderId" TEXT,

    CONSTRAINT "SaleEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "variant" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL,
    "dims" JSONB,
    "dwellMs" INTEGER,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "control" JSONB NOT NULL,
    "variant" JSONB NOT NULL,
    "variantPercent" INTEGER NOT NULL DEFAULT 50,
    "holdoutPercent" INTEGER NOT NULL DEFAULT 0,
    "gatingMode" TEXT NOT NULL DEFAULT 'test_first',
    "baseline" JSONB,
    "audit" JSONB,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToastRollup" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "device" TEXT NOT NULL DEFAULT 'unknown',
    "pageType" TEXT NOT NULL DEFAULT 'unknown',
    "customerState" TEXT NOT NULL DEFAULT 'unknown',
    "abVariant" INTEGER NOT NULL DEFAULT 0,
    "counters" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToastRollup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ToastAppConfig_shop_key" ON "ToastAppConfig"("shop");

-- CreateIndex
CREATE INDEX "ConfigVersion_shop_createdAt_idx" ON "ConfigVersion"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "ToastEvent_shop_kind_at_idx" ON "ToastEvent"("shop", "kind", "at");

-- CreateIndex
CREATE UNIQUE INDEX "ToastEvent_shop_orderId_key" ON "ToastEvent"("shop", "orderId");

-- CreateIndex
CREATE INDEX "SaleEvent_shop_at_idx" ON "SaleEvent"("shop", "at");

-- CreateIndex
CREATE INDEX "SaleEvent_shop_customerId_idx" ON "SaleEvent"("shop", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleEvent_shop_orderId_key" ON "SaleEvent"("shop", "orderId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_shop_at_idx" ON "AnalyticsEvent"("shop", "at");

-- CreateIndex
CREATE INDEX "Experiment_shop_status_idx" ON "Experiment"("shop", "status");

-- CreateIndex
CREATE INDEX "ToastRollup_shop_date_idx" ON "ToastRollup"("shop", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ToastRollup_shop_date_type_device_pageType_customerState_ab_key" ON "ToastRollup"("shop", "date", "type", "device", "pageType", "customerState", "abVariant");

