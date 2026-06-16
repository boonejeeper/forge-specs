/**
 * Retrieval adapters — the thin, side-effectful layer that feeds the PURE
 * `assembleContext` packer. Each adapter turns a tier into `ContextItem[]` by
 * calling core search / crossref + Prisma, RBAC-scoped via an explicit
 * allow-list of readable document ids (resolved by the route before calling).
 *
 * Kept separate from `assemble.ts` so the packing/budget logic stays pure and
 * unit-testable; this file is exercised against a live DB in integration, not
 * in the unit suite (Postgres is not running at build time).
 */

import type { PrismaClient } from "@forgespecs/db";
import {
  dependencyClosure,
  reachableDocIds,
  semanticSearch,
  bestChunkPerDocument,
} from "@forgespecs/core/search";

import { embedQuery } from "../embeddings/embed";
import type { ContextItem, ContextRetrievers } from "./assemble";

export interface RetrieveParams {
  prisma: PrismaClient;
  /** The document the user is focused on. */
  documentId: string;
  /** Optional focused section text (selection) — sharpens the semantic query. */
  focusText?: string;
  /** RBAC allow-list: only these doc ids may be retrieved. */
  allowedDocumentIds: string[];
  /** Dependency hop limit (plan: 1–2 hops). Default 2. */
  maxHops?: number;
  /** Max semantic chunks to pull. Default 12. */
  semanticLimit?: number;
  /** Max recent comments to include. Default 6. */
  commentLimit?: number;
}

/**
 * Build the four injected retrievers for `assembleContext` from live data
 * sources. Every leg intersects with `allowedDocumentIds` so nothing outside
 * the caller's membership can enter the context window.
 */
export function buildRetrievers(params: RetrieveParams): ContextRetrievers {
  const {
    prisma,
    documentId,
    focusText,
    allowedDocumentIds,
    maxHops = 2,
    semanticLimit = 12,
    commentLimit = 6,
  } = params;
  const allowed = new Set(allowedDocumentIds);

  return {
    current: async (): Promise<ContextItem[]> => {
      const doc = await prisma.document.findUnique({
        where: { id: documentId },
        select: { id: true, title: true, type: true, contentText: true },
      });
      if (!doc || !allowed.has(doc.id)) return [];
      const content = focusText?.trim()
        ? `Focused selection:\n${focusText.trim()}\n\nFull document:\n${doc.contentText ?? ""}`
        : doc.contentText ?? "";
      return [
        {
          id: doc.id,
          tier: "current",
          title: `${doc.type}: ${doc.title}`,
          content,
          documentId: doc.id,
          rank: 0,
        },
      ];
    },

    dependencies: async (): Promise<ContextItem[]> => {
      if (!allowed.has(documentId)) return [];
      const [outgoing, incoming] = await Promise.all([
        dependencyClosure(prisma, {
          documentId,
          direction: "outgoing",
          maxDepth: maxHops,
        }),
        dependencyClosure(prisma, {
          documentId,
          direction: "incoming",
          maxDepth: maxHops,
        }),
      ]);

      // Shallowest depth + edge kind per neighbour, intersected with RBAC.
      const neighbours = new Map<
        string,
        { depth: number; kind: string; dir: "outgoing" | "incoming" }
      >();
      const consider = (
        ids: string[],
        edges: typeof outgoing,
        pick: (e: (typeof outgoing)[number]) => string,
        dir: "outgoing" | "incoming",
      ): void => {
        const best = new Map<string, { depth: number; kind: string }>();
        for (const e of edges) {
          const id = pick(e);
          const prev = best.get(id);
          if (!prev || e.depth < prev.depth) best.set(id, { depth: e.depth, kind: e.kind });
        }
        for (const id of ids) {
          if (!allowed.has(id) || id === documentId) continue;
          const b = best.get(id);
          if (!b) continue;
          const existing = neighbours.get(id);
          if (!existing || b.depth < existing.depth) {
            neighbours.set(id, { depth: b.depth, kind: b.kind, dir });
          }
        }
      };
      consider(reachableDocIds(outgoing, "outgoing"), outgoing, (e) => e.toDocId, "outgoing");
      consider(reachableDocIds(incoming, "incoming"), incoming, (e) => e.fromDocId, "incoming");

      const ids = [...neighbours.keys()];
      if (ids.length === 0) return [];

      const docs = await prisma.document.findMany({
        where: { id: { in: ids } },
        select: { id: true, title: true, type: true, contentText: true },
      });
      const byId = new Map(docs.map((d) => [d.id, d]));

      // Sort by hop distance so 1-hop neighbours pack before 2-hop ones.
      const sorted = [...neighbours.entries()].sort(
        (a, b) => a[1].depth - b[1].depth,
      );
      return sorted.flatMap(([id, meta], rank) => {
        const d = byId.get(id);
        if (!d) return [];
        const rel = meta.dir === "outgoing" ? `depends on (${meta.kind})` : `referenced by (${meta.kind})`;
        return [
          {
            id,
            tier: "dependency" as const,
            title: `${d.type}: ${d.title} — ${rel}, ${meta.depth} hop${meta.depth > 1 ? "s" : ""}`,
            content: d.contentText ?? "",
            documentId: id,
            rank,
          },
        ];
      });
    },

    semantic: async (): Promise<ContextItem[]> => {
      if (allowedDocumentIds.length === 0) return [];
      const query = (focusText?.trim() || "") || undefined;
      // Without a focus, embed nothing (the current-doc tier already covers it).
      if (!query) return [];
      const vector = await embedQuery(query);
      if (!vector) return [];

      const hits = bestChunkPerDocument(
        await semanticSearch(prisma, {
          embedding: vector,
          documentIds: allowedDocumentIds,
          limit: semanticLimit * 3,
        }),
      ).slice(0, semanticLimit);

      // Drop chunks from the current document (already in tier 1) and resolve
      // titles for the rest.
      const filtered = hits.filter((h) => h.documentId !== documentId);
      const docs = await prisma.document.findMany({
        where: { id: { in: filtered.map((h) => h.documentId) } },
        select: { id: true, title: true, type: true },
      });
      const byId = new Map(docs.map((d) => [d.id, d]));

      return filtered.flatMap((h, rank) => {
        const d = byId.get(h.documentId);
        if (!d) return [];
        return [
          {
            id: `${h.documentId}:${h.chunkIndex}`,
            tier: "semantic" as const,
            title: `${d.type}: ${d.title}`,
            content: h.content,
            documentId: h.documentId,
            rank,
          },
        ];
      });
    },

    comments: async (): Promise<ContextItem[]> => {
      if (!allowed.has(documentId)) return [];
      const rows = await prisma.comment.findMany({
        where: { documentId, resolved: false },
        orderBy: { createdAt: "desc" },
        take: commentLimit,
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { name: true } },
        },
      });
      return rows.map((c, rank) => ({
        id: `comment:${c.id}`,
        tier: "comment" as const,
        title: `${c.author?.name ?? "Someone"} · ${c.createdAt.toISOString().slice(0, 10)}`,
        content: c.body,
        documentId,
        rank,
      }));
    },
  };
}
