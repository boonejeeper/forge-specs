"use client";

import * as React from "react";
import Link from "next/link";
import { Database, FileJson, Network, Plus, Sparkles, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SpecTree } from "@/components/document/spec-tree";
import { CreateDocumentDialog } from "@/components/document/create-document-dialog";
import { useUiStore } from "@/lib/store/ui";
import { useWorkspace, useProject } from "@/lib/context/workspace-context";

/**
 * The spec repository panel — a second column inside a project route holding
 * the type-grouped document tree plus a "new document" affordance.
 */
export function SpecTreePanel({ projectName }: { projectName: string }) {
  const [createOpen, setCreateOpen] = React.useState(false);
  const setGenerateRfcOpen = useUiStore((s) => s.setGenerateRfcOpen);
  const workspace = useWorkspace();
  const project = useProject();

  return (
    <div className="hidden w-72 shrink-0 flex-col border-r bg-background lg:flex">
      <div className="flex items-center justify-between border-b px-3 py-2.5">
        <span className="truncate text-sm font-semibold">{projectName}</span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="New document"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-1 border-b px-2 py-2">
        <Button
          variant="outline"
          size="sm"
          className="justify-start"
          asChild
        >
          <Link href={`/${workspace.workspaceSlug}/${project.projectSlug}/generate`}>
            <Wand2 className="size-4" /> Generate architecture
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="justify-start"
          onClick={() => setGenerateRfcOpen(true)}
        >
          <Sparkles className="size-4" /> Generate RFC from prompt
        </Button>
      </div>

      <nav className="flex flex-col gap-0.5 border-b px-2 py-2">
        {[
          { href: "graph", label: "Dependency graph", icon: Network },
          { href: "schema", label: "Schema / ERD", icon: Database },
          { href: "api", label: "API explorer", icon: FileJson },
        ].map((item) => (
          <Link
            key={item.href}
            href={`/${workspace.workspaceSlug}/${project.projectSlug}/${item.href}`}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <item.icon className="size-4" /> {item.label}
          </Link>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto p-2">
        <SpecTree />
      </div>

      <CreateDocumentDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
