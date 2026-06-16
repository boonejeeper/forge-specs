/**
 * Reciprocal Rank Fusion (RRF) — combine several independently-ranked result
 * lists into one. Pure and dependency-free so it is unit-testable and reusable
 * by both the hybrid search route (full-text + semantic) and, in M6, the AI
 * context-assembly packer.
 *
 * RRF score for an item is the sum, over every list it appears in, of
 * `weight / (k + rank)` where `rank` is the item's 0-based position in that
 * list. The constant `k` (default 60, the value from the original Cormack et al.
 * paper) damps the contribution of very high ranks so that an item ranked #1 in
 * one list cannot completely dominate items that appear consistently across
 * lists. Fusing on rank (not raw score) is what makes RRF robust to the wildly
 * different score scales of BM25/ts_rank_cd vs. cosine distance.
 */

/** A single ranked list to be fused. Items are assumed already in rank order. */
export interface RankedList<T> {
  /** Items in descending relevance order (index 0 = most relevant). */
  items: T[];
  /** Relative trust in this list. Defaults to 1. */
  weight?: number;
}

export interface RrfOptions<T> {
  /** Rank-damping constant. Larger → flatter contribution. Default 60. */
  k?: number;
  /**
   * Identity function used to detect the same item across lists. Defaults to
   * `String(item)`, which is correct when items are id strings.
   */
  idOf?: (item: T) => string;
}

export interface FusedResult<T> {
  id: string;
  item: T;
  score: number;
  /** Per-list 0-based rank, keyed by the list's index. Useful for debugging. */
  ranks: Record<number, number>;
}

const DEFAULT_K = 60;

/**
 * Fuse ranked lists with Reciprocal Rank Fusion. Returns items sorted by fused
 * score descending. The first-seen `item` value is retained when the same id
 * appears in multiple lists.
 */
export function reciprocalRankFusion<T>(
  lists: ReadonlyArray<RankedList<T>>,
  options: RrfOptions<T> = {},
): FusedResult<T>[] {
  const k = options.k ?? DEFAULT_K;
  const idOf = options.idOf ?? ((item: T) => String(item));

  const byId = new Map<string, FusedResult<T>>();

  lists.forEach((list, listIndex) => {
    const weight = list.weight ?? 1;
    list.items.forEach((item, rank) => {
      const id = idOf(item);
      const contribution = weight / (k + rank);
      const existing = byId.get(id);
      if (existing) {
        existing.score += contribution;
        existing.ranks[listIndex] = rank;
      } else {
        byId.set(id, {
          id,
          item,
          score: contribution,
          ranks: { [listIndex]: rank },
        });
      }
    });
  });

  return [...byId.values()].sort((a, b) => b.score - a.score);
}

/**
 * Convenience overload for the common case of fusing lists of bare id strings
 * (e.g. two SQL queries each returning a ranked column of `documentId`s).
 * Returns ids in fused order.
 */
export function fuseIdLists(
  lists: ReadonlyArray<{ ids: string[]; weight?: number }>,
  options: { k?: number } = {},
): { id: string; score: number }[] {
  const fused = reciprocalRankFusion(
    lists.map((l) => ({ items: l.ids, weight: l.weight })),
    { k: options.k },
  );
  return fused.map((f) => ({ id: f.id, score: f.score }));
}
