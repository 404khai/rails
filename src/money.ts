export const toKobo = (amount: number | string): number => {
  const parsed = typeof amount === "number" ? amount : Number(amount);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("Amount must be a non-negative number");
  }

  return Math.round(parsed * 100);
};

export const fromKobo = (amountKobo: number): number => amountKobo / 100;
