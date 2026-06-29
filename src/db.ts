import { PrismaClient } from "@prisma/client";

export const createPrismaClient = () =>
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "info", "warn", "error"]
        : ["warn", "error"],
  });

export type PrismaService = ReturnType<typeof createPrismaClient>;
