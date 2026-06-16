import { describe, expect, it } from "vitest";

import {
  consume,
  initialBucket,
  refill,
  type TokenBucketConfig,
} from "./token-bucket";

const cfg: TokenBucketConfig = { capacity: 5, refillPerSec: 1 };

describe("token-bucket", () => {
  it("starts full", () => {
    const s = initialBucket(cfg, 0);
    expect(s.tokens).toBe(5);
  });

  it("allows up to capacity in a burst then denies", () => {
    let state = initialBucket(cfg, 0);
    const results = [];
    for (let i = 0; i < 6; i++) {
      const d = consume(cfg, state, 0);
      state = d.state;
      results.push(d.allowed);
    }
    expect(results).toEqual([true, true, true, true, true, false]);
  });

  it("reports remaining tokens", () => {
    let state = initialBucket(cfg, 0);
    const d1 = consume(cfg, state, 0);
    expect(d1.remaining).toBe(4);
    state = d1.state;
    const d2 = consume(cfg, state, 0);
    expect(d2.remaining).toBe(3);
  });

  it("refills over time, clamped at capacity", () => {
    // Drain to 0.
    let state = initialBucket(cfg, 0);
    for (let i = 0; i < 5; i++) state = consume(cfg, state, 0).state;
    expect(consume(cfg, state, 0).allowed).toBe(false);

    // After 3s at 1/s, ~3 tokens are back.
    const r = refill(cfg, state, 3000);
    expect(r.tokens).toBeCloseTo(3, 5);

    // After a long idle, clamp at capacity (no overflow).
    const r2 = refill(cfg, state, 1_000_000);
    expect(r2.tokens).toBe(5);
  });

  it("computes retryAfterMs when denied", () => {
    let state = initialBucket(cfg, 0);
    for (let i = 0; i < 5; i++) state = consume(cfg, state, 0).state;
    const d = consume(cfg, state, 0);
    expect(d.allowed).toBe(false);
    // Need 1 token at 1/s → ~1000ms.
    expect(d.retryAfterMs).toBe(1000);
  });

  it("treats missing state as a full bucket", () => {
    const d = consume(cfg, undefined, 12345);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(4);
  });

  it("supports cost > 1", () => {
    const state = initialBucket(cfg, 0);
    const d = consume(cfg, state, 0, 3);
    expect(d.allowed).toBe(true);
    expect(d.remaining).toBe(2);
    const d2 = consume(cfg, d.state, 0, 3);
    expect(d2.allowed).toBe(false);
  });

  it("partial refill enables a previously-denied request", () => {
    let state = initialBucket(cfg, 0);
    for (let i = 0; i < 5; i++) state = consume(cfg, state, 0).state;
    // Denied at t=0.
    expect(consume(cfg, state, 0).allowed).toBe(false);
    // Allowed at t=1000 (1 token refilled).
    const d = consume(cfg, state, 1000);
    expect(d.allowed).toBe(true);
  });
});
