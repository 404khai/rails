import "dotenv/config";

import { Worker } from "bullmq";

import { loadConfig, requireConfig } from "./config.js";
import { createPrismaClient } from "./db.js";
import { createOutboundWebhookProducer } from "./jobs/bullmqProcessor.js";
import { createWorkerConnection, getBullmqWorkerOptions } from "./jobs/redis.js";
import { deliverOutboundWebhook } from "./outboundWebhooks.js";
import {
  OUTBOUND_WEBHOOK_QUEUE,
  RECONCILIATION_QUEUE,
  type OutboundWebhookJob,
  type ReconciliationJob,
} from "./queues.js";
import { reconcileNombaWebhook, type NombaPaymentWebhook } from "./reconciliation.js";

const config = loadConfig();

if (config.JOB_PROCESSOR !== "bullmq" || !config.BULLMQ_WORKERS_ENABLED) {
  console.log(
    "BullMQ workers are disabled (set JOB_PROCESSOR=bullmq and BULLMQ_WORKERS_ENABLED=true to run workers).",
  );
  process.exit(0);
}

const redisUrl = requireConfig(config, "REDIS_URL");
const railsWebhookSecret = requireConfig(config, "RAILS_WEBHOOK_SECRET");
const prisma = createPrismaClient();
const outboundProducer = createOutboundWebhookProducer(redisUrl);
const workerOptions = getBullmqWorkerOptions(config);
const reconciliationConnection = createWorkerConnection(redisUrl);
const outboundConnection = createWorkerConnection(redisUrl);

const outboundDelivery = {
  enqueueOutboundDelivery: async (deliveryId: string) => {
    await outboundProducer.outboundWebhookQueue.add("deliver", { deliveryId });
  },
};

const reconciliationWorker = new Worker<ReconciliationJob>(
  RECONCILIATION_QUEUE,
  async (job) => {
    await reconcileNombaWebhook(prisma, job.data.payload as NombaPaymentWebhook, outboundDelivery);
  },
  {
    connection: reconciliationConnection,
    ...workerOptions,
  },
);

const outboundWebhookWorker = new Worker<OutboundWebhookJob>(
  OUTBOUND_WEBHOOK_QUEUE,
  async (job) => {
    await deliverOutboundWebhook(prisma, {
      deliveryId: job.data.deliveryId,
      secret: railsWebhookSecret,
    });
  },
  {
    connection: outboundConnection,
    ...workerOptions,
  },
);

const shutdown = async () => {
  await Promise.all([reconciliationWorker.close(), outboundWebhookWorker.close()]);
  await outboundProducer.close();
  await prisma.$disconnect();
};

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
