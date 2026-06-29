import { describe, expect, it } from "vitest";

import {
  buildNombaSignaturePayload,
  generateNombaSignature,
  type NombaWebhookPayload,
  verifyNombaSignature,
} from "../src/nombaSignature.js";

const payload: NombaWebhookPayload = {
  event_type: "payment_success",
  requestId: "45f2dc2d-d559-4773-bba3-2d5ec17b2e20",
  data: {
    merchant: {
      walletId: "6756ff80aafe04a795f18b3",
      userId: "b7b10e81-e57d-41d0-8f4e-f4e23a132bbf",
    },
    transaction: {
      type: "vact_transfer",
      transactionId: "API-VACT_TRA-B7B10-0435b274-807a-4bc7-8abe-9db",
      responseCode: "",
      time: "2025-09-29T10:51:44Z",
    },
  },
};

describe("Nomba webhook signatures", () => {
  it("builds the documented colon-separated signing payload", () => {
    expect(buildNombaSignaturePayload(payload, "2025-09-29T10:51:44Z")).toBe(
      "payment_success:45f2dc2d-d559-4773-bba3-2d5ec17b2e20:b7b10e81-e57d-41d0-8f4e-f4e23a132bbf:6756ff80aafe04a795f18b3:API-VACT_TRA-B7B10-0435b274-807a-4bc7-8abe-9db:vact_transfer:2025-09-29T10:51:44Z::2025-09-29T10:51:44Z",
    );
  });

  it("treats a literal null response code as empty per Nomba examples", () => {
    expect(
      buildNombaSignaturePayload(
        {
          ...payload,
          data: {
            ...payload.data,
            transaction: {
              ...payload.data?.transaction,
              responseCode: "null",
            },
          },
        },
        "2025-09-29T10:51:44Z",
      ),
    ).toBe(buildNombaSignaturePayload(payload, "2025-09-29T10:51:44Z"));
  });

  it("verifies a matching HMAC-SHA256 Base64 signature", () => {
    const secret = "sampleSecret";
    const timestamp = "2025-09-29T10:51:44Z";
    const signature = generateNombaSignature(payload, secret, timestamp);

    expect(
      verifyNombaSignature({
        payload,
        secret,
        signature,
        timestamp,
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects a mismatched signature", () => {
    expect(
      verifyNombaSignature({
        payload,
        secret: "sampleSecret",
        signature: "not-a-valid-signature",
        timestamp: "2025-09-29T10:51:44Z",
      }),
    ).toMatchObject({
      ok: false,
      reason: "Invalid nomba-signature header",
    });
  });
});
