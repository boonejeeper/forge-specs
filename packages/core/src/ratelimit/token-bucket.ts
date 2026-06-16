/**
 * Pure token-bucket rate limiter logic — NO I/O, NO Redis, NO clock of its own.
 *
 * The caller supplies the current time and the prior bucket state; the function
 * returns the new state + decision. This keeps the algorithm trivially unit
 * testable and lets the SAME math drive both the in-memory store and the
 * Redis-backed store (which just persists `TokenBucketState` between calls).
 *
 * Token bucket (vs fixed window): smooth, allows short bursts up to `capacity`
 * while bounding the sustained rate to `refillPerSec`. A request costs 1 token.
 */

export interface TokenBucketConfig {
  /** Max tokens (= max burst). */
  capacity: number;
  /** Tokens added per second (= sustained allowed rate). */
  refillPerSec: number;
}

export interface TokenBucketState {
  /** Current available tokens (fractional between refills). */
  tokens: number;
  /** Epoch millis of the last refill calculation. */
  updatedAtMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Tokens remaining after this decision (floored for reporting). */
  remaining: number;
  /** New state to persist. */
  state: TokenBucketState;
  /**
   * If denied, the number of milliseconds until at least one token is available.
   * 0 when allowed.
   */
  retryAfterMs: number;
}

/** Fresh, full bucket as of `nowMs`. */
export function initialBucket(
  config: TokenBucketConfig,
  nowMs: number,
): TokenBucketState {
  return { tokens: config.capacity, updatedAtMs: nowMs };
}

/**
 * Refill `state` up to `nowMs` (clamped at capacity) without consuming. Pure.
 * Tolerates a missing/old state by treating it as a full bucket.
 */
export function refill(
  config: TokenBucketConfig,
  state: TokenBucketState | undefined,
  nowMs: number,
): TokenBucketState {
  if (!state) return initialBucket(config, nowMs);
  const elapsedMs = Math.max(0, nowMs - state.updatedAtMs);
  const refilled = state.tokens + (elapsedMs / 1000) * config.refillPerSec;
  return {
    tokens: Math.min(config.capacity, refilled),
    updatedAtMs: nowMs,
  };
}

/**
 * Attempt to consume `cost` tokens (default 1). Returns the decision + the new
 * state to persist. Deterministic given (config, state, nowMs).
 */
export function consume(
  config: TokenBucketConfig,
  state: TokenBucketState | undefined,
  nowMs: number,
  cost = 1,
): RateLimitDecision {
  const refilled = refill(config, state, nowMs);
  if (refilled.tokens >= cost) {
    const next: TokenBucketState = {
      tokens: refilled.tokens - cost,
      updatedAtMs: nowMs,
    };
    return {
      allowed: true,
      remaining: Math.floor(next.tokens),
      state: next,
      retryAfterMs: 0,
    };
  }
  // Denied — compute when `cost` tokens will be available.
  const deficit = cost - refilled.tokens;
  const retryAfterMs =
    config.refillPerSec > 0
      ? Math.ceil((deficit / config.refillPerSec) * 1000)
      : Number.POSITIVE_INFINITY;
  return {
    allowed: false,
    remaining: Math.floor(refilled.tokens),
    state: refilled,
    retryAfterMs,
  };
}
