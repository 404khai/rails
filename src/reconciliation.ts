import type { Prisma } from "@prisma/client";

import type { PrismaService } from "./db.js";
import { toKobo } from "./money.js";
import type { OutboundWebhookJob, QueueServices } from "./queues.js";

export type ReconciliationStatus =
  | "matched"
  | "underpaid"
  | "overpaid"
  | "misdirected"
  | "duplicate";

export type TransferEventType =
  | "transfer.matched"
  | "transfer.underpaid"
  | "transfer.overpaid"
  | "transfer.misdirected";

export type NombaPaymentWebhook = {
  event_type?: string;
  requestId?: string;
  data?: {
    merchant?: {
      walletId?: string;
      walletBalance?: number;
      userId?: string;
    };
    transaction?: {
      aliasAccountNumber?: string;
      aliasAccountReference?: string;
      fee?: number;
      sessionId?: string;
      type?: string;
      transactionId?: string;
      aliasAccountName?: string;
      responseCode?: string;
      originatingFrom?: string;
      transactionAmount?: number | string;
      narration?: string;
      time?: string;
      aliasAccountType?: string;
    };
    customer?: {
      bankCode?: string;
      senderName?: string;
      bankName?: string;
      accountNumber?: string;
    };
  };
};

export type ReconciliationDecision = {
  status: ReconciliationStatus;
  reason: string;
  eventType?: TransferEventType;
};

export const decideReconciliation = (input: {
  expectedAmountKobo?: number;
  amountKobo: number;
  accountFound: boolean;
  duplicate: boolean;
}): ReconciliationDecision => {
  if (input.duplicate) {
    return {
      status: "duplicate",
      reason: "Nomba transaction has already been processed",
    };
  }

  if (!input.accountFound || input.expectedAmountKobo === undefined) {
    return {
      status: "misdirected",
      reason: "No active Rails virtual account matched this transfer",
      eventType: "transfer.misdirected",
    };
  }

  if (input.amountKobo === input.expectedAmountKobo) {
    return {
      status: "matched",
      reason: "Transfer amount exactly matched the customer expected amount",
      eventType: "transfer.matched",
    };
  }

  if (input.amountKobo < input.expectedAmountKobo) {
    return {
      status: "underpaid",
      reason: "Transfer amount is lower than the customer expected amount",
      eventType: "transfer.underpaid",
    };
  }

  return {
    status: "overpaid",
    reason: "Transfer amount is higher than the customer expected amount",
    eventType: "transfer.overpaid",
  };
};

export const toOutboundEventType = (status: ReconciliationStatus): TransferEventType | undefined => {
  switch (status) {
    case "matched":
      return "transfer.matched";
    case "underpaid":
      return "transfer.underpaid";
    case "overpaid":
      return "transfer.overpaid";
    case "misdirected":
      return "transfer.misdirected";
    case "duplicate":
      return undefined;
  }
};

const parsePaidAt = (value: string | undefined): Date | undefined => {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

export const reconcileNombaWebhook = async (
  prisma: PrismaService,
  payload: NombaPaymentWebhook,
  queues?: Pick<QueueServices, "outboundWebhookQueue">,
): Promise<{ transactionId?: string; status: ReconciliationStatus }> => {
  const transfer = payload.data?.transaction;
  const sender = payload.data?.customer;

  if (!transfer?.transactionAmount) {
    throw new Error("Webhook is missing transaction amount");
  }

  const nombaTransactionId = transfer.transactionId;
  const nombaSessionId = transfer.sessionId;

  const duplicate = Boolean(
    await prisma.transaction.findFirst({
      where: {
        OR: [
          ...(nombaTransactionId ? [{ nombaTransactionId }] : []),
          ...(nombaSessionId ? [{ nombaSessionId }] : []),
        ],
      },
    }),
  );

  const virtualAccount = await prisma.virtualAccount.findFirst({
    where: {
      status: "active",
      OR: [
        ...(transfer.aliasAccountReference
          ? [{ accountRef: transfer.aliasAccountReference }]
          : []),
        ...(transfer.aliasAccountNumber
          ? [{ bankAccountNumber: transfer.aliasAccountNumber }]
          : []),
      ],
    },
    include: {
      customer: true,
    },
  });

  const tenantId = virtualAccount?.tenantId ?? "nomba";
  const amountKobo = toKobo(transfer.transactionAmount);
  const decision = decideReconciliation({
    amountKobo,
    expectedAmountKobo: virtualAccount?.customer.expectedAmountKobo,
    accountFound: Boolean(virtualAccount),
    duplicate,
  });

  if (duplicate) {
    await prisma.reconciliationEvent.create({
      data: {
        tenantId,
        customerId: virtualAccount?.customerId,
        status: "duplicate",
        reason: decision.reason,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    return { status: "duplicate" };
  }

  const transaction = await prisma.$transaction(async (tx) => {
    const createdTransaction = await tx.transaction.create({
      data: {
        tenantId,
        customerId: virtualAccount?.customerId,
        virtualAccountId: virtualAccount?.id,
        nombaTransactionId,
        nombaSessionId,
        requestId: payload.requestId,
        amountKobo,
        expectedAmountKobo: virtualAccount?.customer.expectedAmountKobo,
        status: decision.status,
        eventType: payload.event_type ?? "payment_success",
        transactionType: transfer.type,
        aliasAccountNumber: transfer.aliasAccountNumber,
        aliasAccountReference: transfer.aliasAccountReference,
        senderName: sender?.senderName,
        senderBankName: sender?.bankName,
        senderBankCode: sender?.bankCode,
        senderAccountNumber: sender?.accountNumber,
        narration: transfer.narration,
        paidAt: parsePaidAt(transfer.time),
        rawPayload: payload as Prisma.InputJsonValue,
      },
    });

    await tx.reconciliationEvent.create({
      data: {
        tenantId,
        customerId: virtualAccount?.customerId,
        transactionId: createdTransaction.id,
        status: decision.status,
        reason: decision.reason,
        payload: {
          amountKobo,
          expectedAmountKobo: virtualAccount?.customer.expectedAmountKobo,
          aliasAccountNumber: transfer.aliasAccountNumber,
          aliasAccountReference: transfer.aliasAccountReference,
        },
      },
    });

    return createdTransaction;
  });

  if (decision.eventType) {
    await createOutboundDeliveries(prisma, {
      tenantId,
      eventType: decision.eventType,
      payload: {
        id: transaction.id,
        event: decision.eventType,
        customerId: transaction.customerId,
        virtualAccountId: transaction.virtualAccountId,
        nombaTransactionId: transaction.nombaTransactionId,
        nombaSessionId: transaction.nombaSessionId,
        amount: amountKobo / 100,
        expectedAmount:
          transaction.expectedAmountKobo === null ? undefined : transaction.expectedAmountKobo / 100,
        status: decision.status,
        reason: decision.reason,
        paidAt: transaction.paidAt?.toISOString(),
      },
    }, queues);
  }

  return {
    transactionId: transaction.id,
    status: decision.status,
  };
};

export const createOutboundDeliveries = async (
  prisma: PrismaService,
  input: { tenantId: string; eventType: TransferEventType; payload: Record<string, unknown> },
  queues?: Pick<QueueServices, "outboundWebhookQueue">,
): Promise<void> => {
  const subscriptions = await prisma.outboundWebhookSubscription.findMany({
    where: {
      tenantId: input.tenantId,
      active: true,
      events: {
        has: input.eventType,
      },
    },
  });

  await Promise.all(
    subscriptions.map(async (subscription) => {
      const delivery = await prisma.outboundWebhookDeliveryLog.create({
        data: {
          tenantId: input.tenantId,
          subscriptionId: subscription.id,
          eventId: `${input.eventType}:${String(input.payload.id)}`,
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonValue,
        },
      });

      const job: OutboundWebhookJob = { deliveryId: delivery.id };
      await queues?.outboundWebhookQueue.add("deliver", job, {
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 30_000,
        },
      });
    }),
  );
};
