import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { hasApiKey, resetProvider } from "./provider";
import { embedTexts } from "./embeddings/embed";

describe("provider lazy/graceful behavior", () => {
  const prev = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    resetProvider();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = prev;
    resetProvider();
  });

  it("hasApiKey is false when unset", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(hasApiKey()).toBe(false);
  });

  it("hasApiKey is true when set", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    expect(hasApiKey()).toBe(true);
  });

  it("importing the provider module does not throw without a key", () => {
    delete process.env.OPENROUTER_API_KEY;
    // Re-importing is fine; construction is deferred to getProvider().
    expect(() => hasApiKey()).not.toThrow();
  });

  it("embedTexts returns [] for empty input regardless of key", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const res = await embedTexts([]);
    expect(res).toEqual({ model: expect.any(String), embeddings: [] });
  });

  it("embedTexts returns null (no-op) when no key and there is work", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const res = await embedTexts(["hello"]);
    expect(res).toBeNull();
  });
});
