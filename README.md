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

Fill `.env` with Nomba credentials before calling live endpoints. Do not commit real credentials or private keys.

### Generate Rails-owned secrets

Set these in Render (or local `.env`). Generate fresh values — never commit them:

```bash
# Signs outbound webhooks Rails delivers to downstream subscribers (required for worker)
openssl rand -base64 32

# Protects POST /api-keys after the first tenant key has been created
openssl rand -base64 32
```

Map the outputs to:

```text
RAILS_WEBHOOK_SECRET=<first command output>
ADMIN_BOOTSTRAP_TOKEN=<second command output>
```

`NOMBA_WEBHOOK_SECRET` is provided by Nomba (sandbox and production may share the hackathon signing key). It is separate from `NOMBA_CLIENT_SECRET`.

## Environment

```text
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
NOMBA_BASE_URL=https://sandbox.nomba.com
NOMBA_PARENT_ACCOUNT_ID=<parent account ID from Nomba>
NOMBA_SUB_ACCOUNT_ID=<sub-account ID from Nomba — used in POST /v1/accounts/virtual/{subAccountId}>
NOMBA_CLIENT_ID=<client ID from Nomba>
NOMBA_CLIENT_SECRET=<private key from Nomba>
NOMBA_WEBHOOK_SECRET=<webhook signing key from Nomba>
RAILS_WEBHOOK_SECRET=<output of openssl rand -base64 32>
ADMIN_BOOTSTRAP_TOKEN=<output of openssl rand -base64 32>
```

## Demo Quickstart

Create an API key. The first key can be created without a bootstrap token; later keys require `x-bootstrap-token` matching `ADMIN_BOOTSTRAP_TOKEN`.

```bash
curl -X POST http://localhost:3000/api-keys \
  -H 'Content-Type: application/json' \
  -d '{"tenantId":"demo-school","label":"Demo School"}'
```

Create additional tenant keys after bootstrap:

```bash
curl -X POST https://<your-app>.onrender.com/api-keys \
  -H 'Content-Type: application/json' \
  -H 'x-bootstrap-token: <ADMIN_BOOTSTRAP_TOKEN>' \
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

Provision the student’s Nomba virtual account. Rails calls Nomba
[`POST /v1/accounts/virtual/{subAccountId}`](https://developer.nomba.com/nomba-api-reference/virtual-accounts/create-virtual-account-for-sub-account)
with the parent `accountId` header and your `NOMBA_SUB_ACCOUNT_ID` in the path.

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

Hosted on Render with Supabase Postgres and Upstash Redis. Start command runs API + worker:

```text
sh -c "node dist/src/worker.js & node dist/src/server.js"
```

Build: `npm ci && npm run build`

### Keep Render awake (required for Nomba webhooks)

Render free tier sleeps after ~15 minutes of inactivity. Webhooks sent while asleep can be lost.

Use [UptimeRobot](https://uptimerobot.com) (free tier pings every 5 minutes):

1. Create account at https://uptimerobot.com
2. Add **HTTP(s) monitor**
3. URL: `https://<your-app>.onrender.com/health`
4. Monitoring interval: **5 minutes**
5. Expected response: `200` with body `{"ok":true,"service":"rails"}`

Do not ping `/webhooks/nomba` — that route is POST-only and returns 404 on GET.

Nomba sandbox limits to remember for the demo: each user can create up to 2 virtual accounts, each account can receive transfers up to ₦150, and sandbox virtual-account expiration is limited.


## Operational Scripts

Replay a signed Nomba webhook (use account values from `POST /customers/:id/accounts`):

```bash
export NOMBA_WEBHOOK_SECRET='<nomba-webhook-signing-key>'
WEBHOOK_URL=https://<your-app>.onrender.com/webhooks/nomba \
ALIAS_ACCOUNT_NUMBER='<bankAccountNumber>' \
ALIAS_ACCOUNT_REFERENCE='<accountRef>' \
ALIAS_ACCOUNT_NAME='<bankAccountName>' \
TRANSACTION_AMOUNT=150 \
./scripts/send-demo-nomba-webhook.sh
```

Backtrack payments on Nomba before Rails receives a webhook:

```bash
NOMBA_BASE_URL=https://api.nomba.com \
NOMBA_PARENT_ACCOUNT_ID='<parent-account-id>' \
NOMBA_CLIENT_ID='<client-id>' \
NOMBA_CLIENT_SECRET='<private-key>' \
node scripts/fetch-nomba-va-transactions.mjs <virtual-account-number>
```

Use Nomba `transactionId`, `sessionId`, and amount from that output to replay a missed webhook with `send-demo-nomba-webhook.sh`.

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
