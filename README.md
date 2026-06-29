# Rails

Rails is a developer-first virtual account infrastructure layer built on Nomba's API.

## Nomba webhook receiver

The webhook endpoint implemented in this repository is:

```text
POST /webhooks/nomba
```

After deploying the API, submit this URL to Nomba:

```text
https://<your-public-api-host>/webhooks/nomba
```

For Railway this will usually look like:

```text
https://<your-service-name>.up.railway.app/webhooks/nomba
```

Also submit the sub-account ID from the credentials Nomba gave you.

## Webhook security

Nomba sends these headers with webhook requests:

- `nomba-signature`
- `nomba-signature-algorithm`
- `nomba-signature-version`
- `nomba-timestamp`

The receiver verifies `nomba-signature` with HMAC-SHA256 and the signing key in
`NOMBA_WEBHOOK_SECRET`. The signature payload follows Nomba's documented format:

```text
event_type:requestId:userId:walletId:transactionId:type:time:responseCode:nomba-timestamp
```

Only verified webhooks are acknowledged and logged for reconciliation.

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

Fill `.env` with the credentials from Nomba before starting the app. Do not commit
real credentials or private keys.

Required deployment variables:

```text
NOMBA_WEBHOOK_SECRET=<webhook signing key from Nomba>
NOMBA_PARENT_ACCOUNT_ID=<parent account ID from Nomba>
NOMBA_SUB_ACCOUNT_ID=<sub-account ID from Nomba>
NOMBA_CLIENT_ID=<test client ID from Nomba>
NOMBA_CLIENT_SECRET=<test private key from Nomba>
```

Use the parent account ID in the `accountId` request header when calling Nomba,
then scope API operations to the supplied sub-account ID.

## Scripts

```bash
npm run dev        # start Fastify with tsx watch
npm run build      # compile TypeScript
npm run start      # run compiled server
npm run test       # run Vitest
npm run typecheck  # type-check without emitting files
```

Health check:

```text
GET /health
```
