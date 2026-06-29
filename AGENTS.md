# AGENTS.md — Rails

## What is Rails?
Rails is a developer-first virtual account infrastructure layer built on Nomba's API.
It provisions dedicated Nomba virtual accounts per customer, automates inbound transfer
reconciliation, and exposes a clean REST API + outbound webhook system for downstream
product teams. Think of it as the managed infra layer Nomba doesn't ship — so every
team stops rebuilding the same reconciliation plumbing from scratch.

## Hackathon Context
- Event: Nomba x DevCareer Hackathon 2026
- Track: Infrastructure — Dedicated Virtual Accounts
- Build window: 1 July – 7 July 2026 (11:59 PM WAT deadline)
- Solo project by: 404khai
- Demo scenario: Per-student school fees collection
  (each student gets a unique virtual account; inbound transfers auto-reconcile to
  the right student; school admin sees a clean per-student ledger)

## Core Problem
Nigerian product teams repeatedly rebuild the same primitives on top of Nomba's
Virtual Account API: provisioning, webhook ingestion, reconciliation logic,
edge-case handling (misdirected payments, underpayments, overpayments, duplicates),
and customer-level statements. Rails solves this once, correctly, and exposes it
as an API other teams can integrate in under an hour.

## What Rails Must Do (MVP scope)
1. POST /customers/:id/accounts — provision a Nomba virtual account, persist mapping
2. Webhook ingestion — receive Nomba inbound transfer webhooks, verify HMAC-SHA256
   signature, enqueue to BullMQ worker (always return 200 fast)
3. Reconciliation engine — state machine covering:
   - exact match
   - underpayment
   - overpayment
   - misdirected payment (no matching account)
   - duplicate transfer (idempotency)
4. GET /customers/:id/transactions — customer-level transaction history
5. GET /customers/:id/statement — filterable statement by date range
6. Outbound webhooks — Rails emits signed events to downstream systems:
   transfer.matched | transfer.misdirected | transfer.underpaid | transfer.overpaid
7. OpenAPI 3.0 spec auto-generated from Fastify route schemas

## Judging Criteria (know these, optimize for them)
- Technical Execution: 25%
- Security & Reliability: 20%
- Nomba Integration Depth: 20%
- Problem Relevance: 20%
- Product UX & Clarity: 15%

## Tech Stack
- Runtime: Node.js (TypeScript)
- Framework: Fastify (schema validation + serialization perf)
- ORM: Prisma
- Database: PostgreSQL (Supabase for hosting)
- Queue: BullMQ + Redis (Upstash)
- Auth: API key auth (SHA-256 hashed in DB) for downstream devs
- Webhook security: HMAC-SHA256 signature verification on all inbound Nomba webhooks
- Hosting: Railway (API server + BullMQ worker)
- Testing: Vitest (unit tests on reconciliation logic) + Nomba sandbox for e2e

## Key Nomba API References
- Developer portal: https://developer.nomba.com
- Introduction: https://developer.nomba.com/nomba-api-reference/introduction
- Authentication (OAuth2 / client credentials): https://developer.nomba.com/getting-started/environment
- Virtual Account API: https://developer.nomba.com (see Virtual Accounts section)
- Webhooks: https://developer.nomba.com (see Webhooks section)
- Transactions API: https://developer.nomba.com (see Transactions section)
- Sandbox environment: use sandbox credentials, separate from production 

## Database Schema (target shape)
Tables: customers, virtual_accounts, transactions, reconciliation_events,
        api_keys, outbound_webhook_subscriptions, outbound_webhook_delivery_log

## Security Requirements (these are scored)
- All inbound Nomba webhooks must have HMAC-SHA256 signature verified before processing
- API keys must be hashed (SHA-256) before storage — never stored plaintext
- All webhook deliveries to downstream systems must be signed
- Idempotency keys enforced on transaction ingestion (no duplicate processing)
- Sensitive env vars: NOMBA_CLIENT_ID, NOMBA_CLIENT_SECRET, NOMBA_WEBHOOK_SECRET,
  DATABASE_URL, REDIS_URL, RAILS_WEBHOOK_SECRET

## Submission Requirements (ship all of these)
- Public GitHub repo with clean commit history (commits only within July 1-7)
- Working MVP URL hosted and accessible to judges
- 2-3 minute demo video: provisioning → inbound transfer → reconciliation →
  misdirected payment edge case → customer statement (all on Nomba sandbox)
- Architecture and security note (auth, webhooks, data handling)
- Optional: test credentials for judges

## Priorities
1. Reconciliation engine correctness + edge cases (highest judging signal)
2. Webhook security (HMAC verification, signed outbound events)
3. API ergonomics for downstream developers (OpenAPI spec, clear error codes)
4. Clean Prisma schema with proper indexes and audit trail
5. Demo video narrative (school fees scenario, show edge cases not just happy path)

## What NOT to build (scope control)
- No frontend dashboard beyond what's needed for the demo video
- No multi-tenancy beyond API key isolation
- No production KYC flows (sandbox only)
- No mobile app