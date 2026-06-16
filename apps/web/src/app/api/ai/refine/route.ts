import { headers } from "next/headers";
import { prisma } from "@forgespecs/db";
import { hasApiKey, runRefine, type RefineMode } from "@forgespecs/ai";

import { auth } from "@/lib/auth/auth";
import { can } from "@/lib/auth/rbac";
import { rateLimit, tooManyRequests } from "@/lib/ratelimit/limiter";

/**
 * POST /api/ai/refine — stream a refined / expanded version of a selection.
 *
 * Body: { selection, instruction?, mode?, documentId, workspaceId, projectId }.
 * Returns a plain text stream of the proposed revision. The CLIENT, on
 * completion, computes a jsondiffpatch delta (core diffSuggestion) against the
 * live body and submits it via the M5 `createSuggestion` action — the refine
 * result becomes an APPROVABLE SUGGESTION, never a hard overwrite. The AI never
 * writes Postgres-of-record directly.
 *
 * RBAC: requires `suggestion.create` (the eventual write path) at the project
 * scope. GRACEFUL: no API key → 200 with a clear message, not a 500.
 */
export const maxDuration = 60;

interface RefineBody {
  selection: string;
  instruction?: string;
  mode?: RefineMode;
  documentContext?: string;
  documentId?: string;
  workspaceId?: string;
  projectId?: string;
}

export async function POST(request: Request): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  const body = (await request.json()) as RefineBody;
  const { selection, instruction, mode, documentContext, workspaceId, projectId } =
    body;
  if (!selection || !selection.trim()) {
    return Response.json({ error: "selection required" }, { status: 400 });
  }

  // RBAC: the refine output becomes a suggestion, so gate on suggestion.create.
  const scope =
    projectId && workspaceId
      ? ({ kind: "project", workspaceId, projectId } as const)
      : workspaceId
        ? ({ kind: "workspace", workspaceId } as const)
        : null;
  if (scope && !(await can(scope, "suggestion.create"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const result = runRefine({ selection, instruction, mode, documentContext });
    // Plain text stream — the client appends it into a suggestion preview.
    return result.toTextStreamResponse();
  } catch (err) {
    console.error("[ai/refine] stream failed:", err);
    return Response.json(
      { error: "ai_error", message: "The AI request failed. Please retry." },
      { status: 502 },
    );
  }
}
