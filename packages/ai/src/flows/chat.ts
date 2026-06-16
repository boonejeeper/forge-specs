/**
 * Chat flow — `streamText` over the `smart` model with spec-aware tools.
 *
 * Tools:
 *  - searchSpecs      → hybrid search (RBAC-scoped) returns matching docs.
 *  - getDocument      → fetch a document's text (RBAC-checked).
 *  - getDependencies  → dependency-graph closure (incoming/outgoing).
 *  - proposeEdit      → does NOT execute server-side; it returns a structured
 *                       proposal the UI confirms, then routes through M5
 *                       createSuggestion (the human mutation/suggestion path).
 *                       Defining it WITHOUT an `execute` makes the AI SDK surface
 *                       it as a client-handled tool call (a confirmation card).
 *
 * Lazy provider: callers must gate on `hasApiKey()` before invoking; the route
 * returns a graceful message otherwise. The assembled context block (from
 * context/assemble) is injected as a system message so retrieval is decoupled
 * from this flow and reusable by M7.
 */
import {
  streamText,
  tool,
  stepCountIs,
  convertToModelMessages,
  type ModelMessage,
  type UIMessage,
  type StreamTextResult,
} from "ai";
import type { PrismaClient } from "@forgespecs/db";
import {
  readableDocumentIds,
  fullTextSearch,
  semanticSearch,
  fuseSearchResults,
} from "@forgespecs/core/search";

import { languageModel } from "../models";
import { embedQuery } from "../embeddings/embed";
import { hasApiKey } from "../provider";
import {
  searchSpecsInput,
  getDocumentInput,
  getDependenciesInput,
  proposeEditInput,
} from "./tool-schemas";
import { dependencyClosure, reachableDocIds } from "@forgespecs/core/search";

export interface ChatFlowParams {
  prisma: PrismaClient;
  userId: string;
  /** Current document the user is viewing (for proposeEdit defaults + context). */
  currentDocumentId?: string;
  /** Pre-assembled context block (from assembleContext + renderContext). */
  contextBlock?: string;
  /** Chat history from the client (AI SDK UIMessages). */
  messages: UIMessage[];
  /** Optional workspace/project narrowing for the RBAC allow-list. */
  workspaceId?: string;
  projectId?: string;
}

const SYSTEM = `You are ForgeSpecs' AI architect assistant. You help authors write and refine technical specs (Visions, PRDs, RFCs, ADRs, API specs, DB schemas, task plans).

Rules:
- Ground answers in the provided context and the spec tools. When unsure, use searchSpecs / getDocument / getDependencies rather than guessing.
- When the user asks you to change a document, call proposeEdit with the full revised text. NEVER claim you edited a document — your edits become reviewable suggestions a human approves.
- Be concise and concrete. Prefer linking related specs by title.`;

/**
 * Build the bound tool set. `searchSpecs`/`getDocument`/`getDependencies`
 * execute server-side against RBAC-scoped data. `proposeEdit` has NO execute —
 * the client handles it as a confirmation card and submits via createSuggestion.
 */
/** The bound chat tool set type (for typing the stream result). */
export type ChatTools = ReturnType<typeof buildChatTools>;

export function buildChatTools(params: {
  prisma: PrismaClient;
  userId: string;
  workspaceId?: string;
  projectId?: string;
}) {
  const { prisma, userId, workspaceId, projectId } = params;

  const allowList = async (): Promise<string[]> =>
    readableDocumentIds(prisma, { userId, workspaceId, projectId });

  return {
    searchSpecs: tool({
      description:
        "Hybrid full-text + semantic search over specs the user can read. Returns matching documents with snippets.",
      inputSchema: searchSpecsInput,
      execute: async ({ query, limit }) => {
        const allowed = await allowList();
        if (allowed.length === 0) return { results: [] };
        const fullText = await fullTextSearch(prisma, {
          query,
          documentIds: allowed,
          limit: 40,
        });
        let semantic: Awaited<ReturnType<typeof semanticSearch>> = [];
        if (hasApiKey()) {
          try {
            const v = await embedQuery(query);
            if (v) {
              semantic = await semanticSearch(prisma, {
                embedding: v,
                documentIds: allowed,
                limit: 60,
              });
            }
          } catch {
            /* degrade to full-text */
          }
        }
        const fused = fuseSearchResults(fullText, semantic, { limit });
        const docs = await prisma.document.findMany({
          where: { id: { in: fused.map((f) => f.documentId) } },
          select: { id: true, title: true, type: true, status: true },
        });
        const byId = new Map(docs.map((d) => [d.id, d]));
        return {
          results: fused.flatMap((f) => {
            const d = byId.get(f.documentId);
            if (!d) return [];
            return [
              {
                documentId: d.id,
                title: d.title,
                type: d.type,
                status: d.status,
                snippet: f.snippet,
              },
            ];
          }),
        };
      },
    }),

    getDocument: tool({
      description: "Fetch a document's title, type, status, and full text.",
      inputSchema: getDocumentInput,
      execute: async ({ documentId }) => {
        const allowed = new Set(await allowList());
        if (!allowed.has(documentId)) return { error: "Not found or not permitted." };
        const doc = await prisma.document.findUnique({
          where: { id: documentId },
          select: { id: true, title: true, type: true, status: true, contentText: true },
        });
        if (!doc) return { error: "Not found." };
        return doc;
      },
    }),

    getDependencies: tool({
      description:
        "Inspect a document's dependency graph (what it depends on / what depends on it).",
      inputSchema: getDependenciesInput,
      execute: async ({ documentId, direction, maxDepth }) => {
        const allowed = new Set(await allowList());
        if (!allowed.has(documentId)) return { error: "Not found or not permitted." };
        const dirs =
          direction === "both"
            ? (["outgoing", "incoming"] as const)
            : ([direction] as const);
        const out: { documentId: string; depth: number; kind: string; direction: string }[] = [];
        for (const dir of dirs) {
          const edges = await dependencyClosure(prisma, { documentId, direction: dir, maxDepth });
          for (const id of reachableDocIds(edges, dir)) {
            if (!allowed.has(id)) continue;
            const edge = edges.find((e) => (dir === "outgoing" ? e.toDocId : e.fromDocId) === id);
            out.push({ documentId: id, depth: edge?.depth ?? 1, kind: edge?.kind ?? "", direction: dir });
          }
        }
        const docs = await prisma.document.findMany({
          where: { id: { in: out.map((o) => o.documentId) } },
          select: { id: true, title: true, type: true },
        });
        const byId = new Map(docs.map((d) => [d.id, d]));
        return {
          dependencies: out.flatMap((o) => {
            const d = byId.get(o.documentId);
            if (!d) return [];
            return [{ ...o, title: d.title, type: d.type }];
          }),
        };
      },
    }),

    // No execute → client-confirmed tool. The model fills proposedText; the UI
    // shows a confirmation card and, on accept, computes the delta via core
    // diffSuggestion and submits createSuggestion (M5 path).
    proposeEdit: tool({
      description:
        "Propose a reviewable edit to a document. The user must confirm; on confirm it becomes a track-changes Suggestion they approve. Provide the FULL revised text for the targeted block.",
      inputSchema: proposeEditInput,
    }),
  };
}

/**
 * Run the chat flow and return a streaming result. The route turns this into a
 * `toUIMessageStreamResponse()`. Throws only if invoked without a key — gate on
 * hasApiKey() upstream for graceful UX.
 */
export async function runChat(
  params: ChatFlowParams,
): Promise<StreamTextResult<ChatTools, never>> {
  const { prisma, userId, messages, contextBlock, workspaceId, projectId } = params;

  const system =
    contextBlock && contextBlock.trim().length > 0
      ? `${SYSTEM}\n\n# Context\n${contextBlock}`
      : SYSTEM;

  const modelMessages: ModelMessage[] = await convertToModelMessages(messages);

  return streamText({
    model: languageModel("smart"),
    system,
    messages: modelMessages,
    tools: buildChatTools({ prisma, userId, workspaceId, projectId }),
    // Allow a few tool round-trips before the model must answer.
    stopWhen: stepCountIs(5),
  });
}
