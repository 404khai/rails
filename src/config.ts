import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1).optional(),
  REDIS_URL: z.string().min(1).optional(),
  NOMBA_BASE_URL: z.string().url().default("https://sandbox.nomba.com"),
  NOMBA_PARENT_ACCOUNT_ID: z.string().min(1).optional(),
  NOMBA_SUB_ACCOUNT_ID: z.string().min(1).optional(),
  NOMBA_CLIENT_ID: z.string().min(1).optional(),
  NOMBA_CLIENT_SECRET: z.string().min(1).optional(),
  NOMBA_WEBHOOK_SECRET: z.string().min(1),
  RAILS_WEBHOOK_SECRET: z.string().min(1).optional(),
  ADMIN_BOOTSTRAP_TOKEN: z.string().min(1).optional(),
});

export type AppConfig = z.infer<typeof envSchema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig =>
  envSchema.parse(env);

export const requireConfig = <K extends keyof AppConfig>(
  config: AppConfig,
  key: K,
): NonNullable<AppConfig[K]> => {
  const value = config[key];

  if (value === undefined || value === "") {
    throw new Error(`${String(key)} is required for this operation`);
  }

  return value as NonNullable<AppConfig[K]>;
};
