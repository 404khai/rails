import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { generateNombaSignature } from "../src/nombaSignature.js";

const secret = "sampleSecret";
const timestamp = "2025-09-29T10:51:44Z";
const payload = {
  event_type: "payment_success",
  requestId: "45f2dc2d-d559-4773-bba3-2d5ec17b2e20",
  data: {
    merchant: {
      walletId: "6756ff80aafe04a795f18b3",
      userId: "b7b10e81-e57d-41d0-8f4e-f4e23a132bbf",
    },
    transaction: {
      aliasAccountNumber: "5343270516",
      aliasAccountReference: "sampleAccountReference",
      transactionAmount: 10,
      type: "vact_transfer",
      aliasAccountType: "VIRTUAL",
      transactionId: "API-VACT_TRA-B7B10-0435b274-807a-4bc7-8abe-9db",
      responseCode: "",
      time: "2025-09-29T10:51:44Z",
    },
  },
};

const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];

const buildApp = async () => {
  const app = await createApp({
    logger: false,
    webhookSecret: secret,
  });

  apps.push(app);
  return app;
};

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("Nomba webhook route", () => {
  it("accepts a valid signed webhook", async () => {
    const app = await buildApp();
    const signature = generateNombaSignature(payload, secret, timestamp);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/nomba",
      headers: {
        "nomba-signature": signature,
        "nomba-timestamp": timestamp,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true, queued: false });
  });

  it("enqueues a verified virtual account transfer when a job processor is configured", async () => {
    const enqueueReconciliation = vi.fn().mockResolvedValue(undefined);
    const app = await createApp({
      logger: false,
      webhookSecret: secret,
      jobProcessor: {
        mode: "bullmq",
        enqueueReconciliation,
        enqueueOutboundDelivery: vi.fn(),
        close: vi.fn(),
      },
    });
    apps.push(app);
    const signature = generateNombaSignature(payload, secret, timestamp);
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/nomba",
      headers: {
        "nomba-signature": signature,
        "nomba-timestamp": timestamp,
      },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ received: true, queued: true });
    expect(enqueueReconciliation).toHaveBeenCalledWith(
      expect.objectContaining(payload),
      expect.any(String),
    );
  });

  it("rejects an invalid webhook signature", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/nomba",
      headers: {
        "nomba-signature": "wrong",
        "nomba-timestamp": timestamp,
      },
      payload,
    });

    expect(response.statusCode).toBe(401);
  });

  it("exposes a health endpoint for hosts", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "GET",
      url: "/health",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true,
      service: "rails",
    });
  });
});
