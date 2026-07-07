import { Queue } from "bullmq";

import type { AppConfig } from "../config.js";
import {
  OUTBOUND_WEBHOOK_QUEUE,
  RECONCILIATION_QUEUE,
  type OutboundWebhookJob,
  type ReconciliationJob,
} from "../queues.js";
import { createQueueConnection } from "./redis.js";
import type { JobProcessor } from "./types.js";

const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: {
    type: "exponential" as const,
    delay: 30_000,
  },
  removeOnComplete: 100,
};

export const createBullmqJobProcessor = (
  redisUrl: string,
  _config: AppConfig,
): JobProcessor => {
  const connection = createQueueConnection(redisUrl);

  const reconciliationQueue = new Queue<ReconciliationJob>(RECONCILIATION_QUEUE, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  const outboundWebhookQueue = new Queue<OutboundWebhookJob>(OUTBOUND_WEBHOOK_QUEUE, {
    connection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  return {
    mode: "bullmq",
    enqueueReconciliation: async (payload, receivedAt) => {
      await reconciliationQueue.add("reconcile", {
        payload,
        receivedAt,
      });
    },
    enqueueOutboundDelivery: async (deliveryId) => {
      await outboundWebhookQueue.add("deliver", { deliveryId });
    },
    close: async () => {
      await Promise.all([reconciliationQueue.close(), outboundWebhookQueue.close()]);
    },
  };
};

export const createOutboundWebhookProducer = (redisUrl: string) => {
  const outboundWebhookQueue = new Queue<OutboundWebhookJob>(OUTBOUND_WEBHOOK_QUEUE, {
    connection: createQueueConnection(redisUrl),
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
  });

  return {
    outboundWebhookQueue,
    close: async () => {
      await outboundWebhookQueue.close();
    },
  };
};
