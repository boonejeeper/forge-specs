import "server-only";

import {
  consume,
  type RateLimitDecision,
  type TokenBucketConfig,
  type TokenBucketState,
} from "@forgespecs/core";
import { getConnection, isRedisEnabled } from "@forgespecs/jobs";

/**
 * Rate limiter for API routes. Pure token-bucket math lives in
 * @forgespecs/core (unit-tested); this module only wires it to a STORE:
 *
 *  - Redis-backed when REDIS_URL is set (shared across web replicas), so a
 *    horizontally-scaled deploy enforces one global limit per key.
 *  - In-memory Map fallback otherwise (single-process dev / no-Redis self-host).
 *
 * Both stores read-modify-write the same `TokenBucketState`. The Redis path is
 * a small Lua script so the read+decision+write is atomic under concurrency.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds the client should wait before retrying (for Retry-After header). */
  retryAfterSec: number;
  limit: number;
}

/** Named limiter profiles. Tune per route class. */
export const RATE_LIMITS = {
  /** AI routes: cost is high, so keep a modest sustained rate + small burst. */
  ai: { capacity: 20, refillPerSec: 0.5 } satisfies TokenBucketConfig, // ~30/min sustained-ish, burst 20
  /** Auth-sensitive routes: tight to blunt credential stuffing. */
  auth: { capacity: 10, refillPerSec: 0.2 } satisfies TokenBucketConfig, // burst 10, ~12/min
} as const;

export type RateLimitProfile = keyof typeof RATE_LIMITS;

// ── In-memory store ─────────────────────────────────────────────────────────
const memory = new Map<string, TokenBucketState>();

function decisionToResult(
  d: RateLimitDecision,
  config: TokenBucketConfig,
): RateLimitResult {
  return {
    allowed: d.allowed,
    remaining: d.remaining,
    retryAfterSec: Math.ceil(d.retryAfterMs / 1000),
    limit: config.capacity,
  };
}

function limitInMemory(
  key: string,
  config: TokenBucketConfig,
  nowMs: number,
): RateLimitResult {
  const prev = memory.get(key);
  const d = consume(config, prev, nowMs);
  memory.set(key, d.state);
  return decisionToResult(d, config);
}

// ── Redis store (atomic via Lua) ────────────────────────────────────────────
//
// KEYS[1] = bucket key
// ARGV   = capacity, refillPerSec, nowMs, ttlSec
// Returns { allowedFlag, remaining, retryAfterMs }
const LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])
if tokens == nil then tokens = capacity; ts = now end

local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
local retry = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  local deficit = 1 - tokens
  if refill > 0 then retry = math.ceil((deficit / refill) * 1000) else retry = 2147483647 end
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, ttl)
return { allowed, math.floor(tokens), retry }
`;

async function limitInRedis(
  key: string,
  config: TokenBucketConfig,
  nowMs: number,
): Promise<RateLimitResult> {
  const redis = getConnection();
  // Bucket fully refills in capacity/refill seconds; keep a little headroom.
  const ttlSec = Math.ceil(config.capacity / config.refillPerSec) + 10;
  const res = (await redis.eval(
    LUA,
    1,
    `rl:${key}`,
    String(config.capacity),
    String(config.refillPerSec),
    String(nowMs),
    String(ttlSec),
  )) as [number, number, number];
  return {
    allowed: res[0] === 1,
    remaining: res[1],
    retryAfterSec: Math.ceil(res[2] / 1000),
    limit: config.capacity,
  };
}

/**
 * Apply the named limiter to `identifier` (e.g. `userId` or client IP). Returns
 * the decision. Never throws: a Redis hiccup degrades to in-memory so the route
 * stays available (fail-open on infra error, not on the limit itself).
 */
export async function rateLimit(
  profile: RateLimitProfile,
  identifier: string,
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[profile];
  const key = `${profile}:${identifier}`;
  const nowMs = Date.now();

  if (isRedisEnabled()) {
    try {
      return await limitInRedis(key, config, nowMs);
    } catch (err) {
      console.error("[ratelimit] redis store failed, falling back to memory:", err);
      return limitInMemory(key, config, nowMs);
    }
  }
  return limitInMemory(key, config, nowMs);
}

/** Build a 429 Response from a denied result (with Retry-After + RateLimit-* headers). */
export function tooManyRequests(result: RateLimitResult): Response {
  return Response.json(
    {
      error: "rate_limited",
      message: "Too many requests. Please slow down and retry shortly.",
      retryAfterSec: result.retryAfterSec,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
        "RateLimit-Limit": String(result.limit),
        "RateLimit-Remaining": String(result.remaining),
      },
    },
  );
}

/** Best-effort client identifier for unauthenticated routes (proxy-aware). */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/** For tests: clear the in-memory store. */
export function __resetMemoryStore(): void {
  memory.clear();
}
