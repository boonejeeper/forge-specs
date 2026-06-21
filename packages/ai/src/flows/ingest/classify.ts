import path from "node:path";

/**
 * Classify a repo file by path into one of four buckets used by the ingest
 * walker. Path-only — no content sniffing, no MIME lookup. The walker layers
 * size + denylist filters on top of this (the walker is the gatekeeper for
 * `BINARY_SKIPPED`; this only distinguishes the kept kinds).
 */

export type RepoFileKind = "DOC" | "CODE" | "CONFIG" | "BINARY_SKIPPED";

/**
 * Map a doc-shaped repo path to one of the ForgeSpecs DocumentTypes by the
 * verbatim importer. The synthesizer ignores this and lays down its own
 * canonical taxonomy; this is only for the verbatim pass.
 *
 * Heuristics are conservative on purpose — when in doubt, return RFC (the most
 * neutral spec type) rather than mis-tagging an ADR. The user can re-type after
 * the fact in the doc UI.
 */
export type DocTypeGuess =
  | "VISION"
  | "PRD"
  | "RFC"
  | "ADR"
  | "API_SPEC"
  | "DB_SCHEMA"
  | "WORKFLOW"
  | "RUNBOOK"
  | "TASK_PLAN";

const DOC_EXTS = new Set([".md", ".mdx", ".markdown"]);
const NAMELESS_DOC_BASENAMES = new Set([
  "README",
  "readme",
  "CHANGELOG",
  "changelog",
  "NOTICE",
  "notice",
  "CONTRIBUTING",
  "contributing",
  "ARCHITECTURE",
  "architecture",
  "RUNBOOK",
  "runbook",
]);

const CODE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".kt", ".scala",
  ".c", ".h", ".cc", ".cpp", ".hpp", ".cs",
  ".php", ".swift", ".m", ".sh", ".bash", ".zsh",
  ".sql", ".prisma", ".graphql", ".proto",
  ".lua", ".dart", ".ex", ".exs", ".erl", ".clj",
  ".tf", ".hcl",
]);

const CONFIG_EXTS = new Set([
  ".json", ".yaml", ".yml", ".toml", ".ini", ".env",
  ".xml", ".dockerfile",
]);
const CONFIG_BASENAMES = new Set([
  "Dockerfile",
  "Makefile",
  "Procfile",
  ".gitignore",
  ".dockerignore",
  ".editorconfig",
  ".npmrc",
  ".nvmrc",
]);

const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg",
  ".pdf", ".zip", ".tar", ".gz", ".bz2", ".xz", ".7z",
  ".ttf", ".woff", ".woff2", ".eot", ".otf",
  ".mp3", ".mp4", ".mov", ".wav", ".webm",
  ".class", ".jar", ".so", ".dll", ".dylib", ".o", ".a",
  ".wasm", ".bin",
]);

export function classifyFile(repoRelPath: string): RepoFileKind {
  const base = path.basename(repoRelPath);
  const ext = path.extname(repoRelPath).toLowerCase();

  if (DOC_EXTS.has(ext)) return "DOC";
  if (NAMELESS_DOC_BASENAMES.has(base)) return "DOC";

  if (BINARY_EXTS.has(ext)) return "BINARY_SKIPPED";

  if (CONFIG_BASENAMES.has(base)) return "CONFIG";
  if (CONFIG_EXTS.has(ext)) return "CONFIG";

  if (CODE_EXTS.has(ext)) return "CODE";

  // Default unknown extension → CONFIG (kept, but not summarized as code).
  return "CONFIG";
}

const ADR_PATTERN = /(^|\/)docs?\/(adrs?|architecture[-_]decisions?)\//i;
const RFC_PATTERN = /(^|\/)docs?\/rfcs?\//i;
const RUNBOOK_PATTERN = /(^|\/)docs?\/runbooks?\//i;
const WORKFLOW_PATTERN = /(^|\/)docs?\/workflows?\//i;
const PRD_PATTERN = /(^|\/)docs?\/(prds?|product)\//i;
const VISION_PATTERN = /(^|\/)docs?\/visions?\//i;
const OPENAPI_BASENAMES = new Set([
  "openapi.yaml",
  "openapi.yml",
  "openapi.json",
  "swagger.yaml",
  "swagger.yml",
  "swagger.json",
]);

export function guessDocType(repoRelPath: string): DocTypeGuess {
  const lower = repoRelPath.toLowerCase();
  const base = path.basename(lower);

  if (ADR_PATTERN.test(repoRelPath)) return "ADR";
  if (RFC_PATTERN.test(repoRelPath)) return "RFC";
  if (RUNBOOK_PATTERN.test(repoRelPath)) return "RUNBOOK";
  if (WORKFLOW_PATTERN.test(repoRelPath)) return "WORKFLOW";
  if (PRD_PATTERN.test(repoRelPath)) return "PRD";
  if (VISION_PATTERN.test(repoRelPath)) return "VISION";

  if (OPENAPI_BASENAMES.has(base)) return "API_SPEC";
  if (base === "schema.prisma" || lower.endsWith(".prisma")) return "DB_SCHEMA";
  if (lower.includes("/migrations/") && lower.endsWith(".sql")) return "DB_SCHEMA";

  if (base === "readme.md" || base === "readme.mdx") return "VISION";
  if (base === "changelog.md") return "RUNBOOK";
  if (base === "architecture.md") return "RFC";

  return "RFC";
}
