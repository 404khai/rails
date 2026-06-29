import sensible from "@fastify/sensible";
import Fastify, { type FastifyBaseLogger } from "fastify";

import { verifyNombaSignature, type NombaWebhookPayload } from "./nombaSignature.js";

type CreateAppOptions = {
  logger?: boolean | FastifyBaseLogger;
  webhookSecret: string;
};

type NombaWebhookTransaction = {
  transactionId?: unknown;
  transactionAmount?: unknown;
  aliasAccountNumber?: unknown;
  aliasAccountReference?: unknown;
  type?: unknown;
};

type NombaWebhookBody = NombaWebhookPayload & {
  data?: NombaWebhookPayload["data"] & {
    transaction?: NombaWebhookTransaction;
  };
};

const getHeader = (header: string | string[] | undefined): string | undefined => {
  if (Array.isArray(header)) {
    return header[0];
  }

  return header;
};

const getBodyObject = (body: unknown): NombaWebhookBody | undefined => {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    return body as NombaWebhookBody;
  }

  return undefined;
};

export const createApp = async ({ logger = true, webhookSecret }: CreateAppOptions) => {
  const app = Fastify({ logger });

  await app.register(sensible);

  app.get("/health", async () => ({
    ok: true,
    service: "rails",
  }));

  app.post("/webhooks/nomba", async (request, reply) => {
    const body = getBodyObject(request.body);

    if (!body) {
      return reply.badRequest("Expected JSON webhook payload");
    }

    const signature = getHeader(request.headers["nomba-signature"]);
    const timestamp = getHeader(request.headers["nomba-timestamp"]);
    const verification = verifyNombaSignature({
      payload: body,
      secret: webhookSecret,
      signature,
      timestamp,
    });

    if (!verification.ok) {
      request.log.warn(
        {
          reason: verification.reason,
          eventType: body.event_type,
          requestId: body.requestId,
        },
        "Rejected Nomba webhook",
      );

      return reply.unauthorized("Invalid Nomba webhook signature");
    }

    const transaction = body.data?.transaction;

    request.log.info(
      {
        eventType: body.event_type,
        requestId: body.requestId,
        transactionId: transaction?.transactionId,
        transactionType: transaction?.type,
        aliasAccountNumber: transaction?.aliasAccountNumber,
        aliasAccountReference: transaction?.aliasAccountReference,
        transactionAmount: transaction?.transactionAmount,
      },
      "Accepted Nomba webhook",
    );

    // MVP placeholder: the BullMQ worker will consume this event in the reconciliation engine.
    return reply.code(200).send({
      received: true,
    });
  });

  return app;
};
