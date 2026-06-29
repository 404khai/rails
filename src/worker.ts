import "dotenv/config";

import { Worker } from "bullmq";

import { loadConfig, requireConfig } from "./config.js";
import { createPrismaClient } from "./db.js";
import { deliverOutboundWebhook } from "./outboundWebhooks.js";
import {
  OUTBOUND_WEBHOOK_QUEUE,
  RECONCILIATION_QUEUE,
  createQueueServices,
  type OutboundWebhookJob,
  type ReconciliationJob,
} from "./queues.js";
import { reconcileNombaWebhook, type NombaPaymentWebhook } from "./reconciliation.js";

const config = loadConfig();
const redisUrl = requireConfig(config, "REDIS_URL");
const railsWebhookSecret = requireConfig(config, "RAILS_WEBHOOK_SECRET");
const prisma = createPrismaClient();
const queues = createQueueServices(redisUrl);
const connection = {
  url: redisUrl,
  maxRetriesPerRequest: null,
};

const reconciliationWorker = new Worker<ReconciliationJob>(
  RECONCILIATION_QUEUE,
  async (job) => {
    await reconcileNombaWebhook(prisma, job.data.payload as NombaPaymentWebhook, queues);
  },
  { connection },
);

const outboundWebhookWorker = new Worker<OutboundWebhookJob>(
  OUTBOUND_WEBHOOK_QUEUE,
  async (job) => {
    await deliverOutboundWebhook(prisma, {
      deliveryId: job.data.deliveryId,
      secret: railsWebhookSecret,
    });
  },
  { connection },
);

const shutdown = async () => {
  await Promise.all([reconciliationWorker.close(), outboundWebhookWorker.close()]);
  await queues.close();
  await prisma.$disconnect();
};

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
