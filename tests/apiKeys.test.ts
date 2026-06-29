import { describe, expect, it } from "vitest";

import { generateApiKey, hashApiKey } from "../src/apiKeys.js";

describe("API keys", () => {
  it("hashes API keys with SHA-256", () => {
    expect(hashApiKey("rails_test_sample")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashApiKey("rails_test_sample")).toBe(hashApiKey("rails_test_sample"));
    expect(hashApiKey("rails_test_other")).not.toBe(hashApiKey("rails_test_sample"));
  });

  it("generates a key with a stored prefix and hash", () => {
    const generated = generateApiKey();

    expect(generated.key).toMatch(/^rails_test_/);
    expect(generated.prefix).toBe(generated.key.slice(0, 16));
    expect(generated.hash).toBe(hashApiKey(generated.key));
  });
});
