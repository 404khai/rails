import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { Prisma } from "@prisma/client";
import Fastify, { type FastifyBaseLogger, type FastifyRequest } from "fastify";

import { createApiKey } from "./apiKeys.js";
import { requireAuth, type AuthContext } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { PrismaService } from "./db.js";
import { toKobo, fromKobo } from "./money.js";
import type { NombaClient } from "./nombaClient.js";
import { verifyNombaSignature, type NombaWebhookPayload } from "./nombaSignature.js";
import type { QueueServices } from "./queues.js";

type CreateAppOptions = {
  logger?: boolean | FastifyBaseLogger;
  webhookSecret: string;
  config?: Partial<AppConfig>;
  prisma?: PrismaService;
  queues?: QueueServices;
  nombaClient?: NombaClient;
};

type NombaWebhookTransaction = {
  transactionId?: unknown;
  transactionAmount?: unknown;
  aliasAccountNumber?: unknown;
  aliasAccountReference?: unknown;
  aliasAccountType?: unknown;
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

const requirePrisma = (request: FastifyRequest, prisma: PrismaService | undefined): PrismaService => {
  if (!prisma) {
    throw request.server.httpErrors.serviceUnavailable("Database is not configured");
  }

  return prisma;
};

const requireAuthenticated = async (
  request: FastifyRequest,
  prisma: PrismaService | undefined,
): Promise<AuthContext> => requireAuth(request, requirePrisma(request, prisma));

const getCustomer = async (prisma: PrismaService, auth: AuthContext, id: string) =>
  prisma.customer.findFirst({
    where: {
      tenantId: auth.tenantId,
      OR: [{ id }, { externalReference: id }],
    },
  });

const serializeTransaction = (transaction: {
  id: string;
  nombaTransactionId: string | null;
  nombaSessionId: string | null;
  amountKobo: number;
  expectedAmountKobo: number | null;
  status: string;
  eventType: string;
  senderName: string | null;
  senderBankName: string | null;
  narration: string | null;
  paidAt: Date | null;
  createdAt: Date;
}) => ({
  id: transaction.id,
  nombaTransactionId: transaction.nombaTransactionId,
  nombaSessionId: transaction.nombaSessionId,
  amount: fromKobo(transaction.amountKobo),
  expectedAmount:
    transaction.expectedAmountKobo === null ? null : fromKobo(transaction.expectedAmountKobo),
  status: transaction.status,
  eventType: transaction.eventType,
  senderName: transaction.senderName,
  senderBankName: transaction.senderBankName,
  narration: transaction.narration,
  paidAt: transaction.paidAt?.toISOString() ?? null,
  createdAt: transaction.createdAt.toISOString(),
});

const bearerAuthSecurity = [{ BearerAuth: [] }] as const;

const openApiDocument = {
  info: {
    title: "Rails API",
    description: "Nomba virtual-account reconciliation infrastructure.",
    version: "1.0.0",
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http" as const,
        scheme: "bearer" as const,
        bearerFormat: "API key",
        description:
          "Rails tenant API key from POST /api-keys. Use Authorization: Bearer <key>.",
      },
    },
  },
};

export const createApp = async ({
  logger = true,
  webhookSecret,
  config,
  prisma,
  queues,
  nombaClient,
}: CreateAppOptions) => {
  const app = Fastify({ logger });

  await app.register(sensible);
  await app.register(swagger, {
    openapi: openApiDocument,
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      persistAuthorization: true,
    },
  });

  app.get(
    "/health",
    {
      schema: {
        security: [],
      },
    },
    async () => ({
      ok: true,
      service: "rails",
    }),
  );

  app.post<{
    Body: {
      tenantId?: string;
      label?: string;
    };
  }>(
    "/api-keys",
    {
      schema: {
        security: [],
        body: {
          type: "object",
          properties: {
            tenantId: { type: "string", default: "demo-school" },
            label: { type: "string", default: "Demo API key" },
          },
        },
      },
    },
    async (request, reply) => {
      const database = requirePrisma(request, prisma);
      const existingKeyCount = await database.apiKey.count();
      const bootstrapToken = config?.ADMIN_BOOTSTRAP_TOKEN;
      const providedToken = getHeader(request.headers["x-bootstrap-token"]);

      if (existingKeyCount > 0 && (!bootstrapToken || providedToken !== bootstrapToken)) {
        throw app.httpErrors.unauthorized("API key bootstrap token is required");
      }

      const apiKey = await createApiKey(database, {
        tenantId: request.body.tenantId ?? "demo-school",
        label: request.body.label ?? "Demo API key",
      });

      return reply.code(201).send(apiKey);
    },
  );

  app.post<{
    Body: {
      externalReference: string;
      name: string;
      email?: string;
      expectedAmount: number;
      metadata?: Record<string, unknown>;
    };
  }>(
    "/customers",
    {
      schema: {
        security: bearerAuthSecurity,
        body: {
          type: "object",
          required: ["externalReference", "name", "expectedAmount"],
          properties: {
            externalReference: { type: "string" },
            name: { type: "string" },
            email: { type: "string" },
            expectedAmount: { type: "number", minimum: 0 },
            metadata: { type: "object", additionalProperties: true },
          },
        },
      },
    },
    async (request, reply) => {
      const database = requirePrisma(request, prisma);
      const auth = await requireAuthenticated(request, database);
      const customer = await database.customer.upsert({
        where: {
          tenantId_externalReference: {
            tenantId: auth.tenantId,
            externalReference: request.body.externalReference,
          },
        },
        update: {
          name: request.body.name,
          email: request.body.email,
          expectedAmountKobo: toKobo(request.body.expectedAmount),
          metadata: request.body.metadata as Prisma.InputJsonValue | undefined,
        },
        create: {
          tenantId: auth.tenantId,
          externalReference: request.body.externalReference,
          name: request.body.name,
          email: request.body.email,
          expectedAmountKobo: toKobo(request.body.expectedAmount),
          metadata: request.body.metadata as Prisma.InputJsonValue | undefined,
        },
      });

      return reply.code(201).send({
        id: customer.id,
        externalReference: customer.externalReference,
        name: customer.name,
        email: customer.email,
        expectedAmount: fromKobo(customer.expectedAmountKobo),
      });
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      accountName?: string;
      bvn?: string;
    };
  }>(
    "/customers/:id/accounts",
    {
      schema: {
        security: bearerAuthSecurity,
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
        body: {
          type: "object",
          properties: {
            accountName: { type: "string" },
            bvn: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const database = requirePrisma(request, prisma);
      const auth = await requireAuthenticated(request, database);

      if (!nombaClient) {
        throw app.httpErrors.serviceUnavailable("Nomba client is not configured");
      }

      const customer = await getCustomer(database, auth, request.params.id);

      if (!customer) {
        throw app.httpErrors.notFound("Customer not found");
      }

      const existingAccount = await database.virtualAccount.findFirst({
        where: {
          tenantId: auth.tenantId,
          customerId: customer.id,
          status: "active",
        },
      });

      if (existingAccount) {
        return {
          id: existingAccount.id,
          customerId: customer.id,
          accountRef: existingAccount.accountRef,
          bankAccountNumber: existingAccount.bankAccountNumber,
          bankAccountName: existingAccount.bankAccountName,
          bankName: existingAccount.bankName,
          currency: existingAccount.currency,
          reused: true,
        };
      }

      const accountRef = `rails_${customer.externalReference}_${customer.id.slice(0, 8)}`.slice(0, 64);
      const accountName = request.body.accountName ?? customer.name;
      const nombaAccount = await nombaClient.createVirtualAccount({
        accountRef,
        accountName,
        bvn: request.body.bvn,
      });

      if (!nombaAccount.bankAccountNumber) {
        throw app.httpErrors.badGateway("Nomba did not return a bank account number");
      }

      const account = await database.virtualAccount.create({
        data: {
          tenantId: auth.tenantId,
          customerId: customer.id,
          accountRef: nombaAccount.accountRef,
          accountHolderId: nombaAccount.accountHolderId,
          bankAccountNumber: nombaAccount.bankAccountNumber,
          bankAccountName: nombaAccount.bankAccountName,
          bankName: nombaAccount.bankName,
          currency: nombaAccount.currency ?? "NGN",
          status: nombaAccount.expired ? "expired" : "active",
          nombaCreatedAt: nombaAccount.createdAt ? new Date(nombaAccount.createdAt) : undefined,
          rawNombaResponse: nombaAccount as Prisma.InputJsonValue,
        },
      });

      return reply.code(201).send({
        id: account.id,
        customerId: customer.id,
        accountRef: account.accountRef,
        bankAccountNumber: account.bankAccountNumber,
        bankAccountName: account.bankAccountName,
        bankName: account.bankName,
        currency: account.currency,
        reused: false,
      });
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: {
      status?: string;
      dateFrom?: string;
      dateTo?: string;
      limit?: string;
      cursor?: string;
    };
  }>("/customers/:id/transactions", {
    schema: {
      security: bearerAuthSecurity,
    },
    handler: async (request) => {
    const database = requirePrisma(request, prisma);
    const auth = await requireAuthenticated(request, database);
    const customer = await getCustomer(database, auth, request.params.id);

    if (!customer) {
      throw app.httpErrors.notFound("Customer not found");
    }

    const limit = Math.min(Number(request.query.limit ?? 50), 100);
    const transactions = await database.transaction.findMany({
      where: {
        tenantId: auth.tenantId,
        customerId: customer.id,
        status: request.query.status as never,
        paidAt: {
          gte: request.query.dateFrom ? new Date(request.query.dateFrom) : undefined,
          lte: request.query.dateTo ? new Date(request.query.dateTo) : undefined,
        },
      },
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      take: limit + 1,
      ...(request.query.cursor
        ? {
            cursor: { id: request.query.cursor },
            skip: 1,
          }
        : {}),
    });
    const page = transactions.slice(0, limit);

    return {
      data: page.map(serializeTransaction),
      nextCursor: transactions.length > limit ? transactions[limit]?.id : null,
    };
    },
  });

  app.get<{
    Params: { id: string };
    Querystring: {
      dateFrom?: string;
      dateTo?: string;
    };
  }>("/customers/:id/statement", {
    schema: {
      security: bearerAuthSecurity,
    },
    handler: async (request) => {
    const database = requirePrisma(request, prisma);
    const auth = await requireAuthenticated(request, database);
    const customer = await getCustomer(database, auth, request.params.id);

    if (!customer) {
      throw app.httpErrors.notFound("Customer not found");
    }

    const paidAt = {
      gte: request.query.dateFrom ? new Date(request.query.dateFrom) : undefined,
      lte: request.query.dateTo ? new Date(request.query.dateTo) : undefined,
    };
    const transactions = await database.transaction.findMany({
      where: {
        tenantId: auth.tenantId,
        customerId: customer.id,
        paidAt,
      },
      orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }],
    });
    const totals = transactions.reduce(
      (summary, transaction) => {
        summary.receivedKobo += transaction.amountKobo;
        summary.byStatus[transaction.status] =
          (summary.byStatus[transaction.status] ?? 0) + transaction.amountKobo;
        return summary;
      },
      { receivedKobo: 0, byStatus: {} as Record<string, number> },
    );

    return {
      customer: {
        id: customer.id,
        externalReference: customer.externalReference,
        name: customer.name,
        expectedAmount: fromKobo(customer.expectedAmountKobo),
      },
      period: {
        dateFrom: request.query.dateFrom ?? null,
        dateTo: request.query.dateTo ?? null,
      },
      totals: {
        received: fromKobo(totals.receivedKobo),
        outstanding: fromKobo(Math.max(customer.expectedAmountKobo - totals.receivedKobo, 0)),
        byStatus: Object.fromEntries(
          Object.entries(totals.byStatus).map(([status, amountKobo]) => [
            status,
            fromKobo(amountKobo),
          ]),
        ),
      },
      transactions: transactions.map(serializeTransaction),
    };
    },
  });

  app.post<{
    Body: {
      url: string;
      events: string[];
    };
  }>(
    "/webhook-subscriptions",
    {
      schema: {
        security: bearerAuthSecurity,
        body: {
          type: "object",
          required: ["url", "events"],
          properties: {
            url: { type: "string", format: "uri" },
            events: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "transfer.matched",
                  "transfer.misdirected",
                  "transfer.underpaid",
                  "transfer.overpaid",
                ],
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const database = requirePrisma(request, prisma);
      const auth = await requireAuthenticated(request, database);
      const subscription = await database.outboundWebhookSubscription.create({
        data: {
          tenantId: auth.tenantId,
          url: request.body.url,
          events: request.body.events,
        },
      });

      return reply.code(201).send({
        id: subscription.id,
        url: subscription.url,
        events: subscription.events,
        active: subscription.active,
      });
    },
  );

  app.post(
    "/webhooks/nomba",
    {
      schema: {
        security: [],
      },
    },
    async (request, reply) => {
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
    const isVirtualAccountPayment =
      body.event_type === "payment_success" &&
      transaction?.type === "vact_transfer" &&
      transaction?.aliasAccountType === "VIRTUAL";

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

    if (isVirtualAccountPayment) {
      await queues?.reconciliationQueue.add(
        "reconcile",
        {
          payload: body,
          receivedAt: new Date().toISOString(),
        },
        {
          attempts: 5,
          backoff: {
            type: "exponential",
            delay: 30_000,
          },
          removeOnComplete: 100,
        },
      );
    } else {
      request.log.info(
        {
          eventType: body.event_type,
          transactionType: transaction?.type,
          aliasAccountType: transaction?.aliasAccountType,
        },
        "Ignored non-virtual-account Nomba webhook",
      );
    }

    return reply.code(200).send({
      received: true,
      queued: Boolean(queues && isVirtualAccountPayment),
    });
    },
  );

  return app;
};
