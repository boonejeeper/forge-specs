import crypto from "node:crypto";

import { prisma, type Prisma } from "@forgespecs/db";
import { env } from "@forgespecs/config";
import {
  interpretPullRequestEvent,
  type GithubPullRequestPayload,
} from "@forgespecs/core";

/**
 * POST /api/webhooks/github — GitHub PR linkage (M11), OPTIONAL + config-driven.
 *
 * When GITHUB_WEBHOOK_SECRET is set, this verifies the `X-Hub-Signature-256`
 * HMAC, then reflects the PR's state (open/closed/merged/draft) onto every
 * PullRequestLink that points at it (matched by repo owner/name + number), and
 * writes a PR_STATUS_CHANGED audit event per affected document's workspace.
 *
 * GRACEFUL: with no secret configured the endpoint returns 503 (feature off) and
 * never touches the DB. Signature failures return 401. Unhandled event types are
 * 200-ignored so GitHub doesn't retry.
 */
export const dynamic = "force-dynamic";

function verifySignature(secret: string, raw: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  // Constant-time compare (lengths must match for timingSafeEqual).
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request): Promise<Response> {
  const secret = env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { error: "github_webhook_disabled", message: "GITHUB_WEBHOOK_SECRET is not set." },
      { status: 503 },
    );
  }

  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifySignature(secret, raw, signature)) {
    return Response.json({ error: "invalid_signature" }, { status: 401 });
  }

  const eventType = request.headers.get("x-github-event");
  if (eventType === "ping") {
    return Response.json({ ok: true, pong: true });
  }
  if (eventType !== "pull_request") {
    // We only care about PR events; ack everything else so GitHub stops retrying.
    return Response.json({ ok: true, ignored: eventType });
  }

  let payload: GithubPullRequestPayload;
  try {
    payload = JSON.parse(raw) as GithubPullRequestPayload;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const event = interpretPullRequestEvent(payload);
  if (!event) return Response.json({ ok: true, ignored: "incomplete" });

  // Find all links pointing at this PR and reflect its status.
  const links = await prisma.pullRequestLink.findMany({
    where: {
      repoOwner: event.ref.owner,
      repoName: event.ref.repo,
      number: event.ref.number,
    },
    select: {
      id: true,
      document: { select: { id: true, project: { select: { workspaceId: true } } } },
    },
  });

  if (links.length === 0) return Response.json({ ok: true, matched: 0 });

  let updated = 0;
  for (const link of links) {
    await prisma.$transaction(async (tx) => {
      await tx.pullRequestLink.update({
        where: { id: link.id },
        data: {
          state: event.state,
          merged: event.merged,
          ...(event.title ? { title: event.title } : {}),
          ...(event.url ? { url: event.url } : {}),
        },
      });
      await tx.activityEvent.create({
        data: {
          workspaceId: link.document.project.workspaceId,
          actorId: null,
          type: "PR_STATUS_CHANGED",
          entityType: "document",
          entityId: link.document.id,
          data: {
            number: event.ref.number,
            repo: `${event.ref.owner}/${event.ref.repo}`,
            state: event.state,
            merged: event.merged,
          } as Prisma.InputJsonValue,
        },
      });
    });
    updated++;
  }

  return Response.json({ ok: true, matched: links.length, updated });
}
