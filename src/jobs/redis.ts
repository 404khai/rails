import { Redis } from "ioredis";

import type { AppConfig } from "../config.js";

export const createQueueConnection = (redisUrl: string) => ({
  url: redisUrl,
  lazyConnect: true,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const createWorkerConnection = (redisUrl: string) => ({
  url: redisUrl,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

export const getBullmqWorkerOptions = (config: AppConfig) => ({
  stalledInterval: config.BULLMQ_STALLED_INTERVAL_MS,
  maxStalledCount: 1,
  drainDelay: config.BULLMQ_DRAIN_DELAY_MS,
});

export const pingRedis = async (redisUrl: string, timeoutMs = 1000): Promise<boolean> => {
  const redis = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    connectTimeout: timeoutMs,
    enableReadyCheck: false,
  });

  redis.on("error", () => undefined);

  try {
    await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
};
