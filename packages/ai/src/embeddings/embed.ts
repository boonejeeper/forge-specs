import { embedMany as aiEmbedMany } from "ai";

import { EMBED_MODEL_ID, embeddingModel } from "../models";
import { hasApiKey } from "../provider";

/**
 * Thin wrapper around the AI SDK `embedMany`, bound to the OpenRouter `embed`
 * model. Returns one vector per input value, in order.
 *
 * Returns `null` when no API key is configured so callers (the pipeline) can
 * no-op rather than throw during a save when AI is not provisioned.
 */
export interface EmbedManyResult {
  model: string;
  embeddings: number[][];
}

export async function embedTexts(
  values: string[],
): Promise<EmbedManyResult | null> {
  if (values.length === 0) return { model: EMBED_MODEL_ID, embeddings: [] };
  if (!hasApiKey()) return null;

  const { embeddings } = await aiEmbedMany({
    model: embeddingModel(),
    values,
  });

  return { model: EMBED_MODEL_ID, embeddings };
}

/**
 * Embed a single query string, returning its vector or null when AI is
 * unprovisioned (so semantic search/context can fall back gracefully). Lives
 * here (not the package index) so internal callers — context retrieval, chat
 * tools — can import it without a circular dependency through the barrel.
 */
export async function embedQuery(query: string): Promise<number[] | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  const result = await embedTexts([trimmed]);
  return result?.embeddings[0] ?? null;
}
