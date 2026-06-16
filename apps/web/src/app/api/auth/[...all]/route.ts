import { toNextJsHandler } from "better-auth/next-js";

import { auth } from "@/lib/auth/auth";
import { clientIp, rateLimit, tooManyRequests } from "@/lib/ratelimit/limiter";

/**
 * Better Auth's catch-all handler. We wrap POST to rate-limit auth-sensitive
 * sub-paths (sign-in / sign-up / reset) by client IP, blunting credential
 * stuffing and brute force. Read paths (GET, e.g. session/callbacks) are not
 * limited. The limiter degrades to in-memory when Redis is absent.
 */
const handler = toNextJsHandler(auth);

export const { GET } = handler;

/** Auth sub-paths worth limiting (substring match on the URL path). */
const SENSITIVE = [
  "/sign-in",
  "/sign-up",
  "/forget-password",
  "/reset-password",
  "/two-factor",
];

export async function POST(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (SENSITIVE.some((p) => path.includes(p))) {
    const limit = await rateLimit("auth", clientIp(request));
    if (!limit.allowed) return tooManyRequests(limit);
  }
  return handler.POST(request);
}
