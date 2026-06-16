/**
 * Shared, environment-independent constants used across packages and apps.
 */

/** Embedding model dimension lock-in — matches text-embedding-3-small. */
export const EMBEDDING_DIMENSIONS = 1536 as const;

/** Default embedding model alias (resolved by packages/ai in M6). */
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small" as const;

/** Yjs collab room naming — room name is always the documentId. */
export const collabRoomForDocument = (documentId: string): string =>
  documentId;

/** Compaction thresholds for the collab persistence loop (M4). */
export const COLLAB_COMPACTION_IDLE_MS = 10_000 as const;
export const COLLAB_COMPACTION_UPDATE_COUNT = 200 as const;

/** Cookie name prefix used by Better Auth. */
export const AUTH_COOKIE_PREFIX = "forgespecs" as const;

/**
 * Sentinel tokens wrapping highlighted terms in full-text search snippets
 * (ts_headline StartSel/StopSel). NOT HTML — ts_headline does not escape the
 * underlying document text, so emitting HTML there would be an XSS sink. The UI
 * splits plain-text snippets on these markers to render <mark> safely. Lives in
 * config (no node deps) so client components can import it without pulling the
 * server-only search module (which uses node:crypto) into the browser bundle.
 */
export const SEARCH_HL_START = "" as const;
export const SEARCH_HL_END = "" as const;
