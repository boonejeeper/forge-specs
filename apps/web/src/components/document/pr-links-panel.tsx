"use client";

import * as React from "react";
import { GitPullRequestArrow, Loader2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  linkPullRequest,
  unlinkPullRequest,
} from "@/lib/actions/pr-links";

export interface PrLink {
  id: string;
  url: string;
  repoOwner: string;
  repoName: string;
  number: number;
  title: string | null;
  state: "OPEN" | "CLOSED" | "MERGED" | "DRAFT";
  merged: boolean;
}

const STATE_STYLES: Record<PrLink["state"], string> = {
  OPEN: "bg-green-500/15 text-green-600 dark:text-green-400",
  DRAFT: "bg-muted text-muted-foreground",
  MERGED: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  CLOSED: "bg-red-500/15 text-red-600 dark:text-red-400",
};

/**
 * GitHub PR linkage panel (M11). Lets an editor link a spec/task to a GitHub PR;
 * status reflects whatever the /api/webhooks/github route last recorded. Optional
 * feature — works without a webhook (status just won't auto-update).
 */
export function PrLinksPanel({
  workspaceId,
  projectId,
  documentId,
  initialLinks,
  canEdit,
}: {
  workspaceId: string;
  projectId: string;
  documentId: string;
  initialLinks: PrLink[];
  canEdit: boolean;
}) {
  const [links, setLinks] = React.useState<PrLink[]>(initialLinks);
  const [url, setUrl] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const link = await linkPullRequest({ workspaceId, projectId, documentId, url });
      setLinks((prev) => [
        {
          id: link.id,
          url: link.url,
          repoOwner: link.repoOwner,
          repoName: link.repoName,
          number: link.number,
          title: null,
          state: "OPEN",
          merged: false,
        },
        ...prev.filter((l) => l.id !== link.id),
      ]);
      setUrl("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link PR.");
    } finally {
      setPending(false);
    }
  }

  async function onUnlink(linkId: string) {
    setLinks((prev) => prev.filter((l) => l.id !== linkId));
    try {
      await unlinkPullRequest({ workspaceId, projectId, linkId });
    } catch {
      // Re-fetch on next nav; optimistic removal is fine for a link.
    }
  }

  return (
    <section className="rounded-lg border p-4">
      <div className="mb-3 flex items-center gap-2">
        <GitPullRequestArrow className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Linked pull requests</h2>
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No pull requests linked yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {links.map((l) => (
            <li
              key={l.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {l.repoOwner}/{l.repoName} #{l.number}
                {l.title ? ` — ${l.title}` : ""}
              </a>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLES[l.state]}`}
              >
                {l.state.toLowerCase()}
              </span>
              {canEdit ? (
                <button
                  type="button"
                  onClick={() => onUnlink(l.id)}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="Unlink PR"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canEdit ? (
        <form onSubmit={onLink} className="mt-3 flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/owner/repo/pull/123"
            className="flex-1"
          />
          <Button type="submit" size="sm" disabled={pending || !url.trim()}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Link
          </Button>
        </form>
      ) : null}

      {error ? <p className="mt-2 text-sm text-destructive">{error}</p> : null}
    </section>
  );
}
