import { headers } from "next/headers";
import { prisma } from "@forgespecs/db";
import { readableDocumentIds, estimateTokens } from "@forgespecs/core/search";
import {
  hasApiKey,
  runChat,
  assembleContext,
  renderContext,
  buildRetrievers,
} from "@forgespecs/ai";
import type { UIMessage } from "ai";

import { auth } from "@/lib/auth/auth";
import { can } from "@/lib/auth/rbac";
import { rateLimit, tooManyRequests } from "@/lib/ratelimit/limiter";

/**
 * POST /api/ai/chat — streaming spec-aware chat.
 *
 * Body: { messages: UIMessage[], documentId?, selectionText?, workspaceId,
 *         projectId }. The current document + selection drive context assembly
 * (graph neighbours → semantic → comments, packed to a token budget) which is
 * injected as a system message; the flow exposes searchSpecs / getDocument /
 * getDependencies / proposeEdit tools.
 *
 * RBAC: requires `ai.invoke` at the project scope (every domain role except
 * VIEWER has it). The retrieval allow-list is the user's readable docs, so the
 * model can never see specs the user can't.
 *
 * GRACEFUL: with no OPENROUTER_API_KEY this returns a clear 200 message (not a
 * 500) so the rest of the app keeps working when AI is unprovisioned.
 */
export const maxDuration = 60;

interface ChatBody {
  messages: UIMessage[];
  documentId?: string;
  selectionText?: string;
  workspaceId?: string;
  projectId?: string;
}

/** Token budget for assembled context (leaves room for history + tools). */
const CONTEXT_BUDGET_TOKENS = 6000;

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
          "AI is not configured on this server (OPENROUTER_API_KEY is unset). Chat is disabled.",
      },
      { status: 200 },
    );
  }

  const body = (await request.json()) as ChatBody;
  const { messages, documentId, selectionText, workspaceId, projectId } = body;
  if (!Array.isArray(messages)) {
    return Response.json({ error: "messages[] required" }, { status: 400 });
  }

  // RBAC: ai.invoke at the most-specific scope we have.
  const scope =
    projectId && workspaceId
      ? ({ kind: "project", workspaceId, projectId } as const)
      : workspaceId
        ? ({ kind: "workspace", workspaceId } as const)
        : null;
  if (scope && !(await can(scope, "ai.invoke"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Assemble context for the current doc (if any), RBAC-scoped.
  let contextBlock = "";
  if (documentId) {
    try {
      const allowed = await readableDocumentIds(prisma, {
        userId,
        workspaceId,
        projectId,
      });
      if (allowed.includes(documentId)) {
        const assembled = await assembleContext(
          buildRetrievers({
            prisma,
            documentId,
            focusText: selectionText,
            allowedDocumentIds: allowed,
          }),
          { budgetTokens: CONTEXT_BUDGET_TOKENS, estimateTokens },
        );
        contextBlock = renderContext(assembled);
      }
    } catch (err) {
      // Context is best-effort; never fail the chat because retrieval hiccupped.
      console.error("[ai/chat] context assembly failed:", err);
    }
  }

  try {
    const result = await runChat({
      prisma,
      userId,
      currentDocumentId: documentId,
      contextBlock,
      messages,
      workspaceId,
      projectId,
    });
    return result.toUIMessageStreamResponse();
  } catch (err) {
    console.error("[ai/chat] stream failed:", err);
    return Response.json(
      { error: "ai_error", message: "The AI request failed. Please retry." },
      { status: 502 },
    );
  }
}
