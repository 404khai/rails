#!/usr/bin/env bash
set -euo pipefail

# Replay a signed Nomba payment_success webhook against Rails (local or hosted).
#
# Usage:
#   export NOMBA_WEBHOOK_SECRET='your-nomba-webhook-signing-key'
#   ./scripts/send-demo-nomba-webhook.sh
#
# Required overrides when testing a specific provisioned account:
#   ALIAS_ACCOUNT_NUMBER=<virtual-account-nuban-from-provision-response>
#   ALIAS_ACCOUNT_REFERENCE=<accountRef-from-provision-response>
#
# Optional:
#   WEBHOOK_URL=https://your-app.onrender.com/webhooks/nomba
#   TRANSACTION_ID=demo-transaction-002
#   SESSION_ID=demo-session-002
#   ALIAS_ACCOUNT_NAME="Nomba/Student Name"
#   TRANSACTION_AMOUNT=150
#   REQUEST_ID=demo-request-002

WEBHOOK_URL="${WEBHOOK_URL:-http://localhost:3000/webhooks/nomba}"
SECRET="${NOMBA_WEBHOOK_SECRET:-}"
ALIAS_ACCOUNT_NUMBER="${ALIAS_ACCOUNT_NUMBER:-}"
ALIAS_ACCOUNT_REFERENCE="${ALIAS_ACCOUNT_REFERENCE:-}"
ALIAS_ACCOUNT_NAME="${ALIAS_ACCOUNT_NAME:-Nomba/Demo Student}"
TRANSACTION_AMOUNT="${TRANSACTION_AMOUNT:-150}"

if [[ -z "$SECRET" ]]; then
  echo "Set NOMBA_WEBHOOK_SECRET before running this script." >&2
  exit 1
fi

if [[ -z "$ALIAS_ACCOUNT_NUMBER" || -z "$ALIAS_ACCOUNT_REFERENCE" ]]; then
  echo "Set ALIAS_ACCOUNT_NUMBER and ALIAS_ACCOUNT_REFERENCE from your provision response." >&2
  echo "Example:" >&2
  echo "  ALIAS_ACCOUNT_NUMBER=9171424534 ALIAS_ACCOUNT_REFERENCE=rails_student-001_abc12345 ./scripts/send-demo-nomba-webhook.sh" >&2
  exit 1
fi

TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
REQUEST_ID="${REQUEST_ID:-demo-request-$(date +%s)}"
TRANSACTION_ID="${TRANSACTION_ID:-demo-transaction-$(date +%s)}"
SESSION_ID="${SESSION_ID:-demo-session-$(date +%s)}"

read -r -d '' PAYLOAD <<EOF || true
{
  "event_type": "payment_success",
  "requestId": "${REQUEST_ID}",
  "data": {
    "merchant": {
      "walletId": "demo-wallet",
      "walletBalance": 1000,
      "userId": "demo-user"
    },
    "terminal": {},
    "transaction": {
      "aliasAccountNumber": "${ALIAS_ACCOUNT_NUMBER}",
      "aliasAccountReference": "${ALIAS_ACCOUNT_REFERENCE}",
      "aliasAccountType": "VIRTUAL",
      "fee": 0,
      "sessionId": "${SESSION_ID}",
      "type": "vact_transfer",
      "transactionId": "${TRANSACTION_ID}",
      "aliasAccountName": "${ALIAS_ACCOUNT_NAME}",
      "responseCode": "",
      "originatingFrom": "api",
      "transactionAmount": ${TRANSACTION_AMOUNT},
      "narration": "Demo school fees payment",
      "time": "${TIMESTAMP}"
    },
    "customer": {
      "bankCode": "999",
      "senderName": "Demo Parent",
      "bankName": "Demo Bank",
      "accountNumber": "0000000000"
    }
  }
}
EOF

export PAYLOAD TIMESTAMP SECRET

SIGNATURE="$(
  node <<'NODE'
const crypto = require("crypto");
const payload = JSON.parse(process.env.PAYLOAD);
const ts = process.env.TIMESTAMP;
const secret = process.env.SECRET;
const t = payload.data.transaction;
const m = payload.data.merchant;
const signingPayload = [
  payload.event_type,
  payload.requestId,
  m.userId,
  m.walletId,
  t.transactionId,
  t.type,
  t.time,
  t.responseCode || "",
  ts,
].join(":");
process.stdout.write(
  crypto.createHmac("sha256", secret).update(signingPayload).digest("base64"),
);
NODE
)"

echo "Posting signed demo webhook to ${WEBHOOK_URL}"

curl -i -X POST "${WEBHOOK_URL}" \
  -H "Content-Type: application/json" \
  -H "nomba-signature: ${SIGNATURE}" \
  -H "nomba-signature-algorithm: HmacSHA256" \
  -H "nomba-signature-version: 1.0.0" \
  -H "nomba-timestamp: ${TIMESTAMP}" \
  -d "${PAYLOAD}"
