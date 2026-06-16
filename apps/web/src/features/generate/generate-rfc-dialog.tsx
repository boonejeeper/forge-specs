"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Sparkles, Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUiStore } from "@/lib/store/ui";
import { useWorkspace, useOptionalProject } from "@/lib/context/workspace-context";
import { queryKeys } from "@/lib/query/keys";

/**
 * "Generate RFC from prompt" dialog (command palette + button entry). Streams
 * the RFC into a newly created spec so the user watches it type itself, then
 * navigates to the new document. Opens from the UI store flag.
 *
 * The new document id arrives in the X-Document-Id response header (the route
 * creates the doc up front); the body is the streamed RFC JSON, which we show as
 * a live "generating…" preview. Persistence into the editor body happens
 * server-side via saveDocumentContent on finish — we just navigate when done.
 */
export function GenerateRfcDialog() {
  const open = useUiStore((s) => s.generateRfcOpen);
  const setOpen = useUiStore((s) => s.setGenerateRfcOpen);
  const workspace = useWorkspace();
  const project = useOptionalProject();
  const router = useRouter();
  const qc = useQueryClient();

  const [prompt, setPrompt] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [preview, setPreview] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) {
      setPrompt("");
      setPreview("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const generate = async (): Promise<void> => {
    if (!project || !prompt.trim()) return;
    setBusy(true);
    setError(null);
    setPreview("");
    try {
      const res = await fetch("/api/ai/generate-rfc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          workspaceId: workspace.workspaceId,
          projectId: project.projectId,
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as { message?: string; error?: string };
        setError(data.message ?? data.error ?? "Generation failed.");
        setBusy(false);
        return;
      }

      const documentId = res.headers.get("X-Document-Id");
      // Stream the body for a live preview.
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          setPreview((p) => (p + decoder.decode(value, { stream: true })).slice(-4000));
        }
      }

      qc.invalidateQueries({
        queryKey: queryKeys.documents.tree(project.projectId),
      });
      if (documentId) {
        setOpen(false);
        router.push(
          `/${workspace.workspaceSlug}/${project.projectSlug}/specs/${documentId}`,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Generate RFC from prompt
          </DialogTitle>
          <DialogDescription>
            Describe the proposal — we&apos;ll draft a full RFC (problem,
            requirements, architecture, diagrams, API sketch, risks, alternatives,
            acceptance criteria) and stream it into a new spec.
          </DialogDescription>
        </DialogHeader>

        {!project ? (
          <p className="text-sm text-muted-foreground">
            Open a project to generate an RFC.
          </p>
        ) : (
          <>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="An RFC for adding webhook delivery with retries and signing…"
              disabled={busy}
              className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {preview ? (
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                {preview}
              </pre>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={busy || !prompt.trim()} onClick={() => void generate()}>
                {busy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Generating…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" /> Generate
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
