"use client";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, getToolName } from "ai";
import type { UIMessage } from "ai";
import { Bot, Send, Check, X, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/lib/store/ui";
import { proposeEditSuggestion } from "@/lib/actions/ai";
import type { Scope } from "@forgespecs/core";

/**
 * AI chat side panel. Lives in the `@panel` PARALLEL ROUTE so it persists across
 * spec navigation (its state survives route changes within the project segment).
 *
 * Context auto-loads from the UI store (`aiContext`): the active editor publishes
 * the current document id, scope, and selection there, and we forward them in
 * the request body so the server assembles graph+semantic context for the doc.
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

  if (!aiPanelOpen) return null;

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const text = input.trim();
    if (!text || status === "streaming") return;
    void sendMessage({ text });
    setInput("");
  };

  const scope: Scope | null =
    aiContext.workspaceId && aiContext.projectId
      ? {
          kind: "project",
          workspaceId: aiContext.workspaceId,
          projectId: aiContext.projectId,
        }
      : null;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-card">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        <Sparkles className="size-4 text-primary" />
        <span className="text-sm font-medium">AI assistant</span>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Ask about this spec, search the repository, or request an edit. I
            propose changes as suggestions you approve.
          </p>
        ) : null}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            documentId={aiContext.documentId}
            scope={scope}
            onToolResult={(toolCallId, output) =>
              void addToolResult({
                tool: "proposeEdit",
                toolCallId,
                output,
              })
            }
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

function MessageBubble({
  message,
  documentId,
  scope,
  onToolResult,
}: {
  message: UIMessage;
  documentId: string | null;
  scope: Scope | null;
  onToolResult: (toolCallId: string, output: unknown) => void;
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
              onResult={onToolResult}
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
