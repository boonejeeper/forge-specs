/**
 * Pure extractors that pull structured payloads out of a document's BlockNote
 * body so the visual surfaces (OpenAPI explorer, ERD designer) can render them:
 *
 *  - `extractOpenApiSpec`  — finds the OpenAPI yaml/json code block in an
 *                            API_SPEC doc and parses it into a spec object.
 *  - `extractErdSource`    — finds the Mermaid `erDiagram` block (or a DBML code
 *                            block) in a DB_SCHEMA doc and returns its source.
 *
 * These mirror exactly what M7 generation seeds (generate-architecture: DB_SCHEMA
 * → Mermaid erDiagram; API_SPEC → an OpenAPI yaml code block). They are pure and
 * dependency-light (only `yaml`) so they unit-test and run server-side in the
 * data fns. M10 export reuses these to emit a doc's OpenAPI/DBML payload.
 */
import { parse as parseYaml } from "yaml";

/** Loosely-typed BlockNote block — custom blocks carry payload in `props`. */
interface RawBlock {
  type?: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: RawBlock[];
}

/** Depth-first walk over a BlockNote document array. */
function walkBlocks(doc: unknown, visit: (b: RawBlock) => void): void {
  if (!Array.isArray(doc)) return;
  const recurse = (blocks: RawBlock[]) => {
    for (const b of blocks) {
      if (b && typeof b === "object") {
        visit(b);
        if (Array.isArray(b.children)) recurse(b.children);
      }
    }
  };
  recurse(doc as RawBlock[]);
}

function blockCode(b: RawBlock): string | null {
  const code = b.props?.code;
  return typeof code === "string" ? code : null;
}

function blockLanguage(b: RawBlock): string {
  const lang = b.props?.language;
  return typeof lang === "string" ? lang.toLowerCase() : "";
}

// ── OpenAPI ──────────────────────────────────────────────────────────────────

export interface ExtractedOpenApi {
  /** Parsed spec object (whatever the doc carried — typically OpenAPI 3.1). */
  spec: Record<string, unknown>;
  /** The raw source text (yaml or json) for export / round-trip. */
  source: string;
  /** "yaml" | "json" — the detected serialization. */
  format: "yaml" | "json";
}

/** Heuristic: does this parsed object look like an OpenAPI / Swagger spec? */
function looksLikeOpenApi(obj: unknown): obj is Record<string, unknown> {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  return (
    typeof o.openapi === "string" ||
    typeof o.swagger === "string" ||
    (typeof o.info === "object" && o.info !== null && "paths" in o)
  );
}

/**
 * Extract + parse the first OpenAPI spec found in a document's code blocks.
 * Tries yaml first (the M7 seed format), then JSON. Returns null when no block
 * parses into something OpenAPI-shaped.
 */
export function extractOpenApiSpec(doc: unknown): ExtractedOpenApi | null {
  const candidates: { source: string; lang: string }[] = [];
  walkBlocks(doc, (b) => {
    if (b.type !== "code") return;
    const code = blockCode(b);
    if (code && code.trim().length > 0) {
      candidates.push({ source: code, lang: blockLanguage(b) });
    }
  });

  // Prefer yaml/json/openapi-tagged blocks, but fall back to any code block.
  candidates.sort((a, b) => rank(b.lang) - rank(a.lang));

  for (const c of candidates) {
    const parsed = tryParse(c.source);
    if (parsed && looksLikeOpenApi(parsed.value)) {
      return { spec: parsed.value, source: c.source, format: parsed.format };
    }
  }
  return null;
}

function rank(lang: string): number {
  if (lang.includes("openapi") || lang === "yaml" || lang === "yml") return 3;
  if (lang === "json") return 2;
  return 0;
}

function tryParse(
  source: string,
): { value: Record<string, unknown>; format: "yaml" | "json" } | null {
  const trimmed = source.trim();
  // JSON first if it clearly looks like JSON.
  if (trimmed.startsWith("{")) {
    try {
      const v = JSON.parse(trimmed);
      if (v && typeof v === "object") return { value: v, format: "json" };
    } catch {
      /* fall through to yaml */
    }
  }
  try {
    const v = parseYaml(trimmed);
    if (v && typeof v === "object") {
      return { value: v as Record<string, unknown>, format: "yaml" };
    }
  } catch {
    /* not yaml */
  }
  return null;
}

// ── ERD source (Mermaid erDiagram or DBML) ─────────────────────────────────────

export type ErdSourceFormat = "mermaid" | "dbml";

export interface ExtractedErd {
  source: string;
  format: ErdSourceFormat;
}

/**
 * Extract the ERD source from a DB_SCHEMA document. Prefers a DBML code block
 * (the editable serialization format), then a Mermaid `erDiagram` block (what
 * M7 seeds). Returns null when neither is present.
 */
export function extractErdSource(doc: unknown): ExtractedErd | null {
  let dbml: string | null = null;
  let mermaid: string | null = null;

  walkBlocks(doc, (b) => {
    if (b.type === "code") {
      const code = blockCode(b);
      if (code && blockLanguage(b) === "dbml" && dbml === null) {
        dbml = code;
      }
    }
    if (b.type === "mermaid") {
      const code = blockCode(b);
      if (code && /\berDiagram\b/.test(code) && mermaid === null) {
        mermaid = code;
      }
    }
  });

  if (dbml !== null) return { source: dbml, format: "dbml" };
  if (mermaid !== null) return { source: mermaid, format: "mermaid" };
  return null;
}
