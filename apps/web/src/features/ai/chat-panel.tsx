"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, getToolName } from "ai";
import type { UIMessage } from "ai";
import {
  Bot,
  Send,
  Check,
  X,
  Sparkles,
  ArrowRight,
  Compass,
  AlignLeft,
  Type,
  Expand,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/lib/store/ui";
import { proposeEditSuggestion } from "@/lib/actions/ai";
import { createProject } from "@/lib/actions/projects";
import { createDocument, changeDocumentStatus } from "@/lib/actions/documents";
import { startRepoIngest } from "@/lib/actions/ingest";
import type { DocumentType, DocumentStatus } from "@forgespecs/db";
import type { Scope } from "@forgespecs/core";

/**
 * AI chat side panel. Mounted at the app-shell layer (`(app)/layout.tsx`) so
 * it persists across ALL signed-in navigation — workspace landing, activity,
 * inbox, settings, home, welcome, doc routes — not just within a project.
 *
 * Context auto-loads from the UI store (`aiContext`): `AiContextSync` pushes
 * the current workspace/project from the URL, and the active editor publishes
 * documentId + selection. The server assembles graph+semantic context against
 * whichever pieces are present (workspace-only is fine — no doc retrieval).
 *
 * Tool confirmation: when the model calls `proposeEdit` (a client-handled tool —
 * no server execute), we render a confirmation card. On confirm we route through
 * `proposeEditSuggestion` (→ M5 createSuggestion) and report the result back to
 * the model via addToolResult so the conversation continues coherently.
 */
export function ChatPanel() {
  const aiPanelOpen = useUiStore((s) => s.aiPanelOpen);
  const aiContext = useUiStore((s) => s.aiContext);

  // Keep the latest context in a ref so the transport body always sends current
  // values without re-creating the chat on every selection change.
  const ctxRef = React.useRef(aiContext);
  ctxRef.current = aiContext;

  const transport = React.useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat",
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: {
            messages,
            documentId: ctxRef.current.documentId,
            selectionText: ctxRef.current.selectionText,
            workspaceId: ctxRef.current.workspaceId,
            projectId: ctxRef.current.projectId,
            ...body,
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, addToolResult, error } = useChat({
    transport,
  });
  const [input, setInput] = React.useState("");
  const router = useRouter();

  if (!aiPanelOpen) return null;

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const text = input.trim();
    if (!text || status === "streaming") return;
    void sendMessage({ text });
    setInput("");
  };

  // Project scope when we have both ids; workspace scope when only the workspace
  // id is set. Lets the panel work on workspace-level routes (where the bot can
  // still navigate, search, or createProject) — the chat route already handles
  // workspace-only scope via the existing RBAC check.
  const scope: Scope | null =
    aiContext.workspaceId && aiContext.projectId
      ? {
          kind: "project",
          workspaceId: aiContext.workspaceId,
          projectId: aiContext.projectId,
        }
      : aiContext.workspaceId
        ? { kind: "workspace", workspaceId: aiContext.workspaceId }
        : null;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-card">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="size-4 text-primary" />
        <span className="text-sm font-medium">AI assistant</span>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Ask about this spec, search the repository, or request an edit. I
              propose changes as suggestions you approve.
            </p>
            <button
              type="button"
              onClick={() => void sendMessage({ text: "What should I do next?" })}
              className="flex w-full items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-left text-sm transition-colors hover:bg-primary/10"
            >
              <Compass className="size-4 text-primary" />
              <span className="font-medium">What should I do next?</span>
              <span className="ml-auto text-xs text-muted-foreground">
                Guided
              </span>
            </button>
            {aiContext.documentId ? (
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  On this document
                </p>
                <QuickAction
                  icon={AlignLeft}
                  label="Format this document"
                  onClick={() =>
                    void sendMessage({
                      text: "Format this entire document for consistency: heading hierarchy, list style, code-block language tags, terminology. Propose edits block by block.",
                    })
                  }
                />
                <QuickAction
                  icon={Expand}
                  label="Expand the concepts"
                  onClick={() =>
                    void sendMessage({
                      text: "Read this document and expand any thin sections with concrete detail. Propose edits block by block.",
                    })
                  }
                />
                <QuickAction
                  icon={Type}
                  label="Refactor terminology"
                  onClick={() =>
                    void sendMessage({
                      text: "Identify inconsistent terminology in this document and propose unified replacements as edits.",
                    })
                  }
                />
              </div>
            ) : null}
          </div>
        ) : null}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            documentId={aiContext.documentId}
            scope={scope}
            onPropEditResult={(toolCallId, output) =>
              void addToolResult({
                tool: "proposeEdit",
                toolCallId,
                output,
              })
            }
            onPropActionResult={(toolCallId, output) =>
              void addToolResult({
                tool: "proposeAction",
                toolCallId,
                output,
              })
            }
            navigate={(href) => router.push(href)}
          />
        ))}
        {error ? (
          <p className="text-sm text-destructive">
            {error.message || "Something went wrong."}
          </p>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="border-t p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e);
              }
            }}
            rows={2}
            placeholder="Ask the AI…"
            className="min-h-0 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || status === "streaming"}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </form>
    </aside>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md border bg-background px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent"
    >
      <Icon className="size-3.5 text-muted-foreground" />
      <span>{label}</span>
    </button>
  );
}

function MessageBubble({
  message,
  documentId,
  scope,
  onPropEditResult,
  onPropActionResult,
  navigate,
}: {
  message: UIMessage;
  documentId: string | null;
  scope: Scope | null;
  onPropEditResult: (toolCallId: string, output: unknown) => void;
  onPropActionResult: (toolCallId: string, output: unknown) => void;
  navigate: (href: string) => void;
}) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex flex-col gap-1", isUser ? "items-end" : "items-start")}>
      {!isUser ? (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Bot className="size-3.5" /> AI
        </div>
      ) : null}
      {message.parts.map((part, i) => {
        if (part.type === "text") {
          return (
            <div
              key={i}
              className={cn(
                "max-w-full whitespace-pre-wrap rounded-md px-3 py-2 text-sm",
                isUser ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              {part.text}
            </div>
          );
        }
        // proposeEdit confirmation card (client-handled tool).
        if (isToolUIPart(part) && getToolName(part) === "proposeEdit") {
          return (
            <ProposeEditCard
              key={i}
              part={part}
              documentId={documentId}
              scope={scope}
              onResult={onPropEditResult}
            />
          );
        }
        // proposeAction confirmation card (guidance-mode tool).
        if (isToolUIPart(part) && getToolName(part) === "proposeAction") {
          return (
            <ProposeActionCard
              key={i}
              part={part}
              scope={scope}
              onResult={onPropActionResult}
              navigate={navigate}
            />
          );
        }
        return null;
      })}
    </div>
  );
}

interface ProposeEditInputShape {
  documentId?: string;
  blockId?: string;
  proposedText?: string;
  rationale?: string;
}

function ProposeEditCard({
  part,
  documentId,
  scope,
  onResult,
}: {
  part: { toolCallId?: string; state?: string; input?: unknown; output?: unknown };
  documentId: string | null;
  scope: Scope | null;
  onResult: (toolCallId: string, output: unknown) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<null | "created" | "dismissed" | "error">(
    part.output ? "created" : null,
  );
  const input = (part.input ?? {}) as ProposeEditInputShape;
  const toolCallId = part.toolCallId ?? "";
  const targetDoc = input.documentId ?? documentId ?? null;

  const confirm = async (): Promise<void> => {
    if (!targetDoc || !scope || !input.proposedText) {
      setDone("error");
      onResult(toolCallId, { error: "Missing document or permission scope." });
      return;
    }
    setBusy(true);
    try {
      const res = await proposeEditSuggestion({
        documentId: targetDoc,
        proposedText: input.proposedText,
        blockId: input.blockId,
        rationale: input.rationale ?? null,
        scope,
      });
      setDone("created");
      onResult(toolCallId, { suggestionId: res.id, status: "created" });
    } catch (err) {
      setDone("error");
      onResult(toolCallId, {
        error: err instanceof Error ? err.message : "Failed to create suggestion.",
      });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = (): void => {
    setDone("dismissed");
    onResult(toolCallId, { status: "dismissed" });
  };

  return (
    <div className="w-full rounded-md border bg-background p-3 text-sm">
      <div className="mb-1 flex items-center gap-1 font-medium">
        <Sparkles className="size-3.5 text-primary" />
        Proposed edit
      </div>
      {input.rationale ? (
        <p className="mb-1 text-xs text-muted-foreground">{input.rationale}</p>
      ) : null}
      <pre className="mb-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted px-2 py-1 text-xs">
        {input.proposedText ?? ""}
      </pre>
      {done === "created" ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">
          Suggestion created — review it in the document panel.
        </p>
      ) : done === "dismissed" ? (
        <p className="text-xs text-muted-foreground">Dismissed.</p>
      ) : done === "error" ? (
        <p className="text-xs text-destructive">Could not create suggestion.</p>
      ) : (
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={busy} onClick={() => void confirm()}>
            <Check className="size-3.5" /> Create suggestion
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={dismiss}>
            <X className="size-3.5" /> Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

// ── proposeAction card (guidance-mode action confirmation) ──────────────────

interface ProposeActionPart {
  toolCallId?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
}

type ProposeActionInputShape =
  | {
      kind: "createProject";
      rationale: string;
      confidence?: "high" | "medium" | "low";
      name: string;
    }
  | {
      kind: "createDocument";
      rationale: string;
      confidence?: "high" | "medium" | "low";
      type: DocumentType;
      title: string;
    }
  | {
      kind: "startRepoIngest";
      rationale: string;
      confidence?: "high" | "medium" | "low";
      source:
        | { kind: "LOCAL"; path: string }
        | { kind: "GITHUB"; ref: string; branch?: string };
    }
  | {
      kind: "changeDocumentStatus";
      rationale: string;
      confidence?: "high" | "medium" | "low";
      documentId: string;
      status: DocumentStatus;
    }
  | {
      kind: "navigate";
      rationale: string;
      confidence?: "high" | "medium" | "low";
      href: string;
      label: string;
    };

function ProposeActionCard({
  part,
  scope,
  onResult,
  navigate,
}: {
  part: ProposeActionPart;
  scope: Scope | null;
  onResult: (toolCallId: string, output: unknown) => void;
  navigate: (href: string) => void;
}) {
  const [busy, setBusy] = React.useState(false);
  const [done, setDone] = React.useState<null | "ok" | "dismissed" | "error">(
    part.output ? "ok" : null,
  );
  const [errMsg, setErrMsg] = React.useState<string | null>(null);
  const rawInput = (part.input ?? {}) as Partial<ProposeActionInputShape>;
  const toolCallId = part.toolCallId ?? "";

  if (!rawInput.kind) return null;
  const input = rawInput as ProposeActionInputShape;

  const confidence = input.confidence ?? "high";
  const label = actionLabel(input);

  const execute = async (): Promise<void> => {
    setBusy(true);
    setErrMsg(null);
    try {
      const result = await runAction(input, scope, navigate);
      setDone("ok");
      onResult(toolCallId, { status: "executed", ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Action failed.";
      setErrMsg(msg);
      setDone("error");
      onResult(toolCallId, { status: "error", error: msg });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = (): void => {
    setDone("dismissed");
    onResult(toolCallId, { status: "dismissed" });
  };

  return (
    <div className="w-full rounded-md border bg-background p-3 text-sm">
      <div className="mb-1 flex items-center gap-1 font-medium">
        <ArrowRight className="size-3.5 text-primary" />
        Suggested: {label}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{input.rationale}</p>
      {confidence === "low" ? (
        <p className="mb-2 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
          This is a guess — confirm only if it matches your intent.
        </p>
      ) : null}
      {done === "ok" ? (
        <p className="text-xs text-emerald-600 dark:text-emerald-400">Done.</p>
      ) : done === "dismissed" ? (
        <p className="text-xs text-muted-foreground">Dismissed.</p>
      ) : done === "error" ? (
        <p className="text-xs text-destructive">{errMsg ?? "Failed."}</p>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={busy || !canExecute(input, scope)}
            onClick={() => void execute()}
          >
            <Check className="size-3.5" /> Accept
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={dismiss}
          >
            <X className="size-3.5" /> Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

function actionLabel(input: ProposeActionInputShape): string {
  switch (input.kind) {
    case "createProject":
      return `Create project "${input.name}"`;
    case "createDocument":
      return `Create ${input.type} "${input.title}"`;
    case "startRepoIngest":
      return input.source.kind === "LOCAL"
        ? `Ingest local path ${input.source.path}`
        : `Ingest GitHub ${input.source.ref}`;
    case "changeDocumentStatus":
      return `Move document to ${input.status}`;
    case "navigate":
      return input.label;
  }
}

function canExecute(input: ProposeActionInputShape, scope: Scope | null): boolean {
  if (input.kind === "navigate") return true;
  if (input.kind === "createProject") {
    return scope?.kind === "workspace" || scope?.kind === "project";
  }
  return scope?.kind === "project";
}

async function runAction(
  input: ProposeActionInputShape,
  scope: Scope | null,
  navigate: (href: string) => void,
): Promise<Record<string, unknown>> {
  switch (input.kind) {
    case "navigate":
      navigate(input.href);
      return { navigated: input.href };
    case "createProject": {
      if (scope?.kind !== "workspace" && scope?.kind !== "project") {
        throw new Error("Open a workspace first.");
      }
      const res = await createProject({
        workspaceId: scope.workspaceId,
        name: input.name,
      });
      return { projectId: res.id, projectSlug: res.slug };
    }
    case "createDocument": {
      if (scope?.kind !== "project") {
        throw new Error("Open a project first.");
      }
      const res = await createDocument({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        type: input.type,
        title: input.title,
      });
      return { documentId: res.id, slug: res.slug };
    }
    case "startRepoIngest": {
      if (scope?.kind !== "project") {
        throw new Error("Open a project first.");
      }
      const res = await startRepoIngest({
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        source: input.source,
      });
      return { jobId: res.jobId };
    }
    case "changeDocumentStatus": {
      if (scope?.kind !== "project") {
        throw new Error("Open a project first.");
      }
      const res = await changeDocumentStatus({
        documentId: input.documentId,
        status: input.status,
        scope,
      });
      return { documentId: res.id, status: res.status };
    }
  }
}
