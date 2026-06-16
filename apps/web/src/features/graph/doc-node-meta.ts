import type { GraphDocType, GraphEdgeKind } from "@forgespecs/core/graph";

/**
 * Presentation metadata for graph node cards (per DocType) and edges (per
 * DependencyKind). Pure data — shared by the React Flow dependency graph and the
 * Sigma knowledge graph so both colorings stay in sync. Tailwind-class +
 * raw-hex variants are provided because Sigma's WebGL renderer needs hex, while
 * React Flow cards use classes.
 */

export interface DocTypeStyle {
  label: string;
  /** Short badge text on the node card. */
  abbr: string;
  /** Hex accent for Sigma + the React Flow card left border. */
  color: string;
}

export const DOC_TYPE_STYLE: Record<GraphDocType, DocTypeStyle> = {
  VISION: { label: "Vision", abbr: "VIS", color: "#8b5cf6" },
  PRD: { label: "PRD", abbr: "PRD", color: "#6366f1" },
  RFC: { label: "RFC", abbr: "RFC", color: "#3b82f6" },
  ADR: { label: "ADR", abbr: "ADR", color: "#06b6d4" },
  API_SPEC: { label: "API Spec", abbr: "API", color: "#10b981" },
  DB_SCHEMA: { label: "Schema", abbr: "DB", color: "#f59e0b" },
  WORKFLOW: { label: "Workflow", abbr: "WF", color: "#ec4899" },
  RUNBOOK: { label: "Runbook", abbr: "RUN", color: "#f43f5e" },
  TASK_PLAN: { label: "Plan", abbr: "PLN", color: "#64748b" },
};

export function docTypeStyle(type: GraphDocType): DocTypeStyle {
  return DOC_TYPE_STYLE[type] ?? { label: type, abbr: "?", color: "#64748b" };
}

export interface EdgeKindStyle {
  label: string;
  color: string;
  /** Render as a dashed line (weaker relationships). */
  dashed: boolean;
}

export const EDGE_KIND_STYLE: Record<GraphEdgeKind, EdgeKindStyle> = {
  IMPLEMENTS: { label: "implements", color: "#10b981", dashed: false },
  REFERENCES: { label: "references", color: "#94a3b8", dashed: true },
  DERIVES_FROM: { label: "derives from", color: "#6366f1", dashed: false },
  SUPERSEDES: { label: "supersedes", color: "#f43f5e", dashed: false },
  BLOCKS: { label: "blocks", color: "#f59e0b", dashed: false },
};

export function edgeKindStyle(kind: GraphEdgeKind): EdgeKindStyle {
  return EDGE_KIND_STYLE[kind] ?? { label: kind, color: "#94a3b8", dashed: true };
}
