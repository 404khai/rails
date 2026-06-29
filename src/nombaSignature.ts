import crypto from "node:crypto";

export type NombaWebhookPayload = {
  event_type?: unknown;
  requestId?: unknown;
  data?: {
    merchant?: {
      userId?: unknown;
      walletId?: unknown;
    };
    transaction?: {
      transactionId?: unknown;
      type?: unknown;
      time?: unknown;
      responseCode?: unknown;
    };
  };
};

export type VerifyNombaSignatureInput = {
  payload: NombaWebhookPayload;
  secret: string;
  signature: string | undefined;
  timestamp: string | undefined;
};

export type SignatureVerificationResult =
  | { ok: true; expectedSignature: string }
  | { ok: false; reason: string; expectedSignature?: string };

const toSignatureValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value);
};

export const buildNombaSignaturePayload = (
  payload: NombaWebhookPayload,
  timestamp: string,
): string => {
  const merchant = payload.data?.merchant ?? {};
  const transaction = payload.data?.transaction ?? {};
  let responseCode = toSignatureValue(transaction.responseCode);

  if (responseCode === "null") {
    responseCode = "";
  }

  return [
    toSignatureValue(payload.event_type),
    toSignatureValue(payload.requestId),
    toSignatureValue(merchant.userId),
    toSignatureValue(merchant.walletId),
    toSignatureValue(transaction.transactionId),
    toSignatureValue(transaction.type),
    toSignatureValue(transaction.time),
    responseCode,
    timestamp,
  ].join(":");
};

export const generateNombaSignature = (
  payload: NombaWebhookPayload,
  secret: string,
  timestamp: string,
): string => {
  const signaturePayload = buildNombaSignaturePayload(payload, timestamp);

  return crypto
    .createHmac("sha256", secret)
    .update(signaturePayload)
    .digest("base64");
};

const timingSafeStringEqual = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

export const verifyNombaSignature = ({
  payload,
  secret,
  signature,
  timestamp,
}: VerifyNombaSignatureInput): SignatureVerificationResult => {
  if (!secret) {
    return { ok: false, reason: "Missing NOMBA_WEBHOOK_SECRET" };
  }

  if (!signature) {
    return { ok: false, reason: "Missing nomba-signature header" };
  }

  if (!timestamp) {
    return { ok: false, reason: "Missing nomba-timestamp header" };
  }

  const expectedSignature = generateNombaSignature(payload, secret, timestamp);

  if (!timingSafeStringEqual(signature.trim(), expectedSignature)) {
    return {
      ok: false,
      reason: "Invalid nomba-signature header",
      expectedSignature,
    };
  }

  return { ok: true, expectedSignature };
};
