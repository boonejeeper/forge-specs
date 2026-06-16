"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DocumentType } from "@forgespecs/db";
import { DOC_TYPE_ORDER } from "@forgespecs/core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useWorkspace, useProject } from "@/lib/context/workspace-context";
import { useCreateDocument } from "@/lib/query/use-documents";

export function CreateDocumentDialog({
  open,
  onOpenChange,
  defaultType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType?: DocumentType;
}) {
  const router = useRouter();
  const { workspaceId, workspaceSlug } = useWorkspace();
  const { projectId, projectSlug } = useProject();
  const create = useCreateDocument({ workspaceId, projectId });

  const [type, setType] = React.useState<DocumentType>(
    defaultType ?? DocumentType.RFC,
  );
  const [title, setTitle] = React.useState("");

  React.useEffect(() => {
    if (open && defaultType) setType(defaultType);
  }, [open, defaultType]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    const doc = await create.mutateAsync({ type, title: t });
    onOpenChange(false);
    setTitle("");
    router.push(`/${workspaceSlug}/${projectSlug}/specs/${doc.id}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New document</DialogTitle>
          <DialogDescription>
            Pick a type and give it a title. The editor arrives in M2.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="doc-type">Type</Label>
            <div className="grid grid-cols-3 gap-2">
              {DOC_TYPE_ORDER.map((m) => (
                <button
                  key={m.type}
                  type="button"
                  onClick={() => setType(m.type)}
                  className={cn(
                    "rounded-md border px-2 py-2 text-xs font-medium transition-colors",
                    type === m.type
                      ? "border-primary bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {m.singular}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-title">Title</Label>
            <Input
              id="doc-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Authentication architecture"
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!title.trim()}>
              Create document
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
