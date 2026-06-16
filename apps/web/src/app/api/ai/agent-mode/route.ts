import { headers } from "next/headers";
import { prisma } from "@forgespecs/db";
import type { DocumentType } from "@forgespecs/db";
import {
  hasApiKey,
  generateTasks,
  generateEpics,
  generateRepoStructure,
  generateAgentPrompts,
} from "@forgespecs/ai";

import { auth } from "@/lib/auth/auth";
import { can } from "@/lib/auth/rbac";
import { rateLimit, tooManyRequests } from "@/lib/ratelimit/limiter";
import { createDocument, saveDocumentContent } from "@/lib/actions/documents";

/**
 * POST /api/ai/agent-mode — agent execution mode. Generate tasks / epics /
 * repo-structure / agent-prompts from a source spec (or prompt) and seed the
 * result into a NEW document via the human mutation paths (createDocument +
 * saveDocumentContent). The AI never writes Postgres-of-record directly.
 *
 * Body: { mode, sourceDocumentId?, prompt?, workspaceId, projectId }.
 *
 * RBAC: requires `doc.create` + `ai.invoke` at the project scope. GRACEFUL:
 * no API key → 200 message.
 */
export const maxDuration = 120;

type Mode = "tasks" | "epics" | "repo-structure" | "agent-prompts";

interface Body {
  mode: Mode;
  sourceDocumentId?: string;
  prompt?: string;
  workspaceId: string;
  projectId: string;
}

const MODE_META: Record<Mode, { type: DocumentType; title: string }> = {
  tasks: { type: "TASK_PLAN", title: "Tasks" },
  epics: { type: "TASK_PLAN", title: "Epics" },
  "repo-structure": { type: "RUNBOOK", title: "Repository structure" },
  "agent-prompts": { type: "RUNBOOK", title: "Agent prompts" },
};

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
  const { mode, sourceDocumentId, prompt, workspaceId, projectId } = body;
  const meta = MODE_META[mode];
  if (!meta) return Response.json({ error: "invalid mode" }, { status: 400 });
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

  // Resolve the source text: a doc's contentText (RBAC-checked) or the prompt.
  let source = prompt?.trim() ?? "";
  if (sourceDocumentId) {
    const doc = await prisma.document.findFirst({
      where: { id: sourceDocumentId, project: { id: projectId } },
      select: { contentText: true, title: true },
    });
    if (doc) source = `${doc.title}\n\n${doc.contentText}`.trim();
  }
  if (!source) {
    return Response.json(
      { error: "a source document or prompt is required" },
      { status: 400 },
    );
  }

  try {
    let blocks: unknown[];
    switch (mode) {
      case "tasks":
        blocks = (await generateTasks({ source })).blocks;
        break;
      case "epics":
        blocks = (await generateEpics({ source })).blocks;
        break;
      case "repo-structure":
        blocks = (await generateRepoStructure({ source })).blocks;
        break;
      case "agent-prompts":
        blocks = (await generateAgentPrompts({ source })).blocks;
        break;
    }

    const doc = await createDocument({
      workspaceId,
      projectId,
      type: meta.type,
      title: meta.title,
    });
    await saveDocumentContent({
      documentId: doc.id,
      contentJSON: blocks,
      scope,
    });

    return Response.json({ documentId: doc.id, title: doc.title }, { status: 201 });
  } catch (err) {
    console.error(`[ai/agent-mode:${mode}] failed:`, err);
    return Response.json(
      { error: "ai_error", message: "Generation failed. Please retry." },
      { status: 502 },
    );
  }
}
