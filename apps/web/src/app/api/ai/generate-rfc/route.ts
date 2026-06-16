import { headers } from "next/headers";
import { prisma } from "@forgespecs/db";
import { readableDocumentIds, estimateTokens } from "@forgespecs/core/search";
import {
  hasApiKey,
  streamRfc,
  rfcToGenBlocks,
  genBlocksToBlockNote,
  assembleContext,
  renderContext,
  buildRetrievers,
  type GeneratedRfc,
} from "@forgespecs/ai";

import { auth } from "@/lib/auth/auth";
import { can } from "@/lib/auth/rbac";
import { rateLimit, tooManyRequests } from "@/lib/ratelimit/limiter";
import { createDocument, saveDocumentContent } from "@/lib/actions/documents";

/**
 * POST /api/ai/generate-rfc — generate an RFC from a prompt and stream it into a
 * newly created spec so the user watches it "type itself".
 *
 * Flow: create an empty RFC document (human mutation path) → stream the
 * structured RFC object (streamObject) as a text stream the client renders live
 * → on finish, materialize the full RFC into BlockNote blocks and persist via
 * saveDocumentContent (the same path a human save uses; seeds Block projection +
 * embeddings). The first chunk the client receives is a JSON line with the new
 * document id so it can navigate + show the live preview.
 *
 * RBAC: requires `doc.create` AND `ai.invoke` at the project scope. GRACEFUL:
 * no API key → 200 with a clear message.
 */
export const maxDuration = 120;

interface Body {
  prompt: string;
  workspaceId: string;
  projectId: string;
  /** Optional: ground the RFC in an existing doc's context. */
  contextDocumentId?: string;
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
  const { prompt, workspaceId, projectId, contextDocumentId } = body;
  if (!prompt?.trim()) {
    return Response.json({ error: "prompt required" }, { status: 400 });
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

  // Optional grounding context (RBAC-scoped).
  let contextBlock = "";
  if (contextDocumentId) {
    try {
      const allowed = await readableDocumentIds(prisma, {
        userId,
        workspaceId,
        projectId,
      });
      if (allowed.includes(contextDocumentId)) {
        const assembled = await assembleContext(
          buildRetrievers({
            prisma,
            documentId: contextDocumentId,
            allowedDocumentIds: allowed,
          }),
          { budgetTokens: 4000, estimateTokens },
        );
        contextBlock = renderContext(assembled);
      }
    } catch (err) {
      console.error("[ai/generate-rfc] context assembly failed:", err);
    }
  }

  // Create the empty doc first so the client can navigate immediately.
  const doc = await createDocument({
    workspaceId,
    projectId,
    type: "RFC",
    title: "Generating RFC…",
  });

  try {
    const result = streamRfc({ prompt, contextBlock });

    // On finish, persist the full RFC into the doc body via the human save path.
    void result.object
      .then(async (object) => {
        const rfc = object as GeneratedRfc;
        const blocks = genBlocksToBlockNote(rfcToGenBlocks(rfc));
        await saveDocumentContent({
          documentId: doc.id,
          contentJSON: blocks,
          scope,
        });
        // Rename the doc to the generated title (human mutation path).
        if (rfc.title) {
          await prisma.document.update({
            where: { id: doc.id },
            data: { title: rfc.title },
          });
        }
      })
      .catch((err) => {
        console.error("[ai/generate-rfc] persist failed:", err);
      });

    // Stream the partial object as text. The client renders the preview live and
    // navigates to /specs/{documentId} (sent in a header) once done.
    const response = result.toTextStreamResponse();
    response.headers.set("X-Document-Id", doc.id);
    return response;
  } catch (err) {
    console.error("[ai/generate-rfc] stream failed:", err);
    return Response.json(
      { error: "ai_error", message: "RFC generation failed. Please retry." },
      { status: 502 },
    );
  }
}
