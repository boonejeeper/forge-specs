/**
 * Redis connection for BullMQ — LAZY and OPTIONAL.
 *
 * Background jobs are an optimization, not a hard dependency: dev (and `next
 * build`) must work with no Redis running. So:
 *  - importing this module never connects;
 *  - `getConnection()` constructs an ioredis client on first use and memoizes it;
 *  - the client uses `lazyConnect: true`, so even constructing it does NOT open a
 *    socket — ioredis connects on the FIRST actual command (i.e. the first real
 *    enqueue). This is what kills the `next build` ECONNREFUSED spam: nothing
 *    connects unless work is actually produced;
 *  - `isRedisEnabled()` returns false during the Next.js production build phase
 *    and whenever REDIS_URL is unset/DISABLE_REDIS=1, so producers transparently
 *    fall back to INLINE execution (see queues.ts / generation-queue.ts).
 */
import IORedis, { type Redis } from "ioredis";

let client: Redis | undefined;

/**
 * True while `next build` is collecting/prerendering pages. Module code that runs
 * during SSG must NOT open Redis sockets; the inline fallback covers correctness.
 * Next sets NEXT_PHASE='phase-production-build' for the duration of the build.
 */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === "phase-production-build";
}

/** Is background processing via Redis/BullMQ enabled in this process? */
export function isRedisEnabled(): boolean {
  // Never connect during the build/SSG phase, even if REDIS_URL is set: at build
  // time there is no work to enqueue and any connection attempt is pure noise.
  if (isBuildPhase()) return false;
  if (process.env.DISABLE_REDIS === "1" || process.env.DISABLE_REDIS === "true") {
    return false;
  }
  const url = process.env.REDIS_URL;
  return typeof url === "string" && url.length > 0;
}

/**
 * Lazily construct the shared ioredis connection. BullMQ requires
 * `maxRetriesPerRequest: null` for blocking commands. Throws only if called
 * while Redis is disabled — gate on `isRedisEnabled()` first.
 *
 * `lazyConnect: true` means construction does not open a socket; the connection
 * is established on the first command issued by a Queue/Worker. Combined with the
 * `isRedisEnabled()` build guard, no connection is ever attempted during builds.
 */
export function getConnection(): Redis {
  if (client) return client;
  if (!isRedisEnabled()) {
    throw new Error(
      "Redis is not enabled (set REDIS_URL). Gate on isRedisEnabled() and use the inline fallback.",
    );
  }
  client = new IORedis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: null,
    // Don't crash the producer if Redis is briefly unreachable; BullMQ retries.
    enableReadyCheck: false,
    // Do not open a socket on construction — connect on first real command.
    lazyConnect: true,
  });
  // Avoid unhandled 'error' events bringing the process down when Redis blips.
  client.on("error", (err) => {
    console.error("[jobs] redis connection error:", err.message);
  });
  return client;
}

/** Close the shared connection (worker shutdown / tests). */
export async function closeConnection(): Promise<void> {
  if (client) {
    await client.quit().catch(() => {});
    client = undefined;
  }
}
