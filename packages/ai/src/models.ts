import type { EmbeddingModelV3, LanguageModelV3 } from "@ai-sdk/provider";
import { DEFAULT_EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from "@forgespecs/config";

import { getProvider } from "./provider";

/**
 * Semantic model aliases → concrete OpenRouter model IDs. Flows reference an
 * alias (`embed` / `smart` / `fast`) so no vendor id is hardcoded at a call
 * site — swapping models, or pointing at a local vLLM/Ollama base URL, is a
 * one-line change here.
 *
 *  - `embed` — embeddings, 1536-dim (matches the pgvector column).
 *  - `smart` — the high-capability chat/generation model (RFC/architecture
 *    drafting, refine). Default anthropic/claude-sonnet-4 via OpenRouter.
 *  - `fast`  — the cheap/low-latency model (summaries, classification, tool
 *    routing). Default a small/cheap model.
 *
 * All three are overridable via env (AI_MODEL_SMART / AI_MODEL_FAST /
 * AI_MODEL_EMBED) read lazily at first use, so build never needs them and a
 * self-hoster can repoint at any OpenRouter id (or a local gateway).
 */
const DEFAULTS = {
  embed: "openai/text-embedding-3-small",
  smart: "anthropic/claude-sonnet-4",
  fast: "openai/gpt-4o-mini",
} as const;

export type ModelAlias = keyof typeof DEFAULTS;

/**
 * Resolve the concrete model id for an alias. Reads the per-alias env override
 * lazily (never at import), falling back to the sane default.
 */
export function modelId(alias: ModelAlias): string {
  const envKey = `AI_MODEL_${alias.toUpperCase()}`;
  const override = process.env[envKey];
  return override && override.length > 0 ? override : DEFAULTS[alias];
}

/**
 * Back-compat static map (used by existing call sites + tests). The embed id is
 * always the default's value; smart/fast expose their defaults here but flows
 * should call modelId()/languageModel() so env overrides are honoured.
 */
export const MODEL_IDS = DEFAULTS;

/**
 * Resolve a chat/generation language model handle from the OpenRouter provider.
 * Lazy — only call inside a path that has already confirmed `hasApiKey()`.
 */
export function languageModel(alias: "smart" | "fast" = "smart"): LanguageModelV3 {
  return getProvider().languageModel(modelId(alias));
}

/** The provider-reported model id stored on Embedding.model rows. */
export const EMBED_MODEL_ID = MODEL_IDS.embed;

/** Resolved smart/fast ids (env-overridable) for logging/diagnostics. */
export const SMART_MODEL_ID = (): string => modelId("smart");
export const FAST_MODEL_ID = (): string => modelId("fast");

/** Expected embedding dimensionality (dimension lock-in guard). */
export const EMBED_DIMENSIONS = EMBEDDING_DIMENSIONS;

/** Human-friendly default name (mirrors config). */
export const DEFAULT_EMBEDDING_NAME = DEFAULT_EMBEDDING_MODEL;

/**
 * Resolve the embedding model handle from the OpenRouter provider. Lazy — only
 * call inside a code path that has already confirmed `hasApiKey()`.
 */
export function embeddingModel(): EmbeddingModelV3 {
  return getProvider().textEmbeddingModel(MODEL_IDS.embed);
}
