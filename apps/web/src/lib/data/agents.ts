import "server-only";

import { prisma, DocumentType } from "@forgespecs/db";
import { readableDocumentIds } from "@forgespecs/core/search";
import { extractAcceptanceCriteria } from "@forgespecs/core/export";

import { currentUserId } from "@/lib/data/workspaces";

/**
 * Agent portal data (M10).
 *
 * Agents are identified by `agentName` on `isAgent` Mention rows (the same rows
 * the M7 @agent-trigger consumes). An agent's "assigned work" = the documents
 * that mention it. We derive everything from those rows — no new persistence —
 * and RBAC-scope every query through the reader's allow-list.
 */

export interface AgentSummary {
  /** The agentName (stable identifier + label). */
  name: string;
  /** Distinct documents that mention this agent (and are readable). */
  assignedCount: number;
}

/** List the agents mentioned across a workspace's readable documents. */
export async function listAgentsForWorkspace(
  workspaceId: string,
): Promise<AgentSummary[]> {
  const userId = await currentUserId();
  if (!userId) return [];

  const allowed = new Set(await readableDocumentIds(prisma, { userId, workspaceId }));
  if (allowed.size === 0) return [];

  const mentions = await prisma.mention.findMany({
    where: { isAgent: true, documentId: { in: [...allowed] }, agentName: { not: null } },
    select: { agentName: true, documentId: true },
  });

  const docsByAgent = new Map<string, Set<string>>();
  for (const m of mentions) {
    const name = m.agentName!;
    if (!docsByAgent.has(name)) docsByAgent.set(name, new Set());
    docsByAgent.get(name)!.add(m.documentId);
  }

  return [...docsByAgent.entries()]
    .map(([name, docs]) => ({ name, assignedCount: docs.size }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AgentDocRef {
  id: string;
  title: string;
  slug: string;
  type: DocumentType;
  status: string;
  projectSlug: string;
}

export interface AgentAcceptanceGroup {
  documentId: string;
  documentTitle: string;
  criteria: string[];
}

export interface AgentView {
  name: string;
  /** Docs that directly mention the agent, grouped by type. */
  assigned: AgentDocRef[];
  rfcs: AgentDocRef[];
  apis: AgentDocRef[];
  schemas: AgentDocRef[];
  /** Acceptance criteria across the assigned docs + their dependency closure. */
  acceptance: AgentAcceptanceGroup[];
  /** All readable document ids in the agent's assigned set (for the export bundle). */
  assignedDocumentIds: string[];
}

/**
 * Build the full agent view for the portal: assigned docs, the related RFCs /
 * APIs / schemas pulled from the assigned set + their dependency closure, and
 * the acceptance criteria across all of them.
 */
export async function getAgentView(
  workspaceId: string,
  agentName: string,
): Promise<AgentView | null> {
  const userId = await currentUserId();
  if (!userId) return null;

  const allowed = new Set(await readableDocumentIds(prisma, { userId, workspaceId }));
  if (allowed.size === 0) return null;

  // Documents that directly mention the agent.
  const mentions = await prisma.mention.findMany({
    where: { isAgent: true, agentName, documentId: { in: [...allowed] } },
    select: { documentId: true },
  });
  const assignedIds = [...new Set(mentions.map((m) => m.documentId))];
  if (assignedIds.length === 0) {
    // Agent name not found in this workspace's readable docs.
    return null;
  }

  // Pull the assigned docs + the union of their outgoing dependency closure so
  // related RFCs/APIs/schemas + acceptance criteria are surfaced even when the
  // agent is mentioned only on a top-level RFC/PRD.
  const { dependencyClosure, reachableDocIds } = await import("@forgespecs/core/search");
  const closureIds = new Set<string>();
  await Promise.all(
    assignedIds.map(async (id) => {
      const edges = await dependencyClosure(prisma, { documentId: id, direction: "outgoing" });
      for (const cid of reachableDocIds(edges, "outgoing")) {
        if (allowed.has(cid)) closureIds.add(cid);
      }
    }),
  );

  const allIds = [...new Set([...assignedIds, ...closureIds])];

  const rows = await prisma.document.findMany({
    where: { id: { in: allIds } },
    select: {
      id: true,
      title: true,
      slug: true,
      type: true,
      status: true,
      contentJSON: true,
      project: { select: { slug: true } },
    },
  });

  const toRef = (r: (typeof rows)[number]): AgentDocRef => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    type: r.type,
    status: r.status,
    projectSlug: r.project.slug,
  });

  const assignedSet = new Set(assignedIds);
  const assigned = rows.filter((r) => assignedSet.has(r.id)).map(toRef);
  const rfcs = rows.filter((r) => r.type === DocumentType.RFC).map(toRef);
  const apis = rows.filter((r) => r.type === DocumentType.API_SPEC).map(toRef);
  const schemas = rows.filter((r) => r.type === DocumentType.DB_SCHEMA).map(toRef);

  const acceptance: AgentAcceptanceGroup[] = [];
  for (const r of rows) {
    const criteria = extractAcceptanceCriteria(r.contentJSON);
    if (criteria.length > 0) {
      acceptance.push({ documentId: r.id, documentTitle: r.title, criteria });
    }
  }

  return {
    name: agentName,
    assigned: sortRefs(assigned),
    rfcs: sortRefs(rfcs),
    apis: sortRefs(apis),
    schemas: sortRefs(schemas),
    acceptance,
    // The bundle is the assigned docs (closure is expanded inside the export).
    assignedDocumentIds: assignedIds,
  };
}

function sortRefs(refs: AgentDocRef[]): AgentDocRef[] {
  return [...refs].sort((a, b) => a.title.localeCompare(b.title));
}
