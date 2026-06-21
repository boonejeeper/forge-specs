import { headers } from "next/headers";

import { auth } from "@/lib/auth/auth";
import { can } from "@/lib/auth/rbac";
import { rateLimit, tooManyRequests } from "@/lib/ratelimit/limiter";
import { startRepoIngest } from "@/lib/actions/ingest";

/**
 * POST /api/ingest — kick off a repo ingest job for a project. Returns the
 * GenerationJob id; the client polls `getGenerationJob` for progress.
 *
 * RBAC: `doc.create` AND `ai.invoke` at project scope (same chokepoint as the
 * architecture wizard). GRACEFUL with no OPENROUTER_API_KEY — the verbatim pass
 * still runs; only the AI synthesis stage is skipped.
 */
export const maxDuration = 60;

interface Body {
  workspaceId: string;
  projectId: string;
  source:
    | { kind: "LOCAL"; path: string }
    | { kind: "GITHUB"; ref: string; branch?: string; token?: string };
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await rateLimit("ai", userId);
  if (!limit.allowed) return tooManyRequests(limit);

  const body = (await request.json()) as Body;
  const { workspaceId, projectId, source } = body;
  if (!workspaceId || !projectId || !source?.kind) {
    return Response.json({ error: "workspaceId, projectId, source required" }, { status: 400 });
  }

  const scope = { kind: "project", workspaceId, projectId } as const;
  if (!(await can(scope, "doc.create")) || !(await can(scope, "ai.invoke"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const { jobId, inline } = await startRepoIngest({ workspaceId, projectId, source });
    return Response.json({ jobId, inline }, { status: 202 });
  } catch (err) {
    return Response.json(
      {
        error: "ingest_failed",
        message: err instanceof Error ? err.message : "Failed to start ingest.",
      },
      { status: 400 },
    );
  }
}
