import { describe, expect, it } from "vitest";

import {
  buildRailsWebhookSignaturePayload,
  generateRailsWebhookSignature,
} from "../src/outboundSignature.js";

describe("outbound webhook signatures", () => {
  it("builds a deterministic signing payload", () => {
    expect(
      buildRailsWebhookSignaturePayload({
        timestamp: "2026-07-01T10:00:00.000Z",
        eventId: "transfer.matched:txn_123",
        eventType: "transfer.matched",
        body: '{"ok":true}',
      }),
    ).toBe('2026-07-01T10:00:00.000Z:transfer.matched:txn_123:transfer.matched:{"ok":true}');
  });

  it("generates HMAC-SHA256 Base64 signatures", () => {
    expect(
      generateRailsWebhookSignature({
        secret: "rails-secret",
        timestamp: "2026-07-01T10:00:00.000Z",
        eventId: "transfer.matched:txn_123",
        eventType: "transfer.matched",
        body: '{"ok":true}',
      }),
    ).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });
});
