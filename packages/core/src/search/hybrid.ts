import { fuseIdLists } from "./fusion";
import type { FullTextHit, SemanticHit } from "./queries";
import { bestChunkPerDocument } from "./queries";

/**
 * Fuse the two retrieval legs into a single ranked list of document ids and
 * attach the best available snippet per document. Pure (no DB) so it is
 * unit-testable; the route resolves the allow-list, runs the SQL legs, and feeds
 * their outputs here.
 *
 * Snippet preference: full-text ts_headline (highlights the literal match) wins
 * when present; otherwise the closest semantic chunk's content is used.
 */
export type SearchMode = "all" | "text" | "semantic";

export interface HybridResultItem {
  documentId: string;
  score: number;
  snippet: string;
  /** Which legs contributed — drives the "matched on" UI affordance. */
  matchedText: boolean;
  matchedSemantic: boolean;
}

export interface FuseSearchOptions {
  /** RRF damping constant. */
  k?: number;
  /** Relative weight of the full-text leg. Default 1. */
  textWeight?: number;
  /** Relative weight of the semantic leg. Default 1. */
  semanticWeight?: number;
  /** Cap on the fused result count. Default 20. */
  limit?: number;
}

export function fuseSearchResults(
  fullText: FullTextHit[],
  semantic: SemanticHit[],
  options: FuseSearchOptions = {},
): HybridResultItem[] {
  const {
    k = 60,
    textWeight = 1,
    semanticWeight = 1,
    limit = 20,
  } = options;

  const bestSemantic = bestChunkPerDocument(semantic);

  const fused = fuseIdLists(
    [
      { ids: fullText.map((h) => h.documentId), weight: textWeight },
      { ids: bestSemantic.map((h) => h.documentId), weight: semanticWeight },
    ],
    { k },
  );

  const snippetByDoc = new Map<string, string>();
  const semanticByDoc = new Map<string, SemanticHit>();
  for (const h of bestSemantic) semanticByDoc.set(h.documentId, h);
  const textIds = new Set(fullText.map((h) => h.documentId));
  for (const h of fullText) {
    if (h.snippet) snippetByDoc.set(h.documentId, h.snippet);
  }

  return fused.slice(0, limit).map((f) => {
    const matchedText = textIds.has(f.id);
    const sem = semanticByDoc.get(f.id);
    const snippet =
      snippetByDoc.get(f.id) ?? sem?.content?.slice(0, 240) ?? "";
    return {
      documentId: f.id,
      score: f.score,
      snippet,
      matchedText,
      matchedSemantic: Boolean(sem),
    };
  });
}
