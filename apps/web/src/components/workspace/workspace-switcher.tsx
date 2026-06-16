"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateWorkspaceDialog } from "@/components/workspace/create-workspace-dialog";
import type { WorkspaceSummary } from "@/lib/data/workspaces";

/**
 * Workspace switcher shown at the top of the sidebar. Lists all workspaces the
 * user belongs to and routes to the chosen one. "New workspace" opens the
 * create dialog (optimistic create + redirect).
 */
export function WorkspaceSwitcher({
  workspaces,
  currentSlug,
}: {
  workspaces: WorkspaceSummary[];
  currentSlug: string;
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = React.useState(false);
  const current =
    workspaces.find((w) => w.slug === currentSlug) ?? workspaces[0];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto w-full justify-start gap-2 px-2 py-2"
          >
            <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary text-[10px] font-bold text-primary-foreground">
              {current ? initials(current.name) : "FS"}
            </span>
            <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
              {current?.name ?? "Select workspace"}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              onSelect={() => router.push(`/${w.slug}`)}
            >
              <span className="flex size-5 items-center justify-center rounded bg-muted text-[10px] font-semibold">
                {initials(w.name)}
              </span>
              <span className="flex-1 truncate">{w.name}</span>
              <Check
                className={cn(
                  "size-4",
                  w.slug === current?.slug ? "opacity-100" : "opacity-0",
                )}
              />
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus className="size-4" />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} />
    </>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}
