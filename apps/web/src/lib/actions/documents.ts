"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import {
  prisma,
  ActivityType,
  type DependencyKind,
  type DocumentStatus,
  type DocumentType,
  type Prisma,
} from "@forgespecs/db";
import { enqueueEmbedDocument } from "@forgespecs/jobs";
import {
  withPermission,
  slugify,
  uniqueSlug,
  assertTransition,
  requiresApprovingReview,
  countApprovingReviews,
  createVersion,
  hasChangesSinceLastVersion,
  logActivity,
  blocknoteToPlainText,
  projectBlocks,
  type Scope,
} from "@forgespecs/core";

import { hasApiKey, generateChangelog } from "@forgespecs/ai";

import "@/lib/auth/rbac"; // installs the RBAC provider on import

// A "use server" module may only export async functions. Each Server Action is
// a thin async wrapper (bottom of file) delegating to a withPermission-guarded
// implementation — the guard is still the single authorization chokepoint.

export interface DocumentResult {
  id: string;
  slug: string;
  title: string;
  type: DocumentType;
  status: DocumentStatus;
}

const DOC_SELECT = {
  id: true,
  slug: true,
  title: true,
  type: true,
  status: true,
} as const;

const projectScope = (workspaceId: string, projectId: string): Scope => ({
  kind: "project",
  workspaceId,
  projectId,
});

// ── guarded implementations ────────────────────────────────────────────────

const _createDocument = withPermission(
  (input: {
    workspaceId: string;
    projectId: string;
    type: DocumentType;
    title: string;
  }) => projectScope(input.workspaceId, input.projectId),
  "doc.create",
  async (actor, input): Promise<DocumentResult> => {
    const title = input.title.trim();
    if (!title) throw new Error("Document title is required.");

    const siblings = await prisma.document.findMany({
      where: { projectId: input.projectId },
      select: { slug: true },
    });
    const slug = uniqueSlug(
      slugify(title),
      siblings.map((d) => d.slug),
    );

    // New docs append to the end of their type group (fractional order).
    const last = await prisma.document.findFirst({
      where: { projectId: input.projectId, type: input.type },
      orderBy: { createdAt: "desc" },
      select: { frontmatter: true },
    });
    const order = (readOrder(last?.frontmatter) ?? 0) + 1;

    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          projectId: input.projectId,
          authorId: actor.userId,
          type: input.type,
          title,
          slug,
          frontmatter: { order } as Prisma.InputJsonValue,
        },
        select: DOC_SELECT,
      });
      await logActivity(
        {
          workspaceId: input.workspaceId,
          actorId: actor.userId,
          type: ActivityType.DOCUMENT_CREATED,
          entityType: "document",
          entityId: created.id,
          data: { title, type: input.type },
        },
        tx,
      );
      return created;
    });

    revalidatePath("/", "layout");
    return doc;
  },
);

const _renameDocument = withPermission(
  (input: { documentId: string; title: string; scope: Scope }) => input.scope,
  "doc.edit",
  async (actor, input): Promise<DocumentResult> => {
    const title = input.title.trim();
    if (!title) throw new Error("Document title is required.");

    const doc = await prisma.document.update({
      where: { id: input.documentId },
      data: { title },
      select: DOC_SELECT,
    });
    await logActivity({
      workspaceId: input.scope.workspaceId,
      actorId: actor.userId,
      type: ActivityType.DOCUMENT_UPDATED,
      entityType: "document",
      entityId: doc.id,
      data: { title },
    });

    revalidatePath("/", "layout");
    return doc;
  },
);

const _deleteDocument = withPermission(
  (input: { documentId: string; scope: Scope }) => input.scope,
  "doc.delete",
  async (actor, input): Promise<{ id: string }> => {
    const doc = await prisma.document.delete({
      where: { id: input.documentId },
      select: { id: true, title: true },
    });
    await logActivity({
      workspaceId: input.scope.workspaceId,
      actorId: actor.userId,
      type: ActivityType.DOCUMENT_UPDATED,
      entityType: "document",
      entityId: doc.id,
      data: { deleted: true, title: doc.title },
    });

    revalidatePath("/", "layout");
    return { id: doc.id };
  },
);

const _changeDocumentStatus = withPermission(
  (input: { documentId: string; status: DocumentStatus; scope: Scope }) =>
    input.scope,
  "doc.changeStatus",
  async (actor, input): Promise<DocumentResult> => {
    const current = await prisma.document.findUniqueOrThrow({
      where: { id: input.documentId },
      select: { status: true },
    });

    // For the REVIEW → APPROVED transition the core gate also requires ≥1
    // APPROVE review pinned to the current version (M5 wires the M1 TODO hook).
    // Only pay the count query when the transition actually needs it.
    const approvingReviews = requiresApprovingReview(current.status, input.status)
      ? await countApprovingReviews(input.documentId)
      : 0;

    // Core state machine enforces structural validity + the role floor
    // (e.g. APPROVED requires ARCHITECT+) + the approving-review gate.
    assertTransition(current.status, input.status, {
      role: actor.role,
      approvingReviews,
    });

    // Snapshot at status transitions (publish/review milestones are exactly the
    // checkpoints history should capture) — but keep it idempotent-ish: only
    // snapshot when content actually changed since the last version, so flipping
    // status twice without edits doesn't churn version numbers.
    const shouldSnapshot = await hasChangesSinceLastVersion(input.documentId);

    const doc = await prisma.$transaction(async (tx) => {
      const updated = await tx.document.update({
        where: { id: input.documentId },
        data: { status: input.status },
        select: DOC_SELECT,
      });
      await logActivity(
        {
          workspaceId: input.scope.workspaceId,
          actorId: actor.userId,
          type: ActivityType.STATUS_CHANGED,
          entityType: "document",
          entityId: updated.id,
          data: { from: current.status, to: input.status },
        },
        tx,
      );
      if (shouldSnapshot) {
        const v = await createVersion(
          {
            documentId: input.documentId,
            authorId: actor.userId,
            label: `Status → ${input.status}`,
          },
          tx,
        );
        await logActivity(
          {
            workspaceId: input.scope.workspaceId,
            actorId: actor.userId,
            type: ActivityType.VERSION_CREATED,
            entityType: "document",
            entityId: input.documentId,
            data: { versionNum: v.versionNum, label: `Status → ${input.status}` },
          },
          tx,
        );
      }
      return updated;
    });

    revalidatePath("/", "layout");
    return doc;
  },
);

const _updateFrontmatter = withPermission(
  (input: {
    documentId: string;
    frontmatter: Record<string, unknown>;
    scope: Scope;
  }) => input.scope,
  "doc.edit",
  async (actor, input): Promise<{ id: string }> => {
    const existing = await prisma.document.findUniqueOrThrow({
      where: { id: input.documentId },
      select: { frontmatter: true },
    });
    const merged = {
      ...((existing.frontmatter as Record<string, unknown>) ?? {}),
      ...input.frontmatter,
    } as Prisma.InputJsonValue;

    const doc = await prisma.document.update({
      where: { id: input.documentId },
      data: { frontmatter: merged },
      select: { id: true },
    });
    await logActivity({
      workspaceId: input.scope.workspaceId,
      actorId: actor.userId,
      type: ActivityType.DOCUMENT_UPDATED,
      entityType: "document",
      entityId: doc.id,
      data: { frontmatter: input.frontmatter as Prisma.InputJsonValue },
    });

    revalidatePath("/", "layout");
    return doc;
  },
);

const _saveDocumentContent = withPermission(
  (input: {
    documentId: string;
    contentJSON: unknown;
    scope: Scope;
  }) => input.scope,
  "doc.edit",
  async (_actor, input): Promise<{ id: string; updatedAt: string }> => {
    // contentJSON (the BlockNote document) is the source of truth for the body
    // in M2. We derive contentText (→ tsvector + future embeddings) and project
    // the block tree into the Block table so M3 search and M4 compaction share
    // the same shape. In M4 this exact projection moves into collab compaction.
    const contentText = blocknoteToPlainText(input.contentJSON);
    const rows = projectBlocks(input.contentJSON);

    const updated = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.update({
        where: { id: input.documentId },
        data: {
          contentJSON: (input.contentJSON ?? []) as Prisma.InputJsonValue,
          contentText,
        },
        select: { id: true, updatedAt: true },
      });

      // Re-project the Block tree. Single-player + small specs → replace wholesale
      // (idempotent; cheap). M4's compaction will do an incremental fold instead.
      await tx.block.deleteMany({ where: { documentId: input.documentId } });
      if (rows.length > 0) {
        await tx.block.createMany({
          data: rows.map((r) => ({
            id: r.id,
            documentId: input.documentId,
            parentId: r.parentId,
            order: r.order,
            type: r.type,
            json: r.json as Prisma.InputJsonValue,
            text: r.text,
          })),
        });
      }
      return doc;
    });

    // Embedding refresh — runs AFTER the response is sent (Next `after()`), so
    // the save returns immediately. Enqueued onto BullMQ when REDIS_URL is set,
    // else run inline (the M3 behaviour). The pipeline hash-dedupes vs existing
    // rows and no-ops when OPENROUTER_API_KEY is unset, so this is safe to fire
    // on every (debounced) save. enqueueEmbedDocument never throws.
    after(async () => {
      await enqueueEmbedDocument(prisma, input.documentId);
    });

    // Note: no revalidatePath here — the body persists via the Query/client path
    // and the editor holds the authoritative in-memory state. Revalidating the
    // layout on every debounced save would thrash the RSC tree.
    return { id: updated.id, updatedAt: updated.updatedAt.toISOString() };
  },
);

const _duplicateFromTemplate = withPermission(
  (input: {
    workspaceId: string;
    projectId: string;
    templateId: string;
    title?: string;
  }) => projectScope(input.workspaceId, input.projectId),
  "doc.create",
  async (actor, input): Promise<DocumentResult> => {
    const template = await prisma.template.findUniqueOrThrow({
      where: { id: input.templateId },
      select: { name: true, type: true, content: true },
    });
    const title = (input.title ?? template.name).trim();

    const siblings = await prisma.document.findMany({
      where: { projectId: input.projectId },
      select: { slug: true },
    });
    const slug = uniqueSlug(
      slugify(title),
      siblings.map((d) => d.slug),
    );

    const doc = await prisma.$transaction(async (tx) => {
      const created = await tx.document.create({
        data: {
          projectId: input.projectId,
          authorId: actor.userId,
          type: template.type,
          title,
          slug,
          contentJSON: (template.content ?? {}) as Prisma.InputJsonValue,
          frontmatter: { order: 1 } as Prisma.InputJsonValue,
        },
        select: DOC_SELECT,
      });
      await logActivity(
        {
          workspaceId: input.workspaceId,
          actorId: actor.userId,
          type: ActivityType.DOCUMENT_CREATED,
          entityType: "document",
          entityId: created.id,
          data: { title, type: template.type, fromTemplate: input.templateId },
        },
        tx,
      );
      return created;
    });

    revalidatePath("/", "layout");
    return doc;
  },
);

const _snapshotDocumentVersion = withPermission(
  (input: { documentId: string; label?: string; scope: Scope }) => input.scope,
  "doc.edit",
  async (
    actor,
    input,
  ): Promise<{ id: string; versionNum: number; skipped?: boolean }> => {
    // Unlabeled snapshots with no change since the last version are a no-op
    // (don't burn a version number). An explicit human label is always honored —
    // the user wants a named checkpoint even if content is identical.
    if (!input.label && !(await hasChangesSinceLastVersion(input.documentId))) {
      const latest = await prisma.documentVersion.findFirst({
        where: { documentId: input.documentId },
        orderBy: { versionNum: "desc" },
        select: { id: true, versionNum: true },
      });
      if (latest) return { ...latest, skipped: true };
    }

    const version = await prisma.$transaction(async (tx) => {
      const v = await createVersion(
        {
          documentId: input.documentId,
          authorId: actor.userId,
          label: input.label,
        },
        tx,
      );
      await logActivity(
        {
          workspaceId: input.scope.workspaceId,
          actorId: actor.userId,
          type: ActivityType.VERSION_CREATED,
          entityType: "document",
          entityId: input.documentId,
          data: { versionNum: v.versionNum, label: input.label ?? null },
        },
        tx,
      );
      return v;
    });

    revalidatePath("/", "layout");

    // AI changelog: when no human label was given AND a key is present, generate
    // a one-line summary from the delta vs the previous version and write it to
    // DocumentVersion.summary. Runs AFTER the response is sent; no-op without a
    // key (the human label, if any, already lives in summary). M8's history UI
    // surfaces this; we only write the field that already exists.
    if (!input.label && hasApiKey()) {
      const documentId = input.documentId;
      const versionNum = version.versionNum;
      after(async () => {
        try {
          const [current, previous] = await Promise.all([
            prisma.document.findUnique({
              where: { id: documentId },
              select: { title: true, contentText: true },
            }),
            prisma.documentVersion.findUnique({
              where: { documentId_versionNum: { documentId, versionNum: versionNum - 1 } },
              select: { contentText: true },
            }),
          ]);
          if (!current) return;
          const summary = await generateChangelog({
            title: current.title,
            previousText: previous?.contentText ?? "",
            currentText: current.contentText,
          });
          await prisma.documentVersion.update({
            where: { id: version.id },
            data: { summary },
          });
        } catch (err) {
          console.error("[changelog] generation failed:", err);
        }
      });
    }

    return { id: version.id, versionNum: version.versionNum };
  },
);

const _reorderDocuments = withPermission(
  (input: { workspaceId: string; projectId: string; orderedIds: string[] }) =>
    projectScope(input.workspaceId, input.projectId),
  "doc.edit",
  async (_actor, input): Promise<{ ok: true }> => {
    const docs = await prisma.document.findMany({
      where: { id: { in: input.orderedIds }, projectId: input.projectId },
      select: { id: true, frontmatter: true },
    });
    const fmById = new Map(
      docs.map((d) => [d.id, (d.frontmatter as Record<string, unknown>) ?? {}]),
    );

    await prisma.$transaction(
      input.orderedIds.map((id, index) =>
        prisma.document.update({
          where: { id },
          data: {
            frontmatter: {
              ...(fmById.get(id) ?? {}),
              order: index,
            } as Prisma.InputJsonValue,
          },
        }),
      ),
    );

    revalidatePath("/", "layout");
    return { ok: true };
  },
);

const _createDependency = withPermission(
  (input: {
    fromDocId: string;
    toDocId: string;
    kind: DependencyKind;
    scope: Scope;
  }) => input.scope,
  "doc.manageDependencies",
  async (actor, input): Promise<{ id: string; created: boolean }> => {
    if (input.fromDocId === input.toDocId) {
      throw new Error("A document cannot depend on itself.");
    }
    // Idempotent on the (from, to, kind) unique constraint — a re-run/resume of
    // architecture materialization must not duplicate edges.
    const existing = await prisma.dependency.findUnique({
      where: {
        fromDocId_toDocId_kind: {
          fromDocId: input.fromDocId,
          toDocId: input.toDocId,
          kind: input.kind,
        },
      },
      select: { id: true },
    });
    if (existing) return { id: existing.id, created: false };

    const dep = await prisma.$transaction(async (tx) => {
      const created = await tx.dependency.create({
        data: {
          fromDocId: input.fromDocId,
          toDocId: input.toDocId,
          kind: input.kind,
        },
        select: { id: true },
      });
      await logActivity(
        {
          workspaceId: input.scope.workspaceId,
          actorId: actor.userId,
          type: ActivityType.DEPENDENCY_ADDED,
          entityType: "document",
          entityId: input.fromDocId,
          data: { toDocId: input.toDocId, kind: input.kind },
        },
        tx,
      );
      return created;
    });
    return { id: dep.id, created: true };
  },
);

// ── exported Server Actions (thin async wrappers) ──────────────────────────

/** Create a document of a given type + title. Requires `doc.create`. */
export async function createDocument(input: {
  workspaceId: string;
  projectId: string;
  type: DocumentType;
  title: string;
}): Promise<DocumentResult> {
  return _createDocument(input);
}

/** Rename a document (title only; slug is stable). Requires `doc.edit`. */
export async function renameDocument(input: {
  documentId: string;
  title: string;
  scope: Scope;
}): Promise<DocumentResult> {
  return _renameDocument(input);
}

/** Delete a document. Requires `doc.delete`. */
export async function deleteDocument(input: {
  documentId: string;
  scope: Scope;
}): Promise<{ id: string }> {
  return _deleteDocument(input);
}

/**
 * Move a document along the status state machine. Requires `doc.changeStatus`
 * AND a valid transition (enforced by the core state machine).
 */
export async function changeDocumentStatus(input: {
  documentId: string;
  status: DocumentStatus;
  scope: Scope;
}): Promise<DocumentResult> {
  return _changeDocumentStatus(input);
}

/** Patch a document's editable frontmatter. Requires `doc.edit`. */
export async function updateFrontmatter(input: {
  documentId: string;
  frontmatter: Record<string, unknown>;
  scope: Scope;
}): Promise<{ id: string }> {
  return _updateFrontmatter(input);
}

/**
 * Persist the BlockNote document body. Derives `contentText` and re-projects the
 * `Block` tree. Requires `doc.edit`. This is the seam M4 replaces: realtime
 * collab will instead persist Yjs updates and run this projection in compaction.
 */
export async function saveDocumentContent(input: {
  documentId: string;
  contentJSON: unknown;
  scope: Scope;
}): Promise<{ id: string; updatedAt: string }> {
  return _saveDocumentContent(input);
}

/** Create a document from a Template. Requires `doc.create`. */
export async function duplicateFromTemplate(input: {
  workspaceId: string;
  projectId: string;
  templateId: string;
  title?: string;
}): Promise<DocumentResult> {
  return _duplicateFromTemplate(input);
}

/** Snapshot the current document content as a new DocumentVersion. */
export async function snapshotDocumentVersion(input: {
  documentId: string;
  label?: string;
  scope: Scope;
}): Promise<{ id: string; versionNum: number; skipped?: boolean }> {
  return _snapshotDocumentVersion(input);
}

/** Reorder documents within a type group. Requires `doc.edit`. */
export async function reorderDocuments(input: {
  workspaceId: string;
  projectId: string;
  orderedIds: string[];
}): Promise<{ ok: true }> {
  return _reorderDocuments(input);
}

/**
 * Create a Dependency edge between two documents. Idempotent on (from, to, kind).
 * Requires `doc.manageDependencies`.
 */
export async function createDependency(input: {
  fromDocId: string;
  toDocId: string;
  kind: DependencyKind;
  scope: Scope;
}): Promise<{ id: string; created: boolean }> {
  return _createDependency(input);
}

// ── helpers ──────────────────────────────────────────────────────────────

function readOrder(frontmatter: unknown): number | null {
  if (
    frontmatter &&
    typeof frontmatter === "object" &&
    "order" in frontmatter &&
    typeof (frontmatter as { order: unknown }).order === "number"
  ) {
    return (frontmatter as { order: number }).order;
  }
  return null;
}
