/**
 * Pure assembly of an export *bundle*: a seed document plus its dependency
 * closure, serialized to a single Markdown / JSON / YAML artifact — exactly what
 * an autonomous coding agent consumes for a unit of work.
 *
 * The route/data layer is responsible for the impure parts (RBAC, loading rows,
 * computing the closure via the crossref recursive CTE, running the M9
 * OpenAPI/DBML extractors). It hands this module the already-resolved
 * `ExportDocument`s in closure order; everything here is pure + testable.
 */
import { stringify as stringifyYaml } from "yaml";

import {
  type ExportDocument,
  type DocumentExport,
  toDocumentExport,
  documentToMarkdown,
} from "./serialize";

export type ExportFormat = "markdown" | "json" | "yaml";

/** Metadata about a bundle (who/what it is for). */
export interface BundleMeta {
  /** Human label for the bundle (e.g. agent name, or seed doc title). */
  title: string;
  /** Optional longer description (e.g. "Assigned work for agent: backend"). */
  description?: string;
  /** ISO timestamp the bundle was generated. */
  generatedAt: string;
}

/** The structured bundle envelope (shared by JSON + YAML). */
export interface BundleExport {
  meta: BundleMeta;
  /** Ordered: roots/seeds first, then their dependency closure. */
  documents: DocumentExport[];
}

/** Assemble the structured envelope from ordered ExportDocuments. */
export function toBundleExport(
  meta: BundleMeta,
  docs: ExportDocument[],
): BundleExport {
  return {
    meta,
    documents: docs.map(toDocumentExport),
  };
}

/** Serialize a bundle to a single Markdown document (docs separated by rules). */
export function bundleToMarkdown(meta: BundleMeta, docs: ExportDocument[]): string {
  const parts: string[] = [];
  parts.push(`# ${meta.title}`);
  parts.push("");
  if (meta.description) {
    parts.push(meta.description);
    parts.push("");
  }
  parts.push(`_Generated ${meta.generatedAt} — ${docs.length} document${docs.length === 1 ? "" : "s"}._`);
  parts.push("");

  // Table of contents.
  if (docs.length > 1) {
    parts.push("## Contents");
    parts.push("");
    for (const d of docs) {
      parts.push(`- ${d.title} (${d.type})`);
    }
    parts.push("");
  }

  for (const doc of docs) {
    parts.push("---");
    parts.push("");
    parts.push(documentToMarkdown(doc).trimEnd());
    parts.push("");
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Serialize a bundle to JSON. */
export function bundleToJson(meta: BundleMeta, docs: ExportDocument[]): string {
  return JSON.stringify(toBundleExport(meta, docs), null, 2) + "\n";
}

/** Serialize a bundle to YAML. */
export function bundleToYaml(meta: BundleMeta, docs: ExportDocument[]): string {
  return stringifyYaml(toBundleExport(meta, docs));
}

/** One-call dispatch over the three formats. */
export function serializeBundle(
  format: ExportFormat,
  meta: BundleMeta,
  docs: ExportDocument[],
): { body: string; contentType: string; extension: string } {
  switch (format) {
    case "json":
      return {
        body: bundleToJson(meta, docs),
        contentType: "application/json; charset=utf-8",
        extension: "json",
      };
    case "yaml":
      return {
        body: bundleToYaml(meta, docs),
        contentType: "application/yaml; charset=utf-8",
        extension: "yaml",
      };
    case "markdown":
    default:
      return {
        body: bundleToMarkdown(meta, docs),
        contentType: "text/markdown; charset=utf-8",
        extension: "md",
      };
  }
}

/** Dispatch single-document serialization across the three formats. */
export function serializeDocument(
  format: ExportFormat,
  doc: ExportDocument,
): { body: string; contentType: string; extension: string } {
  // A single document is just a one-element bundle for JSON/YAML, but its
  // Markdown form is the standalone document (no bundle wrapper/TOC).
  switch (format) {
    case "json":
      return {
        body: JSON.stringify(toDocumentExport(doc), null, 2) + "\n",
        contentType: "application/json; charset=utf-8",
        extension: "json",
      };
    case "yaml":
      return {
        body: stringifyYaml(toDocumentExport(doc)),
        contentType: "application/yaml; charset=utf-8",
        extension: "yaml",
      };
    case "markdown":
    default:
      return {
        body: documentToMarkdown(doc),
        contentType: "text/markdown; charset=utf-8",
        extension: "md",
      };
  }
}

// ── content negotiation ──────────────────────────────────────────────────────

/**
 * Resolve the requested export format from a `?format=` query value and/or an
 * `Accept` header. Explicit `?format=` wins; otherwise the Accept header is
 * matched against known media types; default is Markdown.
 */
export function resolveFormat(opts: {
  formatParam?: string | null;
  accept?: string | null;
}): ExportFormat {
  const param = opts.formatParam?.trim().toLowerCase();
  if (param === "md" || param === "markdown") return "markdown";
  if (param === "json") return "json";
  if (param === "yaml" || param === "yml") return "yaml";

  const accept = (opts.accept ?? "").toLowerCase();
  if (accept.includes("application/json")) return "json";
  if (accept.includes("yaml") || accept.includes("application/x-yaml")) return "yaml";
  if (accept.includes("text/markdown") || accept.includes("text/plain")) return "markdown";

  return "markdown";
}
