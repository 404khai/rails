CREATE TYPE "VirtualAccountStatus" AS ENUM ('active', 'expired', 'suspended');
CREATE TYPE "TransactionStatus" AS ENUM ('matched', 'underpaid', 'overpaid', 'misdirected', 'duplicate');
CREATE TYPE "OutboundWebhookDeliveryStatus" AS ENUM ('pending', 'delivered', 'failed');

CREATE TABLE "customers" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "externalReference" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "email" TEXT,
  "expectedAmountKobo" INTEGER NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "virtual_accounts" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT NOT NULL,
  "accountRef" TEXT NOT NULL,
  "accountHolderId" TEXT,
  "bankAccountNumber" TEXT NOT NULL,
  "bankAccountName" TEXT,
  "bankName" TEXT,
  "currency" TEXT NOT NULL DEFAULT 'NGN',
  "status" "VirtualAccountStatus" NOT NULL DEFAULT 'active',
  "nombaCreatedAt" TIMESTAMP(3),
  "rawNombaResponse" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "virtual_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transactions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT,
  "virtualAccountId" TEXT,
  "nombaTransactionId" TEXT,
  "nombaSessionId" TEXT,
  "requestId" TEXT,
  "amountKobo" INTEGER NOT NULL,
  "expectedAmountKobo" INTEGER,
  "status" "TransactionStatus" NOT NULL,
  "eventType" TEXT NOT NULL,
  "transactionType" TEXT,
  "aliasAccountNumber" TEXT,
  "aliasAccountReference" TEXT,
  "senderName" TEXT,
  "senderBankName" TEXT,
  "senderBankCode" TEXT,
  "senderAccountNumber" TEXT,
  "narration" TEXT,
  "paidAt" TIMESTAMP(3),
  "rawPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "reconciliation_events" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "customerId" TEXT,
  "transactionId" TEXT,
  "status" "TransactionStatus" NOT NULL,
  "reason" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reconciliation_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "api_keys" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "prefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbound_webhook_subscriptions" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "events" TEXT[],
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbound_webhook_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbound_webhook_delivery_log" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "subscriptionId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "signature" TEXT,
  "status" "OutboundWebhookDeliveryStatus" NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "responseStatus" INTEGER,
  "responseBody" TEXT,
  "nextAttemptAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "outbound_webhook_delivery_log_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customers_tenantId_externalReference_key" ON "customers"("tenantId", "externalReference");
CREATE INDEX "customers_tenantId_idx" ON "customers"("tenantId");

CREATE UNIQUE INDEX "virtual_accounts_tenantId_accountRef_key" ON "virtual_accounts"("tenantId", "accountRef");
CREATE UNIQUE INDEX "virtual_accounts_tenantId_bankAccountNumber_key" ON "virtual_accounts"("tenantId", "bankAccountNumber");
CREATE INDEX "virtual_accounts_tenantId_customerId_idx" ON "virtual_accounts"("tenantId", "customerId");

CREATE UNIQUE INDEX "transactions_tenantId_nombaTransactionId_key" ON "transactions"("tenantId", "nombaTransactionId");
CREATE UNIQUE INDEX "transactions_tenantId_nombaSessionId_key" ON "transactions"("tenantId", "nombaSessionId");
CREATE INDEX "transactions_tenantId_customerId_paidAt_idx" ON "transactions"("tenantId", "customerId", "paidAt");
CREATE INDEX "transactions_tenantId_status_idx" ON "transactions"("tenantId", "status");

CREATE INDEX "reconciliation_events_tenantId_customerId_createdAt_idx" ON "reconciliation_events"("tenantId", "customerId", "createdAt");

CREATE UNIQUE INDEX "api_keys_keyHash_key" ON "api_keys"("keyHash");
CREATE INDEX "api_keys_tenantId_idx" ON "api_keys"("tenantId");

CREATE INDEX "outbound_webhook_subscriptions_tenantId_active_idx" ON "outbound_webhook_subscriptions"("tenantId", "active");

CREATE UNIQUE INDEX "outbound_webhook_delivery_log_subscriptionId_eventId_key" ON "outbound_webhook_delivery_log"("subscriptionId", "eventId");
CREATE INDEX "outbound_webhook_delivery_log_tenantId_eventType_createdAt_idx" ON "outbound_webhook_delivery_log"("tenantId", "eventType", "createdAt");

ALTER TABLE "virtual_accounts" ADD CONSTRAINT "virtual_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_virtualAccountId_fkey" FOREIGN KEY ("virtualAccountId") REFERENCES "virtual_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reconciliation_events" ADD CONSTRAINT "reconciliation_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "reconciliation_events" ADD CONSTRAINT "reconciliation_events_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "outbound_webhook_delivery_log" ADD CONSTRAINT "outbound_webhook_delivery_log_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "outbound_webhook_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
