import crypto from "node:crypto";

export type NombaClientOptions = {
  baseUrl: string;
  parentAccountId: string;
  clientId: string;
  clientSecret: string;
  fetchImpl?: typeof fetch;
};

export type CreateVirtualAccountInput = {
  accountRef: string;
  accountName: string;
  currency?: "NGN";
  bvn?: string;
  expectedAmount?: number;
};

export type NombaVirtualAccount = {
  createdAt?: string;
  accountRef: string;
  accountHolderId?: string;
  accountName?: string;
  currency?: string;
  bankAccountNumber?: string;
  bankAccountName?: string;
  bankName?: string;
  expired?: boolean;
};

type TokenResponse = {
  access_token?: string;
  expiresAt?: string;
  expires_in?: number;
  data?: {
    access_token?: string;
    expiresAt?: string;
    expires_in?: number;
  };
};

export class NombaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export class NombaClient {
  private accessToken: string | undefined;
  private tokenExpiresAt = 0;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: NombaClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async createVirtualAccount(input: CreateVirtualAccountInput): Promise<NombaVirtualAccount> {
    const response = await this.request<{ data: NombaVirtualAccount }>(
      "/v1/accounts/virtual",
      {
        method: "POST",
        body: JSON.stringify({
          currency: "NGN",
          ...input,
        }),
      },
      true,
    );

    return response.data;
  }

  async fetchVirtualAccountTransactions(input: {
    virtualAccount: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<unknown> {
    const params = new URLSearchParams({
      virtual_account: input.virtualAccount,
    });

    if (input.dateFrom) {
      params.set("dateFrom", input.dateFrom);
    }

    if (input.dateTo) {
      params.set("dateTo", input.dateTo);
    }

    return this.request(`/v1/transactions/virtual?${params.toString()}`, {
      method: "GET",
    });
  }

  async requeryTransaction(sessionId: string): Promise<unknown> {
    return this.request(`/v1/transactions/requery/${encodeURIComponent(sessionId)}`, {
      method: "GET",
    });
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 30_000) {
      return this.accessToken;
    }

    const response = await this.fetchImpl(this.toUrl("/v1/auth/token/issue"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        accountId: this.options.parentAccountId,
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.options.clientId,
        client_secret: this.options.clientSecret,
      }),
    });
    const body = (await response.json().catch(() => undefined)) as TokenResponse | undefined;

    if (!response.ok) {
      throw new NombaApiError("Unable to obtain Nomba access token", response.status, body);
    }

    const token = body?.access_token ?? body?.data?.access_token;

    if (!token) {
      throw new NombaApiError("Nomba token response did not include access_token", response.status, body);
    }

    const expiresIn = body?.expires_in ?? body?.data?.expires_in ?? 3600;
    const expiresAt = body?.expiresAt ?? body?.data?.expiresAt;
    this.accessToken = token;
    this.tokenExpiresAt = expiresAt ? Date.parse(expiresAt) : Date.now() + expiresIn * 1000;

    return token;
  }

  private async request<T = unknown>(
    path: string,
    init: RequestInit,
    withIdempotencyKey = false,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const response = await this.fetchImpl(this.toUrl(path), {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        accountId: this.options.parentAccountId,
        ...(withIdempotencyKey ? { "X-Idempotent-key": crypto.randomUUID() } : {}),
        ...init.headers,
      },
    });

    if (response.status === 401) {
      this.accessToken = undefined;
      const retryToken = await this.getAccessToken();
      const retryResponse = await this.fetchImpl(this.toUrl(path), {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${retryToken}`,
          accountId: this.options.parentAccountId,
          ...(withIdempotencyKey ? { "X-Idempotent-key": crypto.randomUUID() } : {}),
          ...init.headers,
        },
      });

      return this.parseResponse<T>(retryResponse);
    }

    return this.parseResponse<T>(response);
  }

  private async parseResponse<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => undefined);

    if (!response.ok) {
      throw new NombaApiError("Nomba API request failed", response.status, body);
    }

    return body as T;
  }

  private toUrl(path: string): string {
    return new URL(path, this.options.baseUrl).toString();
  }
}
