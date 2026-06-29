import type { Prisma } from "@prisma/client";

import type { PrismaService } from "./db.js";
import { generateRailsWebhookSignature } from "./outboundSignature.js";

export const deliverOutboundWebhook = async (
  prisma: PrismaService,
  input: { deliveryId: string; secret: string; fetchImpl?: typeof fetch },
): Promise<void> => {
  const fetchImpl = input.fetchImpl ?? fetch;
  const delivery = await prisma.outboundWebhookDeliveryLog.findUnique({
    where: { id: input.deliveryId },
    include: { subscription: true },
  });

  if (!delivery || !delivery.subscription.active) {
    return;
  }

  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    id: delivery.eventId,
    type: delivery.eventType,
    createdAt: delivery.createdAt.toISOString(),
    data: delivery.payload,
  });
  const signature = generateRailsWebhookSignature({
    secret: input.secret,
    timestamp,
    eventId: delivery.eventId,
    eventType: delivery.eventType,
    body,
  });

  let responseStatus: number | undefined;
  let responseBody: string | undefined;

  try {
    const response = await fetchImpl(delivery.subscription.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "rails-event-id": delivery.eventId,
        "rails-event-type": delivery.eventType,
        "rails-signature": signature,
        "rails-signature-algorithm": "HmacSHA256",
        "rails-signature-version": "1.0.0",
        "rails-timestamp": timestamp,
      },
      body,
    });
    responseStatus = response.status;
    responseBody = await response.text().catch(() => undefined);

    await prisma.outboundWebhookDeliveryLog.update({
      where: { id: delivery.id },
      data: {
        attempts: { increment: 1 },
        signature,
        responseStatus,
        responseBody: responseBody?.slice(0, 4000),
        status: response.ok ? "delivered" : "failed",
        deliveredAt: response.ok ? new Date() : undefined,
      },
    });

    if (!response.ok) {
      throw new Error(`Outbound webhook returned ${response.status}`);
    }
  } catch (error) {
    await prisma.outboundWebhookDeliveryLog.update({
      where: { id: delivery.id },
      data: {
        attempts: { increment: 1 },
        signature,
        responseStatus,
        responseBody: responseBody?.slice(0, 4000) ?? String(error).slice(0, 4000),
        status: "failed",
        nextAttemptAt: new Date(Date.now() + 60_000),
      } satisfies Prisma.OutboundWebhookDeliveryLogUpdateInput,
    });

    throw error;
  }
};
