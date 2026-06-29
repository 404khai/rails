import crypto from "node:crypto";

import type { PrismaService } from "./db.js";

export type CreatedApiKey = {
  id: string;
  tenantId: string;
  label: string;
  prefix: string;
  key: string;
};

export const hashApiKey = (key: string): string =>
  crypto.createHash("sha256").update(key).digest("hex");

export const generateApiKey = (): { key: string; prefix: string; hash: string } => {
  const random = crypto.randomBytes(24).toString("base64url");
  const key = `rails_test_${random}`;
  const prefix = key.slice(0, 16);

  return {
    key,
    prefix,
    hash: hashApiKey(key),
  };
};

export const createApiKey = async (
  prisma: PrismaService,
  input: { tenantId: string; label: string },
): Promise<CreatedApiKey> => {
  const generated = generateApiKey();
  const record = await prisma.apiKey.create({
    data: {
      tenantId: input.tenantId,
      label: input.label,
      prefix: generated.prefix,
      keyHash: generated.hash,
    },
  });

  return {
    id: record.id,
    tenantId: record.tenantId,
    label: record.label,
    prefix: record.prefix,
    key: generated.key,
  };
};

export const authenticateApiKey = async (
  prisma: PrismaService,
  key: string,
): Promise<{ tenantId: string; apiKeyId: string } | undefined> => {
  const keyHash = hashApiKey(key);
  const apiKey = await prisma.apiKey.findUnique({
    where: { keyHash },
  });

  if (!apiKey?.active || apiKey.revokedAt) {
    return undefined;
  }

  await prisma.apiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    tenantId: apiKey.tenantId,
    apiKeyId: apiKey.id,
  };
};
