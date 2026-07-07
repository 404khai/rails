import type { PrismaService } from "../db.js";
import { deliverOutboundWebhook } from "../outboundWebhooks.js";
import { reconcileNombaWebhook, type NombaPaymentWebhook } from "../reconciliation.js";
import type { JobProcessor } from "./types.js";

const RECONCILIATION_ATTEMPTS = 5;
const OUTBOUND_ATTEMPTS = 5;
const BACKOFF_BASE_MS = 30_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export const createInlineJobProcessor = (
  prisma: PrismaService,
  railsWebhookSecret: string,
): JobProcessor => {
  const runOutboundWithRetry = async (deliveryId: string, attempt = 1): Promise<void> => {
    try {
      await deliverOutboundWebhook(prisma, {
        deliveryId,
        secret: railsWebhookSecret,
      });
    } catch (error) {
      if (attempt >= OUTBOUND_ATTEMPTS) {
        console.error("Outbound webhook failed after max attempts", { deliveryId, error });
        return;
      }

      const delay = BACKOFF_BASE_MS * 2 ** (attempt - 1);
      await sleep(delay);
      await runOutboundWithRetry(deliveryId, attempt + 1);
    }
  };

  const outboundDelivery: Pick<JobProcessor, "enqueueOutboundDelivery"> = {
    enqueueOutboundDelivery: async (deliveryId: string) => {
      void runOutboundWithRetry(deliveryId);
    },
  };

  const runReconciliationWithRetry = async (payload: unknown, attempt = 1): Promise<void> => {
    try {
      await reconcileNombaWebhook(prisma, payload as NombaPaymentWebhook, outboundDelivery);
    } catch (error) {
      if (attempt >= RECONCILIATION_ATTEMPTS) {
        console.error("Reconciliation failed after max attempts", error);
        return;
      }

      const delay = BACKOFF_BASE_MS * 2 ** (attempt - 1);
      await sleep(delay);
      await runReconciliationWithRetry(payload, attempt + 1);
    }
  };

  return {
    mode: "inline",
    enqueueReconciliation: async (payload) => {
      void runReconciliationWithRetry(payload);
    },
    enqueueOutboundDelivery: async (deliveryId) => {
      void runOutboundWithRetry(deliveryId);
    },
    close: async () => undefined,
  };
};
