import crypto from "node:crypto";

export const buildRailsWebhookSignaturePayload = (input: {
  timestamp: string;
  eventId: string;
  eventType: string;
  body: string;
}): string => `${input.timestamp}:${input.eventId}:${input.eventType}:${input.body}`;

export const generateRailsWebhookSignature = (input: {
  secret: string;
  timestamp: string;
  eventId: string;
  eventType: string;
  body: string;
}): string =>
  crypto
    .createHmac("sha256", input.secret)
    .update(buildRailsWebhookSignaturePayload(input))
    .digest("base64");
