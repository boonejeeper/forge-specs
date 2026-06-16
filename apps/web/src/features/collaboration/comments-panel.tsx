"use client";

import * as React from "react";
import { Check, MessageSquarePlus, RotateCcw, Trash2, CornerDownRight } from "lucide-react";

import {
  createCommentAnchor,
  resolveCommentAnchor,
  isSerializedCommentAnchor,
  type SerializedCommentAnchor,
} from "@forgespecs/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MentionTarget } from "@/features/editor/ForgeEditor";
import { useEditorBridge } from "@/features/editor/editor-bridge";

import { CommentComposer } from "./comment-composer";
import { RenderBody } from "./render-body";
import {
  useCommentThreads,
  useCommentMutations,
  type DocContext,
  type CommentThreadDto,
} from "./use-collaboration";

/**
 * Comment sidebar: lists threads, lets you start a thread anchored to the
 * current editor selection, reply, and resolve/unresolve.
 *
 * Anchors: a new thread's anchor is built CLIENT-SIDE from the live Y.Doc +
 * selection via core `createCommentAnchor` (Yjs relative position). Threads are
 * resolved back to absolute positions for the "jump to" affordance and to flag
 * orphaned threads (anchored content was deleted).
 */
export function CommentsPanel({
  ctx,
  mentionTargets,
  canComment,
  canResolve,
  currentUserId,
}: {
  ctx: DocContext;
  mentionTargets: MentionTarget[];
  canComment: boolean;
  canResolve: boolean;
  currentUserId: string | null;
}) {
  const { data: threads = [], isLoading } = useCommentThreads(ctx.documentId);
  const { create, resolve, remove } = useCommentMutations(ctx);
  const bridge = useEditorBridge();
  const [showResolved, setShowResolved] = React.useState(false);

  const visible = threads.filter((t) => showResolved || !t.resolved);
  const resolvedCount = threads.filter((t) => t.resolved).length;

  const startThread = (body: string): void => {
    let anchor: SerializedCommentAnchor | undefined;
    let blockId: string | null = null;
    const sel = bridge?.getSelection?.();
    if (bridge?.doc && sel?.blockId) {
      blockId = sel.blockId;
      anchor = createCommentAnchor(bridge.doc, {
        blockId: sel.blockId,
        start: sel.start,
        end: sel.end,
      });
    }
    create.mutate({ body, anchor, blockId });
  };

  return (
    <div className="flex h-full flex-col">
      {canComment ? (
        <div className="border-b p-3">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageSquarePlus className="size-3.5" />
            {selectionHint(bridge?.getSelection?.() ?? null)}
          </div>
          <CommentComposer
            mentionTargets={mentionTargets}
            onSubmit={startThread}
            submitting={create.isPending}
            placeholder="Start a thread on the selection…"
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground">
        <span>
          {visible.length} {visible.length === 1 ? "thread" : "threads"}
        </span>
        {resolvedCount > 0 ? (
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => setShowResolved((s) => !s)}
          >
            {showResolved ? "Hide" : "Show"} resolved ({resolvedCount})
          </button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto px-3 pb-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No comments yet. Select text in the doc and start a thread.
          </p>
        ) : (
          visible.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              ctx={ctx}
              mentionTargets={mentionTargets}
              canComment={canComment}
              canResolve={canResolve}
              currentUserId={currentUserId}
              onReply={(body) =>
                create.mutate({ body, parentId: thread.id })
              }
              onResolve={(resolved) =>
                resolve.mutate({ commentId: thread.id, resolved })
              }
              onDelete={(commentId) => remove.mutate({ commentId })}
            />
          ))
        )}
      </div>
    </div>
  );
}

function selectionHint(
  sel: { blockId: string | null; start: number; end: number; text: string } | null,
): string {
  if (!sel || !sel.blockId) return "Place your cursor in the doc to anchor a thread";
  if (sel.end > sel.start && sel.text) {
    const preview = sel.text.length > 32 ? `${sel.text.slice(0, 32)}…` : sel.text;
    return `On “${preview}”`;
  }
  return "On the current block";
}

function ThreadCard({
  thread,
  ctx,
  mentionTargets,
  canComment,
  canResolve,
  currentUserId,
  onReply,
  onResolve,
  onDelete,
}: {
  thread: CommentThreadDto;
  ctx: DocContext;
  mentionTargets: MentionTarget[];
  canComment: boolean;
  canResolve: boolean;
  currentUserId: string | null;
  onReply: (body: string) => void;
  onResolve: (resolved: boolean) => void;
  onDelete: (commentId: string) => void;
}) {
  const bridge = useEditorBridge();
  const [replying, setReplying] = React.useState(false);

  const orphaned = React.useMemo(() => {
    if (!bridge?.doc) return false;
    if (!isSerializedCommentAnchor(thread.anchor)) return false;
    return resolveCommentAnchor(bridge.doc, thread.anchor) === null;
  }, [bridge, thread.anchor]);

  const jump = (): void => {
    if (thread.blockId) bridge?.focusBlock?.(thread.blockId);
  };

  return (
    <div
      className={cn(
        "rounded-md border bg-card p-3 text-card-foreground",
        thread.resolved && "opacity-60",
      )}
    >
      <CommentRow
        author={thread.root.authorName}
        body={thread.root.body}
        createdAt={thread.root.createdAt}
        canDelete={canComment && thread.root.authorId === currentUserId}
        onDelete={() => onDelete(thread.root.id)}
      />

      {thread.blockId ? (
        <button
          type="button"
          onClick={jump}
          className="mt-1 text-xs text-primary hover:underline"
        >
          {orphaned ? "Anchor removed" : "Jump to anchor"}
        </button>
      ) : null}

      {thread.replies.length > 0 ? (
        <div className="mt-2 space-y-2 border-l pl-3">
          {thread.replies.map((r) => (
            <CommentRow
              key={r.id}
              author={r.authorName}
              body={r.body}
              createdAt={r.createdAt}
              canDelete={canComment && r.authorId === currentUserId}
              onDelete={() => onDelete(r.id)}
            />
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-center gap-2">
        {canComment ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setReplying((s) => !s)}
          >
            <CornerDownRight className="size-3.5" />
            Reply
          </Button>
        ) : null}
        {canResolve ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onResolve(!thread.resolved)}
          >
            {thread.resolved ? (
              <>
                <RotateCcw className="size-3.5" />
                Unresolve
              </>
            ) : (
              <>
                <Check className="size-3.5" />
                Resolve
              </>
            )}
          </Button>
        ) : null}
      </div>

      {replying ? (
        <div className="mt-2">
          <CommentComposer
            mentionTargets={mentionTargets}
            onSubmit={(body) => {
              onReply(body);
              setReplying(false);
            }}
            placeholder="Reply…"
            autoFocus
            compact
          />
        </div>
      ) : null}
    </div>
  );
}

function CommentRow({
  author,
  body,
  createdAt,
  canDelete,
  onDelete,
}: {
  author: string | null;
  body: string;
  createdAt: string;
  canDelete: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="group">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">{author ?? "Unknown"}</span>
        <span className="text-xs text-muted-foreground">
          {new Date(createdAt).toLocaleString()}
        </span>
        {canDelete ? (
          <button
            type="button"
            aria-label="Delete comment"
            onClick={onDelete}
            className="ml-auto opacity-0 transition-opacity group-hover:opacity-100"
          >
            <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
          </button>
        ) : null}
      </div>
      <RenderBody body={body} />
    </div>
  );
}
