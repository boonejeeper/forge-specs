import {
  createOpenAICompatible,
  type OpenAICompatibleProvider,
} from "@ai-sdk/openai-compatible";

/**
 * OpenRouter provider via the AI SDK's OpenAI-compatible adapter.
 *
 * LAZINESS IS LOad-BEARING: the web app and collab process import this package
 * at build time, when OPENROUTER_API_KEY may be unset. Constructing the provider
 * (or reading the key) eagerly would crash `next build`. So:
 *   - the key is read from process.env on first *use*, not at import;
 *   - the provider instance is memoized after first successful construction;
 *   - `hasApiKey()` lets callers degrade gracefully (e.g. search falls back to
 *     full-text only, the embedding pipeline becomes a no-op) instead of
 *     throwing.
 *
 * We intentionally read process.env directly rather than @forgespecs/config's
 * `env`, because that schema *requires* OPENROUTER_API_KEY and would throw on
 * access — defeating graceful degradation. Validation of the rest of the env
 * still happens through config where it is actually needed.
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

let cached: OpenAICompatibleProvider | undefined;

/** Is an OpenRouter API key configured in this process? */
export function hasApiKey(): boolean {
  const key = process.env.OPENROUTER_API_KEY;
  return typeof key === "string" && key.length > 0;
}

/**
 * Get the lazily-constructed OpenRouter provider. Throws a clear error only when
 * actually invoked without a key — never at import. Callers that want to degrade
 * should gate on `hasApiKey()` first.
 */
export function getProvider(): OpenAICompatibleProvider {
  if (cached) return cached;
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. AI features (embeddings, chat) are " +
        "disabled. Gate on hasApiKey() to degrade gracefully.",
    );
  }
  cached = createOpenAICompatible({
    name: "openrouter",
    baseURL: OPENROUTER_BASE_URL,
    apiKey,
    // OpenRouter recommends these attribution headers; harmless if omitted.
    headers: {
      "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000",
      "X-Title": "ForgeSpecs",
    },
  });
  return cached;
}

/** Test/escape hatch: drop the memoized provider so a new key is picked up. */
export function resetProvider(): void {
  cached = undefined;
}
