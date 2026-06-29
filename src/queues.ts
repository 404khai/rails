import { Queue } from "bullmq";

export const RECONCILIATION_QUEUE = "rails:reconciliation";
export const OUTBOUND_WEBHOOK_QUEUE = "rails:outbound-webhooks";

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
