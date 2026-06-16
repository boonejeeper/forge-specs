"use server";

import { revalidatePath } from "next/cache";
import {
  prisma,
  ActivityType,
  type DocumentType,
  type Prisma,
} from "@forgespecs/db";
import {
  withPermission,
  slugify,
  uniqueSlug,
  logActivity,
  blocknoteToPlainText,
  projectBlocks,
  type Scope,
} from "@forgespecs/core";
import {
  getTemplateDefinition,
  templateDocBody,
} from "@forgespecs/core/templates";

import "@/lib/auth/rbac"; // installs the RBAC provider on import

/**
 * Apply a built-in template to a project: create its seed Documents (with bodies,
 * promptHints in frontmatter, derived contentText + projected Block tree) and
 * wire up the Dependency edges between them.
 *
 * RBAC: `doc.create` at the project scope (the single chokepoint via
 * withPermission). Idempotent-ish: each seed doc's slug is uniquified against
 * existing project docs, and edges are created with the (from,to,kind) unique
 * constraint, so a partial/re-run never duplicates the graph it already built.
 */

export interface ApplyTemplateResult {
  templateId: string;
  /** Created documents (one per template doc). */
  documents: { id: string; slug: string; title: string; type: DocumentType }[];
  /** Number of dependency edges created. */
  edgesCreated: number;
}

const projectScope = (workspaceId: string, projectId: string): Scope => ({
  kind: "project",
  workspaceId,
  projectId,
});

const _applyTemplate = withPermission(
  (input: { workspaceId: string; projectId: string; templateId: string }) =>
    projectScope(input.workspaceId, input.projectId),
  "doc.create",
  async (actor, input): Promise<ApplyTemplateResult> => {
    const def = getTemplateDefinition(input.templateId);
    if (!def) throw new Error(`Unknown template "${input.templateId}".`);

    // Reserve unique slugs up front (against existing project docs + each other).
    const existing = await prisma.document.findMany({
      where: { projectId: input.projectId },
      select: { slug: true },
    });
    const takenSlugs = existing.map((d) => d.slug);

    const created = await prisma.$transaction(async (tx) => {
      // key → created document id, so edges can be wired after all docs exist.
      const idByKey = new Map<string, string>();
      const docs: ApplyTemplateResult["documents"] = [];

      let order = 0;
      for (const tdoc of def.docs) {
        const slug = uniqueSlug(slugify(tdoc.title), takenSlugs);
        takenSlugs.push(slug);

        const body = templateDocBody(tdoc);
        const contentText = blocknoteToPlainText(body);
        const rows = projectBlocks(body);

        const doc = await tx.document.create({
          data: {
            projectId: input.projectId,
            authorId: actor.userId,
            type: tdoc.type,
            title: tdoc.title,
            slug,
            contentJSON: body as Prisma.InputJsonValue,
            contentText,
            frontmatter: {
              order: order++,
              promptHints: tdoc.promptHints,
              fromTemplate: def.id,
            } as Prisma.InputJsonValue,
          },
          select: { id: true, slug: true, title: true, type: true },
        });
        idByKey.set(tdoc.key, doc.id);
        docs.push(doc);

        if (rows.length > 0) {
          await tx.block.createMany({
            data: rows.map((r) => ({
              id: r.id,
              documentId: doc.id,
              parentId: r.parentId,
              order: r.order,
              type: r.type,
              json: r.json as Prisma.InputJsonValue,
              text: r.text,
            })),
          });
        }

        await logActivity(
          {
            workspaceId: input.workspaceId,
            actorId: actor.userId,
            type: ActivityType.DOCUMENT_CREATED,
            entityType: "document",
            entityId: doc.id,
            data: { title: doc.title, type: doc.type, fromTemplate: def.id },
          },
          tx,
        );
      }

      // Wire dependency edges (idempotent on the unique constraint).
      let edgesCreated = 0;
      for (const edge of def.edges) {
        const fromDocId = idByKey.get(edge.from);
        const toDocId = idByKey.get(edge.to);
        if (!fromDocId || !toDocId || fromDocId === toDocId) continue;
        const existingEdge = await tx.dependency.findUnique({
          where: {
            fromDocId_toDocId_kind: { fromDocId, toDocId, kind: edge.kind },
          },
          select: { id: true },
        });
        if (existingEdge) continue;
        await tx.dependency.create({
          data: { fromDocId, toDocId, kind: edge.kind },
        });
        await logActivity(
          {
            workspaceId: input.workspaceId,
            actorId: actor.userId,
            type: ActivityType.DEPENDENCY_ADDED,
            entityType: "document",
            entityId: fromDocId,
            data: { toDocId, kind: edge.kind, fromTemplate: def.id },
          },
          tx,
        );
        edgesCreated++;
      }

      // Audit hardening (M11): one summary event for the template-apply action
      // itself (in addition to the per-doc/per-edge events), so the audit log
      // shows "applied template X" as a discrete security-relevant action.
      await logActivity(
        {
          workspaceId: input.workspaceId,
          actorId: actor.userId,
          type: ActivityType.TEMPLATE_APPLIED,
          entityType: "project",
          entityId: input.projectId,
          data: {
            templateId: def.id,
            templateName: def.name,
            docCount: docs.length,
            edgeCount: edgesCreated,
          } as Prisma.InputJsonValue,
        },
        tx,
      );

      return { documents: docs, edgesCreated };
    });

    revalidatePath("/", "layout");
    return {
      templateId: def.id,
      documents: created.documents,
      edgesCreated: created.edgesCreated,
    };
  },
);

/** Apply a built-in template to a project. Requires `doc.create`. */
export async function applyTemplate(input: {
  workspaceId: string;
  projectId: string;
  templateId: string;
}): Promise<ApplyTemplateResult> {
  return _applyTemplate(input);
}
