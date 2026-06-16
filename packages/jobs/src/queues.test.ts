import { afterEach, describe, expect, it, vi } from "vitest";

import { isRedisEnabled } from "./connection";

// Mock the processor so the inline-fallback path doesn't touch the AI package /
// a real DB. We only assert the producer's enqueue-vs-inline decision here.
const runEmbed = vi.fn(
  async (_prisma: unknown, _documentId: string) => ({
    documentId: "d",
    embedded: 0,
    reused: 0,
    removed: 0,
    skipped: true,
  }),
);
vi.mock("./processor", () => ({
  runEmbedDocument: (prisma: unknown, documentId: string) =>
    runEmbed(prisma, documentId),
}));

describe("isRedisEnabled", () => {
  const prev = process.env.REDIS_URL;
  const prevDisable = process.env.DISABLE_REDIS;
  afterEach(() => {
    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
    if (prevDisable === undefined) delete process.env.DISABLE_REDIS;
    else process.env.DISABLE_REDIS = prevDisable;
  });

  it("is false without REDIS_URL", () => {
    delete process.env.REDIS_URL;
    expect(isRedisEnabled()).toBe(false);
  });

  it("is true with REDIS_URL", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    delete process.env.DISABLE_REDIS;
    expect(isRedisEnabled()).toBe(true);
  });

  it("respects DISABLE_REDIS=1 even when REDIS_URL is set", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    process.env.DISABLE_REDIS = "1";
    expect(isRedisEnabled()).toBe(false);
  });
});

describe("enqueueEmbedDocument inline fallback", () => {
  const prev = process.env.REDIS_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = prev;
    runEmbed.mockClear();
    vi.resetModules();
  });

  it("runs inline (no enqueue) when Redis is disabled", async () => {
    delete process.env.REDIS_URL;
    const { enqueueEmbedDocument } = await import("./queues");
    const res = await enqueueEmbedDocument({} as never, "doc_1");
    expect(res).toEqual({ enqueued: false, inline: true });
    // Inline path is fire-and-forget; give the microtask a tick to run.
    await new Promise((r) => setTimeout(r, 0));
    expect(runEmbed).toHaveBeenCalledWith(expect.anything(), "doc_1");
  });
});
