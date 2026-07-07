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

export { pingRedis as isRedisAvailable } from "./jobs/redis.js";
