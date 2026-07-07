import type { AppConfig } from "../config.js";
import type { PrismaService } from "../db.js";
import { createBullmqJobProcessor } from "./bullmqProcessor.js";
import { createInlineJobProcessor } from "./inlineProcessor.js";
import { pingRedis } from "./redis.js";
import type { JobProcessor } from "./types.js";

export type JobProcessorResult = {
  jobProcessor?: JobProcessor;
  warning?: string;
};

export const createJobProcessor = async (
  config: AppConfig,
  prisma: PrismaService,
  railsWebhookSecret: string,
): Promise<JobProcessorResult> => {
  if (config.JOB_PROCESSOR === "inline") {
    return {
      jobProcessor: createInlineJobProcessor(prisma, railsWebhookSecret),
    };
  }

  if (!config.REDIS_URL) {
    return {
      warning: "REDIS_URL is not configured; Nomba webhooks will be acknowledged but not queued",
    };
  }

  const redisAvailable = await pingRedis(config.REDIS_URL);
  if (!redisAvailable) {
    return {
      warning: "Redis is unavailable; Nomba webhooks will be acknowledged but not queued",
    };
  }

  return {
    jobProcessor: createBullmqJobProcessor(config.REDIS_URL, config),
  };
};
