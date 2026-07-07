import "dotenv/config";

import { createApp } from "./app.js";
import { loadConfig, requireConfig } from "./config.js";
import { createPrismaClient } from "./db.js";
import { createJobProcessor } from "./jobs/factory.js";
import { NombaClient } from "./nombaClient.js";

const config = loadConfig();
const prisma = createPrismaClient();
const railsWebhookSecret = requireConfig(config, "RAILS_WEBHOOK_SECRET");
const { jobProcessor, warning } = await createJobProcessor(config, prisma, railsWebhookSecret);
const nombaClient = new NombaClient({
  baseUrl: config.NOMBA_BASE_URL,
  parentAccountId: requireConfig(config, "NOMBA_PARENT_ACCOUNT_ID"),
  subAccountId: requireConfig(config, "NOMBA_SUB_ACCOUNT_ID"),
  clientId: requireConfig(config, "NOMBA_CLIENT_ID"),
  clientSecret: requireConfig(config, "NOMBA_CLIENT_SECRET"),
});

const app = await createApp({
  webhookSecret: config.NOMBA_WEBHOOK_SECRET,
  config,
  prisma,
  jobProcessor,
  nombaClient,
});

if (warning) {
  app.log.warn(warning);
}

const shutdown = async () => {
  await app.close();
  await jobProcessor?.close();
  await prisma.$disconnect();
};

process.on("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

await app.listen({ host: config.HOST, port: config.PORT });
