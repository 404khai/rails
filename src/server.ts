import "dotenv/config";

import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const webhookSecret = process.env.NOMBA_WEBHOOK_SECRET;

if (!webhookSecret) {
  throw new Error("NOMBA_WEBHOOK_SECRET is required to verify Nomba webhooks");
}

const app = await createApp({
  webhookSecret,
});

await app.listen({ host, port });
