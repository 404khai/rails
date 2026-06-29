import { describe, expect, it, vi } from "vitest";

import { NombaClient } from "../src/nombaClient.js";

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

describe("Nomba client", () => {
  it("obtains and reuses an OAuth token when creating virtual accounts", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-1", expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            accountRef: "rails_student_001",
            bankAccountNumber: "9171424534",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            accountRef: "rails_student_002",
            bankAccountNumber: "9171424535",
          },
        }),
      );
    const client = new NombaClient({
      baseUrl: "https://sandbox.nomba.com",
      parentAccountId: "parent-account",
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl,
    });

    await client.createVirtualAccount({
      accountRef: "rails_student_001",
      accountName: "Student One",
    });
    await client.createVirtualAccount({
      accountRef: "rails_student_002",
      accountName: "Student Two",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://sandbox.nomba.com/v1/auth/token/issue");
    expect(fetchImpl.mock.calls[1]?.[0]).toBe("https://sandbox.nomba.com/v1/accounts/virtual");
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer token-1",
        accountId: "parent-account",
      }),
    });
  });

  it("sends transaction fetch requests with the virtual account filter", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token-1", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ data: { results: [] } }));
    const client = new NombaClient({
      baseUrl: "https://sandbox.nomba.com",
      parentAccountId: "parent-account",
      clientId: "client-id",
      clientSecret: "client-secret",
      fetchImpl,
    });

    await client.fetchVirtualAccountTransactions({
      virtualAccount: "9171424534",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-07",
    });

    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      "https://sandbox.nomba.com/v1/transactions/virtual?virtual_account=9171424534&dateFrom=2026-07-01&dateTo=2026-07-07",
    );
  });
});
