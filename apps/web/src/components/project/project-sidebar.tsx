"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, ArchiveRestore, FolderOpen, MoreHorizontal, Pencil, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/lib/context/workspace-context";
import {
  useProjects,
  useRenameProject,
  useSetProjectArchived,
} from "@/lib/query/use-projects";
import { CreateProjectDialog } from "@/components/project/create-project-dialog";
import { RenameDialog } from "@/components/common/rename-dialog";
import type { ProjectSummary } from "@/lib/data/projects";

/**
 * Lists the workspace's projects in the sidebar. RSC-seeded into the Query
 * cache by the workspace layout, then client-interactive (create / rename /
 * archive). Active project is highlighted from the pathname.
 *
 * `collapsed` (driven by the workspace sidebar's rail state) renders an
 * icon-only list — initials per project, no nav/archive controls. The rail row
 * stays clickable so users can jump projects without expanding.
 */
export function ProjectSidebar({ collapsed = false }: { collapsed?: boolean }) {
  const { workspaceId, workspaceSlug } = useWorkspace();
  const pathname = usePathname();
  const { data: projects = [] } = useProjects(workspaceId);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [showArchived, setShowArchived] = React.useState(false);

  const visible = projects.filter((p) => showArchived || !p.archived);
  const archivedCount = projects.filter((p) => p.archived).length;

  if (collapsed) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 pt-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label="New project"
          title="New project"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" />
        </Button>
        <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-auto pt-1">
          {visible.map((p) => {
            const active = pathname.startsWith(`/${workspaceSlug}/${p.slug}`);
            return (
              <Link
                key={p.id}
                href={`/${workspaceSlug}/${p.slug}`}
                title={p.name}
                aria-label={p.name}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded text-[10px] font-semibold",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                  p.archived && "opacity-60",
                )}
              >
                {initials(p.name)}
              </Link>
            );
          })}
        </nav>
        <CreateProjectDialog
          workspaceId={workspaceId}
          open={createOpen}
          onOpenChange={setCreateOpen}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pb-1 pt-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Projects
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="New project"
          onClick={() => setCreateOpen(true)}
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <nav className="min-h-0 flex-1 space-y-0.5 overflow-auto px-2">
        {visible.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            No projects yet. Create one to get started.
          </p>
        ) : (
          visible.map((p) => (
            <ProjectRow
              key={p.id}
              project={p}
              workspaceSlug={workspaceSlug}
              workspaceId={workspaceId}
              active={pathname.startsWith(`/${workspaceSlug}/${p.slug}`)}
            />
          ))
        )}
        {archivedCount > 0 ? (
          <button
            type="button"
            className="mt-1 w-full px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowArchived((s) => !s)}
          >
            {showArchived
              ? "Hide archived"
              : `Show archived (${archivedCount})`}
          </button>
        ) : null}
      </nav>

      <CreateProjectDialog
        workspaceId={workspaceId}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function ProjectRow({
  project,
  workspaceSlug,
  workspaceId,
  active,
}: {
  project: ProjectSummary;
  workspaceSlug: string;
  workspaceId: string;
  active: boolean;
}) {
  const [renameOpen, setRenameOpen] = React.useState(false);
  const rename = useRenameProject(workspaceId);
  const setArchived = useSetProjectArchived(workspaceId);

  return (
    <div
      className={cn(
        "group flex items-center gap-1 rounded-md pr-1",
        active ? "bg-sidebar-accent" : "hover:bg-sidebar-accent/60",
      )}
    >
      <Link
        href={`/${workspaceSlug}/${project.slug}`}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-sm",
          project.archived && "opacity-60",
        )}
      >
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{project.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {project.documentCount}
        </span>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label="Project actions"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
            <Pencil className="size-4" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              setArchived.mutate({
                projectId: project.id,
                archived: !project.archived,
              })
            }
          >
            {project.archived ? (
              <>
                <ArchiveRestore className="size-4" />
                Unarchive
              </>
            ) : (
              <>
                <Archive className="size-4" />
                Archive
              </>
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename project"
        label="Project name"
        initialValue={project.name}
        onSubmit={(name) => rename.mutate({ projectId: project.id, name })}
      />
    </div>
  );
}
