"use client";

import * as React from "react";
import { AtSign } from "lucide-react";

import { mentionToken } from "@forgespecs/core";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { MentionTarget } from "@/features/editor/ForgeEditor";

/**
 * A small comment composer with @-mention support. Mentions are inserted as
 * `@[label](user:id)` / `@[label](agent:name)` tokens (see core `parseMentions`)
 * so the body stays a plain string yet carries resolvable targets — the comment
 * action turns each token into a Mention row + notification.
 */
export function CommentComposer({
  mentionTargets,
  onSubmit,
  submitting,
  placeholder = "Add a comment…",
  autoFocus,
  compact,
}: {
  mentionTargets: MentionTarget[];
  onSubmit: (body: string) => void;
  submitting?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  compact?: boolean;
}) {
  const [body, setBody] = React.useState("");
  const [showMentions, setShowMentions] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const targets = React.useMemo<MentionTarget[]>(
    () => [...mentionTargets, { id: "architect", label: "agent", kind: "agent" }],
    [mentionTargets],
  );

  const insertMention = (t: MentionTarget): void => {
    const token = mentionToken(
      t.kind === "agent" ? "agent" : "user",
      t.id,
      t.label,
    );
    setBody((b) => `${b}${b && !b.endsWith(" ") ? " " : ""}${token} `);
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  const submit = (): void => {
    const trimmed = body.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setBody("");
  };

  return (
    <div className="space-y-2">
      <textarea
        ref={textareaRef}
        value={body}
        autoFocus={autoFocus}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        rows={compact ? 2 : 3}
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex items-center gap-2">
        <div className="relative">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Mention someone"
            onClick={() => setShowMentions((s) => !s)}
          >
            <AtSign className="size-4" />
          </Button>
          {showMentions ? (
            <div className="absolute bottom-full z-20 mb-1 max-h-48 w-48 overflow-auto rounded-md border bg-popover p-1 shadow-md">
              {targets.length === 0 ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  No members
                </p>
              ) : (
                targets.map((t) => (
                  <button
                    key={`${t.kind}:${t.id}`}
                    type="button"
                    onClick={() => insertMention(t)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent",
                    )}
                  >
                    <span className="text-muted-foreground">@</span>
                    <span className="truncate">{t.label}</span>
                    {t.kind === "agent" ? (
                      <span className="ml-auto text-[10px] uppercase text-muted-foreground">
                        agent
                      </span>
                    ) : null}
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          className="ml-auto"
          disabled={submitting || !body.trim()}
          onClick={submit}
        >
          {submitting ? "Posting…" : "Comment"}
        </Button>
      </div>
    </div>
  );
}
