/**
 * Context assembly — the AI differentiator.
 *
 * Given a target document (and optionally a focused section/selection), gather
 * the most relevant material from the spec graph and pack it under a token
 * budget for a chat / generation prompt. The tiers, IN PRIORITY ORDER, are:
 *
 *   1. CURRENT — the target document (or the focused section): always included
 *      first; this is what the user is looking at.
 *   2. DEPENDENCIES — dependency-graph neighbours 1–2 hops out. Deterministic,
 *      high-signal, and ALWAYS placed before semantic recall (the plan's rule:
 *      the graph is the trustworthy backbone; vectors add recall).
 *   3. SEMANTIC — pgvector chunks fused across the corpus (recall — catches
 *      relevant material the graph doesn't link).
 *   4. COMMENTS — recent comment threads on the target (human signal / open
 *      questions the model should be aware of).
 *
 * This module is PURE and dependency-light: retrieval is injected (so it is
 * unit-testable with mocks and reused across the chat route, refine, and M7
 * generation), and the token estimator is injected too (defaults to the core
 * ~4-chars/token heuristic). Packing dedupes by source id, reserves output
 * tokens, and never partially-includes a current-doc item (truncation is
 * applied per-item content, see `packItems`).
 */

import { estimateTokens as defaultEstimateTokens } from "@forgespecs/core/search";

/** A unit of context retrieved from one of the tiers. */
export interface ContextItem {
  /** Stable dedupe key (documentId, `${docId}:${chunkIndex}`, commentId, …). */
  id: string;
  tier: ContextTier;
  /** Human/LLM-readable heading for the block ("RFC: Auth — depends-on"). */
  title: string;
  /** The body text included in the prompt. */
  content: string;
  /** Originating document, when applicable (drives dedupe across tiers). */
  documentId?: string;
  /** Tier-relative rank (0 = most relevant); preserves retrieval ordering. */
  rank: number;
}

export type ContextTier = "current" | "dependency" | "semantic" | "comment";

/** Tier priority — lower number packs first. Mirrors the plan's ordering. */
const TIER_PRIORITY: Record<ContextTier, number> = {
  current: 0,
  dependency: 1,
  semantic: 2,
  comment: 3,
};

/** Retrieval functions injected by the route adapter (or a test mock). */
export interface ContextRetrievers {
  /** Tier 1: the target doc / focused section as one or more items. */
  current: () => Promise<ContextItem[]>;
  /** Tier 2: dependency-graph neighbours (1–2 hops), deterministic. */
  dependencies: () => Promise<ContextItem[]>;
  /** Tier 3: semantic chunks (pgvector), already fused/ranked. */
  semantic: () => Promise<ContextItem[]>;
  /** Tier 4: recent comments on the target. */
  comments: () => Promise<ContextItem[]>;
}

export interface AssembleOptions {
  /** Total token budget for the assembled context (prompt window minus output). */
  budgetTokens: number;
  /** Tokens reserved for the model's output (subtracted from the budget). */
  reserveOutputTokens?: number;
  /** Per-item hard cap so one giant doc can't eat the whole budget. */
  maxTokensPerItem?: number;
  /** Token estimator (injectable for tests / exact tokenizers). */
  estimateTokens?: (text: string) => number;
}

export interface AssembledContext {
  /** Items that fit, in pack order (tier priority, then tier rank). */
  items: ContextItem[];
  /** Items that were dropped for budget (diagnostics / "context trimmed" UI). */
  dropped: ContextItem[];
  /** Total tokens of the included items. */
  usedTokens: number;
  /** The effective budget after reserving output tokens. */
  budgetTokens: number;
}

const DEFAULT_RESERVE = 1024;
const DEFAULT_MAX_PER_ITEM = 2048;

/**
 * Order items deterministically: tier priority first (current → dependency →
 * semantic → comment), then the tier-relative rank. Stable for a given input.
 */
export function orderItems(items: ContextItem[]): ContextItem[] {
  return [...items].sort((a, b) => {
    const tp = TIER_PRIORITY[a.tier] - TIER_PRIORITY[b.tier];
    if (tp !== 0) return tp;
    return a.rank - b.rank;
  });
}

/**
 * Dedupe items by id, keeping the FIRST (highest-priority) occurrence. Also
 * collapses cross-tier duplicates of the same document: once a document appears
 * in `current` or `dependency`, its `semantic` chunks for the SAME document are
 * still allowed (different granularity), but exact id collisions are removed.
 * The caller is responsible for choosing ids that make the right things collide.
 */
export function dedupeItems(items: ContextItem[]): ContextItem[] {
  const seen = new Set<string>();
  const out: ContextItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * Pack ordered, deduped items into the budget. Each item's content is truncated
 * to `maxTokensPerItem` (so no single item dominates); items that don't fit the
 * remaining budget are dropped (and recorded). Greedy by pack order — because
 * order is tier-priority-first, current + dependencies win the budget before
 * semantic/comments, which is exactly the plan's intent.
 */
export function packItems(
  items: ContextItem[],
  opts: {
    budgetTokens: number;
    maxTokensPerItem: number;
    estimateTokens: (text: string) => number;
  },
): { included: ContextItem[]; dropped: ContextItem[]; usedTokens: number } {
  const included: ContextItem[] = [];
  const dropped: ContextItem[] = [];
  let used = 0;

  for (const item of items) {
    const capped = truncateToTokens(
      item.content,
      opts.maxTokensPerItem,
      opts.estimateTokens,
    );
    const cost = opts.estimateTokens(capped) + opts.estimateTokens(item.title) + 4;
    if (used + cost > opts.budgetTokens) {
      dropped.push(item);
      continue;
    }
    used += cost;
    included.push(capped === item.content ? item : { ...item, content: capped });
  }

  return { included, dropped, usedTokens: used };
}

/**
 * Truncate text to approximately `maxTokens` using the injected estimator. Cuts
 * on a character budget derived from the estimator's average and appends an
 * ellipsis marker so the model knows the item was clipped.
 */
export function truncateToTokens(
  text: string,
  maxTokens: number,
  estimateTokens: (text: string) => number,
): string {
  if (estimateTokens(text) <= maxTokens) return text;
  // Binary-search the longest prefix under budget (estimator is monotonic in
  // length). Cheap and exact for the linear ~chars/token heuristic.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateTokens(text.slice(0, mid)) <= maxTokens) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo).trimEnd()}\n…[truncated]`;
}

/**
 * Assemble context: run the injected retrievers (current + dependencies always;
 * semantic + comments concurrently), order by tier priority, dedupe, and pack
 * to the effective budget. Pure orchestration — all I/O is in the retrievers.
 */
export async function assembleContext(
  retrievers: ContextRetrievers,
  options: AssembleOptions,
): Promise<AssembledContext> {
  const estimate = options.estimateTokens ?? defaultEstimateTokens;
  const reserve = options.reserveOutputTokens ?? DEFAULT_RESERVE;
  const maxPerItem = options.maxTokensPerItem ?? DEFAULT_MAX_PER_ITEM;
  const budget = Math.max(0, options.budgetTokens - reserve);

  const [current, dependencies, semantic, comments] = await Promise.all([
    retrievers.current(),
    retrievers.dependencies(),
    retrievers.semantic(),
    retrievers.comments(),
  ]);

  const ordered = orderItems(
    dedupeItems([...current, ...dependencies, ...semantic, ...comments]),
  );

  const { included, dropped, usedTokens } = packItems(ordered, {
    budgetTokens: budget,
    maxTokensPerItem: maxPerItem,
    estimateTokens: estimate,
  });

  return { items: included, dropped, usedTokens, budgetTokens: budget };
}

/**
 * Render assembled items into a single system-prompt context block. Grouped by
 * tier with clear headers so the model can weigh deterministic graph context
 * above semantic recall. Pure — no token logic here (already packed).
 */
export function renderContext(assembled: AssembledContext): string {
  if (assembled.items.length === 0) return "";
  const byTier: Record<ContextTier, ContextItem[]> = {
    current: [],
    dependency: [],
    semantic: [],
    comment: [],
  };
  for (const item of assembled.items) byTier[item.tier].push(item);

  const sections: string[] = [];
  const labels: Record<ContextTier, string> = {
    current: "## Current document",
    dependency: "## Linked dependencies (graph)",
    semantic: "## Related material (semantic search)",
    comment: "## Recent comments",
  };
  for (const tier of ["current", "dependency", "semantic", "comment"] as const) {
    const items = byTier[tier];
    if (items.length === 0) continue;
    const body = items
      .map((i) => `### ${i.title}\n${i.content}`)
      .join("\n\n");
    sections.push(`${labels[tier]}\n${body}`);
  }
  return sections.join("\n\n");
}
