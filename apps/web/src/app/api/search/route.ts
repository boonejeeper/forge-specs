import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { prisma } from "@forgespecs/db";
import {
  readableDocumentIds,
  fullTextSearch,
  semanticSearch,
  fuseSearchResults,
  type SearchMode,
} from "@forgespecs/core/search";
import { embedQuery, hasApiKey } from "@forgespecs/ai";

import { auth } from "@/lib/auth/auth";

/**
 * GET /api/search?q=&workspaceId=&projectId=&mode=
 *
 * Hybrid search: full-text (websearch_to_tsquery + ts_rank_cd over the
 * maintained tsvector) + semantic (pgvector cosine), fused with Reciprocal Rank
 * Fusion. RBAC-scoped: results are restricted to documents the session user can
 * read, optionally narrowed to a workspace / project.
 *
 * Graceful degradation: when no OPENROUTER_API_KEY is configured (or embedding
 * fails), the semantic leg is skipped and results fall back to full-text only —
 * the endpoint never errors because AI is unprovisioned.
 *
 * `mode`: "all" (default, hybrid) | "text" (full-text only) | "semantic".
 */

export interface SearchHitDto {
  documentId: string;
  title: string;
  type: string;
  status: string;
  projectId: string;
  projectSlug: string;
  workspaceSlug: string;
  snippet: string;
  score: number;
  matchedText: boolean;
  matchedSemantic: boolean;
}

export interface SearchResponse {
  query: string;
  mode: SearchMode;
  semanticAvailable: boolean;
  results: SearchHitDto[];
}

const MAX_RESULTS = 20;

function parseMode(raw: string | null): SearchMode {
  if (raw === "text" || raw === "semantic") return raw;
  return "all";
}

export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const workspaceId = url.searchParams.get("workspaceId") ?? undefined;
  const projectId = url.searchParams.get("projectId") ?? undefined;
  const mode = parseMode(url.searchParams.get("mode"));

  const session = await auth.api.getSession({ headers: await headers() });
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const empty: SearchResponse = {
    query: q,
    mode,
    semanticAvailable: hasApiKey(),
    results: [],
  };
  if (!q) return NextResponse.json(empty);

  // RBAC allow-list — every leg filters to these ids, so nothing outside the
  // user's membership can ever rank.
  const allowedIds = await readableDocumentIds(prisma, {
    userId,
    workspaceId,
    projectId,
  });
  if (allowedIds.length === 0) return NextResponse.json(empty);

  // Full-text leg (skipped in pure-semantic mode).
  const fullText =
    mode === "semantic"
      ? []
      : await fullTextSearch(prisma, {
          query: q,
          documentIds: allowedIds,
          limit: 40,
        });

  // Semantic leg — only when not text-only AND a key is available. Embedding or
  // query failures degrade to full-text rather than 500.
  let semantic: Awaited<ReturnType<typeof semanticSearch>> = [];
  let semanticAvailable = false;
  if (mode !== "text" && hasApiKey()) {
    try {
      const vector = await embedQuery(q);
      if (vector) {
        semanticAvailable = true;
        semantic = await semanticSearch(prisma, {
          embedding: vector,
          documentIds: allowedIds,
          limit: 60,
        });
      }
    } catch {
      // Swallow — fall back to full-text only.
      semantic = [];
    }
  }

  const fused = fuseSearchResults(fullText, semantic, { limit: MAX_RESULTS });
  if (fused.length === 0) {
    return NextResponse.json({ ...empty, semanticAvailable });
  }

  // Hydrate doc/project/workspace metadata for the ranked ids (order preserved).
  const docs = await prisma.document.findMany({
    where: { id: { in: fused.map((f) => f.documentId) } },
    select: {
      id: true,
      title: true,
      type: true,
      status: true,
      projectId: true,
      project: {
        select: {
          slug: true,
          workspace: { select: { slug: true } },
        },
      },
    },
  });
  const byId = new Map(docs.map((d) => [d.id, d]));

  const results: SearchHitDto[] = [];
  for (const f of fused) {
    const d = byId.get(f.documentId);
    if (!d) continue;
    results.push({
      documentId: d.id,
      title: d.title,
      type: d.type,
      status: d.status,
      projectId: d.projectId,
      projectSlug: d.project.slug,
      workspaceSlug: d.project.workspace.slug,
      snippet: f.snippet,
      score: f.score,
      matchedText: f.matchedText,
      matchedSemantic: f.matchedSemantic,
    });
  }

  const response: SearchResponse = {
    query: q,
    mode,
    semanticAvailable,
    results,
  };
  return NextResponse.json(response);
}
