export {
  getProvider,
  hasApiKey,
  resetProvider,
} from "./provider";
export {
  MODEL_IDS,
  EMBED_MODEL_ID,
  EMBED_DIMENSIONS,
  DEFAULT_EMBEDDING_NAME,
  SMART_MODEL_ID,
  FAST_MODEL_ID,
  embeddingModel,
  languageModel,
  modelId,
  type ModelAlias,
} from "./models";
export * from "./embeddings/index";
export * from "./context/index";
export * from "./flows/index";

/** Single embed query helper for the search route (re-exported from embed). */
export { embedQuery } from "./embeddings/embed";
