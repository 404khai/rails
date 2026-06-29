import { describe, expect, it } from "vitest";

import { decideReconciliation } from "../src/reconciliation.js";

describe("reconciliation decisions", () => {
  it("classifies exact matches", () => {
    expect(
      decideReconciliation({
        amountKobo: 15000,
        expectedAmountKobo: 15000,
        accountFound: true,
        duplicate: false,
      }),
    ).toMatchObject({ status: "matched", eventType: "transfer.matched" });
  });

  it("classifies underpayments", () => {
    expect(
      decideReconciliation({
        amountKobo: 10000,
        expectedAmountKobo: 15000,
        accountFound: true,
        duplicate: false,
      }),
    ).toMatchObject({ status: "underpaid", eventType: "transfer.underpaid" });
  });

  it("classifies overpayments", () => {
    expect(
      decideReconciliation({
        amountKobo: 20000,
        expectedAmountKobo: 15000,
        accountFound: true,
        duplicate: false,
      }),
    ).toMatchObject({ status: "overpaid", eventType: "transfer.overpaid" });
  });

  it("classifies missing account mappings as misdirected", () => {
    expect(
      decideReconciliation({
        amountKobo: 15000,
        expectedAmountKobo: undefined,
        accountFound: false,
        duplicate: false,
      }),
    ).toMatchObject({ status: "misdirected", eventType: "transfer.misdirected" });
  });

  it("classifies duplicate transfers before amount matching", () => {
    const decision = decideReconciliation({
      amountKobo: 15000,
      expectedAmountKobo: 15000,
      accountFound: true,
      duplicate: true,
    });

    expect(decision.status).toBe("duplicate");
    expect(decision.eventType).toBeUndefined();
  });
});
