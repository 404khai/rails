# Rails

Rails is a developer-first virtual account infrastructure layer built on Nomba's API. The MVP demo is a school-fees collection flow: each student gets a dedicated Nomba virtual account, inbound transfers are reconciled to that student, and the school can fetch a clean ledger or statement from Rails.

## What It Ships

- `POST /customers` creates or updates a demo student/customer.
- `POST /customers/:id/accounts` provisions or reuses a Nomba virtual account.
- `POST /webhooks/nomba` verifies Nomba HMAC signatures, accepts virtual-account transfer webhooks, and enqueues reconciliation.
- `GET /customers/:id/transactions` returns paginated transaction history.
- `GET /customers/:id/statement` returns date-filterable statement totals and rows.
- `POST /webhook-subscriptions` registers downstream callback URLs for signed Rails events.
- `/docs` serves Swagger UI and `/documentation/json` serves the generated OpenAPI document.

## Local Development

```bash
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run dev
```

Start the worker in a second terminal:

```bash
npm run dev:worker
```

Fill `.env` with sandbox credentials from Nomba before calling live Nomba endpoints. Do not commit real credentials or private keys.

## Environment

```text
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
NOMBA_BASE_URL=https://sandbox.nomba.com
NOMBA_PARENT_ACCOUNT_ID=<parent account ID from Nomba>
NOMBA_SUB_ACCOUNT_ID=<sub-account ID from Nomba>
NOMBA_CLIENT_ID=<test client ID from Nomba>
NOMBA_CLIENT_SECRET=<test private key from Nomba>
NOMBA_WEBHOOK_SECRET=<webhook signing key from Nomba>
RAILS_WEBHOOK_SECRET=<Rails outbound signing key>
ADMIN_BOOTSTRAP_TOKEN=<one-time admin token for creating API keys after bootstrap>
```

## Demo Quickstart

Create an API key. The first key can be created without a bootstrap token; later keys require `x-bootstrap-token`.

```bash
curl -X POST http://localhost:3000/api-keys \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"demo-school","label":"Demo School"}'
```

Create a student/customer.

```bash
curl -X POST http://localhost:3000/customers \
  -H 'Authorization: Bearer <rails-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "externalReference": "student-001",
    "name": "Ada Student",
    "email": "ada@example.com",
    "expectedAmount": 150
  }'
```

Provision the student’s Nomba virtual account.

```bash
curl -X POST http://localhost:3000/customers/student-001/accounts \
  -H 'Authorization: Bearer <rails-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{"accountName":"Ada Student"}'
```

Register a downstream webhook receiver, such as webhook.site.

```bash
curl -X POST http://localhost:3000/webhook-subscriptions \
  -H 'Authorization: Bearer <rails-api-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://webhook.site/<id>",
    "events": ["transfer.matched", "transfer.underpaid", "transfer.overpaid", "transfer.misdirected"]
  }'
```

Fetch the student statement.

```bash
curl 'http://localhost:3000/customers/student-001/statement?dateFrom=2026-07-01&dateTo=2026-07-07' \
  -H 'Authorization: Bearer <rails-api-key>'
```

## Nomba Webhook Setup

The webhook endpoint is:

```text
POST /webhooks/nomba
```

After deploying the API, submit this public URL to Nomba:

```text
https://<your-service-name>.up.railway.app/webhooks/nomba
```

Subscribe to Nomba `payment_success` events. Rails only queues virtual-account transfers where `transaction.type` is `vact_transfer` and `aliasAccountType` is `VIRTUAL`.

Nomba sends these verification headers:

- `nomba-signature`
- `nomba-signature-algorithm`
- `nomba-signature-version`
- `nomba-timestamp`

Rails verifies `nomba-signature` with HMAC-SHA256 and `NOMBA_WEBHOOK_SECRET`. The signature payload follows Nomba's documented format:

```text
event_type:requestId:userId:walletId:transactionId:type:time:responseCode:nomba-timestamp
```

## Reconciliation States

- `matched`: transfer amount equals the student expected amount.
- `underpaid`: transfer amount is lower than expected.
- `overpaid`: transfer amount is higher than expected.
- `misdirected`: the Nomba virtual account reference/number does not map to Rails.
- `duplicate`: the Nomba `transactionId` or `sessionId` has already been processed.

Rails stores expected school-fee amounts internally instead of setting Nomba `expectedAmount` by default, so underpayment and overpayment behavior can be demonstrated instead of being rejected by the sender’s bank.

## Deployment

Use two Railway services against the same Supabase Postgres and Upstash Redis:

- API service: `npm run build && npm run start`
- Worker service: `npm run build && npm run start:worker`
- Release/migration command: `npm run db:deploy`

Nomba sandbox limits to remember for the demo: each user can create up to 2 virtual accounts, each account can receive transfers up to ₦150, and sandbox virtual-account expiration is limited.

## Demo Video Script

1. Show `/docs` and the school-fees problem statement.
2. Create `student-001` with expected amount ₦150.
3. Provision the student virtual account through Rails.
4. Register a webhook.site subscription for Rails outbound events.
5. Trigger or replay a Nomba `payment_success` virtual-account webhook.
6. Show the reconciled statement and transaction history.
7. Replay the same webhook to demonstrate duplicate protection.
8. Show a misdirected webhook payload and the `transfer.misdirected` outbound event.

## Scripts

```bash
npm run dev         # start Fastify with tsx watch
npm run dev:worker  # start BullMQ workers with tsx watch
npm run build       # compile TypeScript
npm run start       # run compiled API server
npm run start:worker # run compiled worker
npm run test        # run Vitest
npm run typecheck   # type-check without emitting files
npm run db:generate # generate Prisma client
npm run db:migrate  # run local Prisma migrations
npm run db:deploy   # deploy migrations in hosted environments
```
