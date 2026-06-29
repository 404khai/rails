import type { FastifyRequest } from "fastify";

import { authenticateApiKey } from "./apiKeys.js";
import type { PrismaService } from "./db.js";

export type AuthContext = {
  tenantId: string;
  apiKeyId: string;
};

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

const extractApiKey = (request: FastifyRequest): string | undefined => {
  const authorization = request.headers.authorization;

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  const apiKey = request.headers["x-api-key"];

  if (Array.isArray(apiKey)) {
    return apiKey[0];
  }

  return apiKey;
};

export const requireAuth = async (
  request: FastifyRequest,
  prisma: PrismaService,
): Promise<AuthContext> => {
  const apiKey = extractApiKey(request);

  if (!apiKey) {
    throw request.server.httpErrors.unauthorized("Missing API key");
  }

  const auth = await authenticateApiKey(prisma, apiKey);

  if (!auth) {
    throw request.server.httpErrors.unauthorized("Invalid API key");
  }

  request.auth = auth;
  return auth;
};
