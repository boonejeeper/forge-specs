import { afterEach, describe, expect, it, vi } from "vitest";

import {
  enqueueGeneration,
  registerGenerationRunner,
  getGenerationRunner,
} from "./generation-queue";

describe("enqueueGeneration inline fallback", () => {
  const prev = process.env.REDIS_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
    registerGenerationRunner(undefined as never);
  });

  it("runs the registered runner inline when Redis is disabled", async () => {
    delete process.env.REDIS_URL;
    const runner = vi.fn(async (_id: string) => {});
    registerGenerationRunner(runner);

    const res = await enqueueGeneration("gen_1");
    expect(res).toEqual({ enqueued: false, inline: true });
    // Inline path is fire-and-forget; allow the microtask to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(runner).toHaveBeenCalledWith("gen_1");
  });

  it("does not throw inline when no runner is registered", async () => {
    delete process.env.REDIS_URL;
    registerGenerationRunner(undefined as never);
    const res = await enqueueGeneration("gen_2");
    expect(res.inline).toBe(true);
  });

  it("registerGenerationRunner sets the runner", () => {
    const runner = vi.fn(async () => {});
    registerGenerationRunner(runner);
    expect(getGenerationRunner()).toBe(runner);
  });
});
