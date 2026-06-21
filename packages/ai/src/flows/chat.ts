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
  proposeActionInput,
  getOnboardingStateInput,
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
  /**
   * When true, switch to onboarding/guidance posture: bot calls
   * getOnboardingState first, refuses off-topic, proposes ONE concrete next
   * action via proposeAction. Default `false` (normal authoring chat).
   */
  guidanceMode?: boolean;
  /**
   * Server-side onboarding state injector. The route resolves this from
   * computeOnboardingState() and returns it from the read tool. Pure function
   * so this package stays DB-agnostic.
   */
  getOnboardingState?: () => Promise<unknown>;
}

const SYSTEM = `You are ForgeSpecs' AI architect assistant. You help authors write and refine technical specs (Visions, PRDs, RFCs, ADRs, API specs, DB schemas, task plans).

Rules:
- Ground answers in the provided context and the spec tools. When unsure, use searchSpecs / getDocument / getDependencies rather than guessing.
- When the user asks you to change a document, call proposeEdit with the full revised text. NEVER claim you edited a document — your edits become reviewable suggestions a human approves.
- For whole-document operations (format, restructure, refactor terminology, expand thin sections), first call getDocument to read the current state, then emit a SEQUENCE of proposeEdit calls — one per affected block, each with the full revised text for that block. Each becomes its own suggestion the user accepts independently.
- proposeEdit can target ANY document the user can read, not just the one they're currently viewing — pass the documentId explicitly. Use this when the user references another spec by name ("tidy up the API spec"). Use searchSpecs first to resolve the title to an id.
- Be concise and concrete. Prefer linking related specs by title.`;

const GUIDANCE_SYSTEM = `You are ForgeSpecs' onboarding guide — the most efficient ForgeSpecs user the team has. Your job is to move the current user forward by ONE concrete step. You answer in two short paragraphs at most.

Rules:
- Before your first suggestion of the conversation, call getOnboardingState to see what the user has and hasn't done yet. Cite which signal triggered your suggestion (e.g. "you have no ingest source, so → import").
- For any state change (new project, new doc, start ingest, status flip, or navigation), call proposeAction with ONE high-confidence intent and a one-sentence rationale. Do NOT chain multiple proposeAction calls — pick the highest-value single move.
- If proposeAction would be guesswork, set confidence to "low" and tell the user it's a guess.
- Refuse politely if the user asks about anything not directly related to using ForgeSpecs ("I can only help with ForgeSpecs — try /guide for docs").
- Never claim to have done something the user hasn't confirmed by clicking Accept on a proposeAction card.
- When the user asks "what should I do next?" with no specific context, the right move is almost always: call getOnboardingState, then propose the single step the state implies.`;

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
  /** Optional read-only injector for the guidance-mode getOnboardingState tool. */
  getOnboardingState?: () => Promise<unknown>;
}) {
  const { prisma, userId, workspaceId, projectId, getOnboardingState } = params;

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

    // Guidance-mode read tool. Returns the state object computeOnboardingState
    // produces — workspace/project/source-or-doc/review/approval flags + signals.
    // Server-executed; injected by the route so this package stays DB-agnostic.
    getOnboardingState: tool({
      description:
        "Read the user's onboarding state: which setup milestones are done, what's next, and signals like whether AI is configured and whether local-path ingest is enabled. Call this BEFORE the first suggestion of a guidance conversation so your suggestion is grounded.",
      inputSchema: getOnboardingStateInput,
      execute: async () => {
        if (!getOnboardingState) {
          return { error: "Onboarding state is unavailable in this context." };
        }
        return getOnboardingState();
      },
    }),

    // Guidance-mode client-confirmed action tool. No execute — the chat panel
    // renders a confirmation card per `kind` and, on confirm, calls the
    // matching server action through the existing RBAC chokepoint.
    proposeAction: tool({
      description:
        "Propose ONE concrete next action the user can confirm with a click: createProject / createDocument / startRepoIngest / changeDocumentStatus / navigate. The user must click Accept; you NEVER bypass that. Include a one-sentence rationale and confidence (high/medium/low).",
      inputSchema: proposeActionInput,
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
  const {
    prisma,
    userId,
    messages,
    contextBlock,
    workspaceId,
    projectId,
    guidanceMode,
    getOnboardingState,
  } = params;

  const base = guidanceMode ? GUIDANCE_SYSTEM : SYSTEM;

  // Split the system instructions into TWO messages: a static prelude that is
  // byte-identical across every request (cache candidate) and a per-request
  // context block. OpenRouter's automatic prefix caching on Anthropic models
  // engages on identical leading messages — keeping the static prelude as the
  // first message maximizes hit rate. We don't promise cache hits (the OpenAI-
  // compatible adapter doesn't expose cache_control), but we structure for it.
  const modelMessages: ModelMessage[] = [
    { role: "system", content: base },
  ];
  if (contextBlock && contextBlock.trim().length > 0) {
    modelMessages.push({
      role: "system",
      content: `# Context\n${contextBlock}`,
    });
  }
  modelMessages.push(...(await convertToModelMessages(messages)));

  // Guidance mode is a constrained loop (read state → propose one action with
  // a one-sentence rationale). Haiku-class handles it cleanly at a fraction of
  // Sonnet cost; normal authoring chat stays on `smart`.
  return streamText({
    model: languageModel(guidanceMode ? "fast" : "smart"),
    messages: modelMessages,
    tools: buildChatTools({
      prisma,
      userId,
      workspaceId,
      projectId,
      getOnboardingState,
    }),
    // Allow a few tool round-trips before the model must answer.
    stopWhen: stepCountIs(5),
  });
}
