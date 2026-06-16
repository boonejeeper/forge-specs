import { createHash } from "node:crypto";

/**
 * Block-aligned semantic chunking of a document's flattened text.
 *
 * Goals:
 *  - Produce chunks of roughly TARGET tokens with OVERLAP-token tails so a
 *    passage that straddles a boundary is retrievable from either chunk.
 *  - Respect block boundaries where possible (chunks pack whole blocks until the
 *    budget is hit) so embeddings line up with editor structure and the
 *    `Embedding.blockId` back-reference is meaningful.
 *  - Be pure and deterministic: a given input yields identical chunks + hashes,
 *    which the embedding pipeline relies on for hash-dedupe / incremental
 *    re-embed (only changed chunks get re-embedded).
 *
 * Token counting is approximate — we do NOT pull a tokenizer into the core
 * package (it must stay process-agnostic and dependency-light). The estimator
 * (~4 chars/token, the well-known OpenAI heuristic) is good enough for sizing
 * chunks; the embedding model itself is the only place exact tokenization
 * matters and it tolerates slightly-off chunk sizes.
 */

/** Average characters per token (OpenAI BPE heuristic). */
const CHARS_PER_TOKEN = 4;

/** Default target chunk size in tokens (~512) and overlap (~64). */
export const DEFAULT_CHUNK_TOKENS = 512;
export const DEFAULT_CHUNK_OVERLAP_TOKENS = 64;

export interface ChunkOptions {
  /** Target chunk size in tokens. Default 512. */
  targetTokens?: number;
  /** Overlap between consecutive chunks in tokens. Default 64. */
  overlapTokens?: number;
}

/** A block of source text with a stable id (e.g. the editor Block.id). */
export interface SourceBlock {
  /** Stable id of the originating block; carried onto chunks for back-ref. */
  id: string;
  /** The block's visible plaintext. */
  text: string;
}

export interface Chunk {
  index: number;
  content: string;
  /**
   * Stable SHA-256 of the normalized chunk content. Used for dedupe / deciding
   * which chunks changed since the last embed run.
   */
  hash: string;
  /**
   * Ids of the source blocks that contributed to this chunk. The first id is
   * recorded as the chunk's primary `blockId` by the embedding pipeline.
   */
  blockIds: string[];
}

/** Approximate token count of a string. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** SHA-256 hex digest of normalized content (stable across runs). */
export function hashChunk(content: string): string {
  return createHash("sha256")
    .update(content.normalize("NFC"))
    .digest("hex");
}

function approxCharBudget(tokens: number): number {
  return Math.max(1, tokens * CHARS_PER_TOKEN);
}

/**
 * Split a single oversized block of text into ~target-token windows with
 * overlap, breaking on whitespace where possible so words are not severed.
 */
function windowText(
  text: string,
  targetChars: number,
  overlapChars: number,
): string[] {
  if (text.length <= targetChars) return text.length ? [text] : [];
  const windows: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + targetChars, text.length);
    if (end < text.length) {
      // Prefer to break on the last whitespace within the window.
      const slice = text.slice(start, end);
      const lastSpace = slice.lastIndexOf(" ");
      if (lastSpace > targetChars * 0.5) {
        end = start + lastSpace;
      }
    }
    const piece = text.slice(start, end).trim();
    if (piece) windows.push(piece);
    if (end >= text.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }
  return windows;
}

/**
 * Chunk a list of block-aligned source texts. Whole blocks are packed greedily
 * until the target budget is reached; a single block larger than the budget is
 * windowed internally. Consecutive chunks carry an overlap tail (in tokens) for
 * boundary recall.
 *
 * Empty / whitespace-only blocks are skipped. Returns [] for empty input.
 */
export function chunkBlocks(
  blocks: ReadonlyArray<SourceBlock>,
  options: ChunkOptions = {},
): Chunk[] {
  const targetTokens = options.targetTokens ?? DEFAULT_CHUNK_TOKENS;
  const overlapTokens = options.overlapTokens ?? DEFAULT_CHUNK_OVERLAP_TOKENS;
  const targetChars = approxCharBudget(targetTokens);
  const overlapChars = approxCharBudget(overlapTokens);

  const chunks: Chunk[] = [];
  let buffer = "";
  let bufferBlockIds: string[] = [];

  const emit = (): void => {
    const content = buffer.trim();
    if (content) {
      chunks.push({
        index: chunks.length,
        content,
        hash: hashChunk(content),
        blockIds: [...new Set(bufferBlockIds)],
      });
    }
    buffer = "";
    bufferBlockIds = [];
  };

  for (const block of blocks) {
    const text = block.text.trim();
    if (!text) continue;

    // A block that alone exceeds the budget is windowed; each window becomes its
    // own chunk attributed to that block. Flush any pending buffer first.
    if (estimateTokens(text) > targetTokens) {
      if (buffer) emit();
      const windows = windowText(text, targetChars, overlapChars);
      for (const w of windows) {
        chunks.push({
          index: chunks.length,
          content: w,
          hash: hashChunk(w),
          blockIds: [block.id],
        });
      }
      continue;
    }

    const candidate = buffer ? `${buffer}\n${text}` : text;
    if (estimateTokens(candidate) > targetTokens && buffer) {
      // Buffer is full — emit it, then seed the next buffer with an overlap tail
      // taken from the end of the emitted content for boundary recall.
      const tail = buffer.slice(Math.max(0, buffer.length - overlapChars));
      emit();
      buffer = tail ? `${tail}\n${text}` : text;
      bufferBlockIds = [block.id];
    } else {
      buffer = candidate;
      bufferBlockIds.push(block.id);
    }
  }

  if (buffer) emit();
  return chunks;
}

/**
 * Chunk a single flat string (no block structure) — used when only the
 * document's `contentText` is available. The whole string is treated as one
 * synthetic block so the same windowing/overlap logic applies.
 */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  return chunkBlocks([{ id: "doc", text }], options);
}
