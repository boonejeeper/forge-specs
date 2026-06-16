import { DocumentType } from "@forgespecs/db";

/**
 * Presentation metadata for document types. The spec repository tree groups
 * documents by `DocumentType`; this is the single source of truth for the
 * group order and human labels so the tree, create dialog, and seed all agree.
 */
export interface DocTypeMeta {
  type: DocumentType;
  /** Plural section heading used in the tree. */
  label: string;
  /** Singular noun for the create dialog. */
  singular: string;
}

/** Ordered for display — Vision first, Tasks last (idea → execution). */
export const DOC_TYPE_ORDER: readonly DocTypeMeta[] = [
  { type: DocumentType.VISION, label: "Vision", singular: "Vision" },
  { type: DocumentType.PRD, label: "PRDs", singular: "PRD" },
  { type: DocumentType.RFC, label: "RFCs", singular: "RFC" },
  { type: DocumentType.ADR, label: "ADRs", singular: "ADR" },
  { type: DocumentType.DB_SCHEMA, label: "Schemas", singular: "Schema" },
  { type: DocumentType.API_SPEC, label: "APIs", singular: "API spec" },
  { type: DocumentType.WORKFLOW, label: "Workflows", singular: "Workflow" },
  { type: DocumentType.RUNBOOK, label: "Runbooks", singular: "Runbook" },
  { type: DocumentType.TASK_PLAN, label: "Implementation Plans", singular: "Implementation Plan" },
];

const META_BY_TYPE = new Map<DocumentType, DocTypeMeta>(
  DOC_TYPE_ORDER.map((m) => [m.type, m]),
);

export function docTypeMeta(type: DocumentType): DocTypeMeta {
  return (
    META_BY_TYPE.get(type) ?? { type, label: type, singular: type }
  );
}

export function docTypeLabel(type: DocumentType): string {
  return docTypeMeta(type).label;
}
