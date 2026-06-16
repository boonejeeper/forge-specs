import { headers } from "next/headers";
import { hasApiKey } from "@forgespecs/ai";

import { auth } from "@/lib/auth/auth";
import { can } from "@/lib/auth/rbac";
import { rateLimit, tooManyRequests } from "@/lib/ratelimit/limiter";
import { startArchitectureGeneration } from "@/lib/actions/generation";

/**
 * POST /api/ai/generate-arch — start a resumable "Generate Complete Architecture"
 * job.
 *
 * Per plan risk #2, architecture generation is multi-minute + multi-doc, so it is
 * NOT a single fragile SSE: this endpoint creates a GenerationJob, enqueues it
 * (BullMQ when Redis is present, inline otherwise), and returns the job id. The
 * wizard then polls `getGenerationJob` — placeholder cards in the sidebar
 * materialize live as each doc completes, and a refresh/disconnect resumes from
 * the persisted progress (idempotent on (jobId, docRef)).
 *
 * RBAC: requires `doc.create` AND `ai.invoke` at the project scope. GRACEFUL:
 * no API key → 200 with a clear message.
 */
export const maxDuration = 60;

interface Body {
  idea: string;
  requirements?: string;
  constraints?: string;
  techPrefs?: string;
  workspaceId: string;
  projectId: string;
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const limit = await rateLimit("ai", userId);
  if (!limit.allowed) return tooManyRequests(limit);

  if (!hasApiKey()) {
    return Response.json(
      {
        error: "ai_unavailable",
        message:
          "AI is not configured on this server (OPENROUTER_API_KEY is unset).",
      },
      { status: 200 },
    );
  }

  const body = (await request.json()) as Body;
  const { idea, requirements, constraints, techPrefs, workspaceId, projectId } =
    body;
  if (!idea?.trim()) {
    return Response.json({ error: "idea required" }, { status: 400 });
  }
  if (!workspaceId || !projectId) {
    return Response.json(
      { error: "workspaceId + projectId required" },
      { status: 400 },
    );
  }

  const scope = { kind: "project", workspaceId, projectId } as const;
  if (!(await can(scope, "doc.create")) || !(await can(scope, "ai.invoke"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { jobId, inline } = await startArchitectureGeneration({
    workspaceId,
    projectId,
    input: { idea, requirements, constraints, techPrefs },
  });

  return Response.json({ jobId, inline }, { status: 202 });
}
