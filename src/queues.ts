import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const RECONCILIATION_QUEUE = "rails-reconciliation";
export const OUTBOUND_WEBHOOK_QUEUE = "rails-outbound-webhooks";

export type ReconciliationJob = {
  tenantId?: string;
  payload: unknown;
  receivedAt: string;
};

export type OutboundWebhookJob = {
  deliveryId: string;
};

export type QueueServices = {
  reconciliationQueue: Queue<ReconciliationJob>;
  outboundWebhookQueue: Queue<OutboundWebhookJob>;
  close: () => Promise<void>;
};

export const createQueueServices = (redisUrl: string): QueueServices => {
  const connection = {
    url: redisUrl,
    lazyConnect: true,
    maxRetriesPerRequest: null,
  };

  const reconciliationQueue = new Queue<ReconciliationJob>(RECONCILIATION_QUEUE, {
    connection,
  });
  const outboundWebhookQueue = new Queue<OutboundWebhookJob>(OUTBOUND_WEBHOOK_QUEUE, {
    connection,
  });

  return {
    reconciliationQueue,
    outboundWebhookQueue,
    close: async () => {
      await Promise.all([
        reconciliationQueue.close(),
        outboundWebhookQueue.close(),
      ]);
    },
  };
};

export const isRedisAvailable = async (
  redisUrl: string,
  timeoutMs = 1000,
): Promise<boolean> => {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: timeoutMs,
  });

  redis.on("error", () => undefined);

  try {
    await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
};
