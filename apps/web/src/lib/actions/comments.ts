"use server";

import {
  prisma,
  ActivityType,
  NotificationType,
  type Prisma,
} from "@forgespecs/db";
import {
  withPermission,
  logActivity,
  createNotification,
  parseMentions,
  renderMentionsPlain,
  type Scope,
} from "@forgespecs/core";

import { after } from "next/server";

import "@/lib/auth/rbac";
import { triggerAgentRun } from "@/lib/generation/agent-trigger";

/**
 * Comment thread Server Actions (M5).
 *
 * THREE-SOURCES-OF-TRUTH: a comment's body/threading/resolution are queryable
 * server facts (Postgres + Query). The anchor — a serialized Yjs relative
 * position pointing at the block/range — is produced client-side via the core
 * `createCommentAnchor` helper against the live Y.Doc and passed in opaquely;
 * the server stores it in `Comment.anchor` without decoding it.
 *
 * Every mutation goes through `withPermission` (the single RBAC chokepoint).
 * Mentions in the body (`@[label](user:id)` / `@[label](agent:name)` tokens —
 * see core `parseMentions`) create `Mention` rows and, for users, inbox
 * `Notification`s — all atomic with the comment write.
 */

// ── helpers ────────────────────────────────────────────────────────────────

const projectScope = (workspaceId: string, projectId: string): Scope => ({
  kind: "project",
  workspaceId,
  projectId,
});

/**
 * Process mention tokens in a comment body: write Mention rows (agent mentions
 * set isAgent for M6/M7 run triggers) and notify mentioned users. Runs inside
 * the comment's transaction.
 */
async function processMentions(
  tx: Prisma.TransactionClient,
  opts: {
    body: string;
    documentId: string;
    actorId: string;
    link: string | null;
    docTitle: string;
  },
): Promise<{ agentNames: string[] }> {
  const mentions = parseMentions(opts.body);
  const agentNames: string[] = [];
  if (mentions.length === 0) return { agentNames };

  const preview = renderMentionsPlain(opts.body).slice(0, 140);

  for (const m of mentions) {
    if (m.kind === "user") {
      await tx.mention.create({
        data: {
          documentId: opts.documentId,
          actorId: opts.actorId,
          targetId: m.userId,
          isAgent: false,
        },
      });
      // Don't notify yourself.
      if (m.userId !== opts.actorId) {
        await createNotification(
          {
            recipientId: m.userId,
            type: NotificationType.MENTION,
            title: `You were mentioned in “${opts.docTitle}”`,
            body: preview,
            link: opts.link,
          },
          tx,
        );
      }
    } else {
      // Agent mention — isAgent triggers AI runs in M6/M7 via the same rows.
      await tx.mention.create({
        data: {
          documentId: opts.documentId,
          actorId: opts.actorId,
          isAgent: true,
          agentName: m.agentName,
        },
      });
      agentNames.push(m.agentName);
    }
  }
  return { agentNames };
}

// ── guarded implementations ────────────────────────────────────────────────

export interface CommentResult {
  id: string;
  threadId: string;
}

const _createComment = withPermission(
  (input: {
    documentId: string;
    body: string;
    anchor?: unknown;
    blockId?: string | null;
    /** Reply target: the root comment id of the thread. */
    parentId?: string | null;
    scope: Scope;
    link?: string | null;
    docTitle?: string;
  }) => input.scope,
  "comment.create",
  async (actor, input): Promise<CommentResult> => {
    const body = input.body.trim();
    if (!body) throw new Error("Comment body is required.");

    const { result, agentNames } = await prisma.$transaction(async (tx) => {
      const created = await tx.comment.create({
        data: {
          documentId: input.documentId,
          authorId: actor.userId,
          body,
          // Anchors only belong on root comments (replies inherit the thread's).
          anchor: input.parentId
            ? undefined
            : ((input.anchor ?? undefined) as Prisma.InputJsonValue | undefined),
          blockId: input.parentId ? null : (input.blockId ?? null),
          parentId: input.parentId ?? null,
        },
        select: { id: true, parentId: true },
      });

      const docTitle = input.docTitle ?? "a document";
      const { agentNames } = await processMentions(tx, {
        body,
        documentId: input.documentId,
        actorId: actor.userId,
        link: input.link ?? null,
        docTitle,
      });

      await logActivity(
        {
          workspaceId: input.scope.workspaceId,
          actorId: actor.userId,
          type: ActivityType.COMMENT_ADDED,
          entityType: "document",
          entityId: input.documentId,
          data: {
            commentId: created.id,
            reply: Boolean(input.parentId),
          },
        },
        tx,
      );

      return { result: created, agentNames };
    });

    // @agent mentions trigger AI runs AFTER the comment commits (and after the
    // response is sent) so the comment write never waits on the agent enqueue.
    if (agentNames.length > 0) {
      const docId = input.documentId;
      const actorId = actor.userId;
      after(async () => {
        for (const agentName of agentNames) {
          await triggerAgentRun({ documentId: docId, agentName, actorId });
        }
      });
    }

    return { id: result.id, threadId: result.parentId ?? result.id };
  },
);

const _resolveComment = withPermission(
  (input: { commentId: string; resolved: boolean; scope: Scope }) => input.scope,
  "comment.resolve",
  async (actor, input): Promise<{ id: string; resolved: boolean }> => {
    // Resolution applies to the thread root; resolving a reply resolves its root.
    const comment = await prisma.comment.findUniqueOrThrow({
      where: { id: input.commentId },
      select: { id: true, parentId: true, documentId: true },
    });
    const rootId = comment.parentId ?? comment.id;

    const updated = await prisma.comment.update({
      where: { id: rootId },
      data: { resolved: input.resolved },
      select: { id: true, resolved: true },
    });

    await logActivity({
      workspaceId: input.scope.workspaceId,
      actorId: actor.userId,
      type: ActivityType.COMMENT_ADDED,
      entityType: "document",
      entityId: comment.documentId,
      data: { commentId: rootId, resolved: input.resolved },
    });

    return updated;
  },
);

const _deleteComment = withPermission(
  (input: { commentId: string; scope: Scope }) => input.scope,
  "comment.create",
  async (actor, input): Promise<{ id: string }> => {
    // Only the author may delete their own comment (defense-in-depth beyond RBAC).
    const comment = await prisma.comment.findUniqueOrThrow({
      where: { id: input.commentId },
      select: { id: true, authorId: true },
    });
    if (comment.authorId && comment.authorId !== actor.userId) {
      throw new Error("You can only delete your own comments.");
    }
    // Cascade removes replies (parentId onDelete: Cascade).
    await prisma.comment.delete({ where: { id: input.commentId } });
    return { id: input.commentId };
  },
);

// ── exported Server Actions ────────────────────────────────────────────────

/**
 * Create a comment. With `parentId` it's a reply; otherwise a new thread whose
 * id is the thread id. Pass the client-built `anchor` (Yjs relative position)
 * and `blockId` for a new thread. Requires `comment.create`.
 */
export async function createComment(input: {
  documentId: string;
  body: string;
  anchor?: unknown;
  blockId?: string | null;
  parentId?: string | null;
  scope: Scope;
  link?: string | null;
  docTitle?: string;
}): Promise<CommentResult> {
  return _createComment(input);
}

/** Resolve / unresolve a comment thread. Requires `comment.resolve`. */
export async function resolveComment(input: {
  commentId: string;
  resolved: boolean;
  scope: Scope;
}): Promise<{ id: string; resolved: boolean }> {
  return _resolveComment(input);
}

/** Delete a comment (author only). Requires `comment.create`. */
export async function deleteComment(input: {
  commentId: string;
  scope: Scope;
}): Promise<{ id: string }> {
  return _deleteComment(input);
}
