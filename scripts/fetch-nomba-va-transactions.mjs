#!/usr/bin/env node
/**
 * Fetch Nomba virtual-account transactions for backtracking live payments.
 *
 * Usage:
 *   NOMBA_BASE_URL=https://api.nomba.com \
 *   NOMBA_PARENT_ACCOUNT_ID=<live-parent-id> \
 *   NOMBA_CLIENT_ID=<live-client-id> \
 *   NOMBA_CLIENT_SECRET=<live-private-key> \
 *   node scripts/fetch-nomba-va-transactions.mjs <virtual-account-number>
 */

const virtualAccount = process.argv[2];
const baseUrl = process.env.NOMBA_BASE_URL ?? "https://api.nomba.com";
const parentAccountId = process.env.NOMBA_PARENT_ACCOUNT_ID;
const clientId = process.env.NOMBA_CLIENT_ID;
const clientSecret = process.env.NOMBA_CLIENT_SECRET;

if (!virtualAccount) {
  console.error("Usage: node scripts/fetch-nomba-va-transactions.mjs <virtualAccountNumber>");
  process.exit(1);
}

for (const [name, value] of [
  ["NOMBA_PARENT_ACCOUNT_ID", parentAccountId],
  ["NOMBA_CLIENT_ID", clientId],
  ["NOMBA_CLIENT_SECRET", clientSecret],
]) {
  if (!value) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
}

const tokenUrl = new URL("/v1/auth/token/issue", baseUrl).toString();
const tokenResponse = await fetch(tokenUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    accountId: parentAccountId,
  },
  body: JSON.stringify({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  }),
});

const tokenBody = await tokenResponse.json().catch(() => ({}));
if (!tokenResponse.ok) {
  console.error("Token request failed:", tokenResponse.status, tokenBody);
  process.exit(1);
}

const accessToken = tokenBody.access_token ?? tokenBody.data?.access_token;
if (!accessToken) {
  console.error("No access_token in response:", tokenBody);
  process.exit(1);
}

const params = new URLSearchParams({ virtual_account: virtualAccount });
const txUrl = new URL(`/v1/transactions/virtual?${params}`, baseUrl).toString();
const txResponse = await fetch(txUrl, {
  headers: {
    Authorization: `Bearer ${accessToken}`,
    accountId: parentAccountId,
    "Content-Type": "application/json",
  },
});

const txBody = await txResponse.json().catch(() => ({}));
console.log(JSON.stringify({ status: txResponse.status, body: txBody }, null, 2));
