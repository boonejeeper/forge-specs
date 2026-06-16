"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  LayoutTemplate,
  Network,
  Settings,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/context/workspace-context";
import { useUiStore } from "@/lib/store/ui";
import { WorkspaceSwitcher } from "@/components/workspace/workspace-switcher";
import { ProjectSidebar } from "@/components/project/project-sidebar";
import { Button } from "@/components/ui/button";
import type { WorkspaceSummary } from "@/lib/data/workspaces";

/**
 * The workspace-scoped left sidebar: workspace switcher on top, the project
 * list (with the spec tree shown on a project route) in the middle, and
 * workspace-level links at the bottom. Replaces the static M0 placeholder
 * sidebar inside a workspace.
 */
export function WorkspaceSidebar({
  workspaces,
}: {
  workspaces: WorkspaceSummary[];
}) {
  const { workspaceSlug } = useWorkspace();
  const pathname = usePathname();

  const links = [
    {
      href: `/${workspaceSlug}/activity`,
      label: "Activity",
      icon: Activity,
    },
    { href: `/${workspaceSlug}/graph`, label: "Graph", icon: Network },
    { href: `/${workspaceSlug}/agents`, label: "Agents", icon: Bot },
    {
      href: `/${workspaceSlug}/templates`,
      label: "Templates",
      icon: LayoutTemplate,
    },
    {
      href: `/${workspaceSlug}/settings`,
      label: "Settings",
      icon: Settings,
    },
  ];

  const mobileNavOpen = useUiStore((s) => s.mobileNavOpen);
  const setMobileNavOpen = useUiStore((s) => s.setMobileNavOpen);

  // Close the mobile drawer on navigation.
  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  const content = (
    <>
      <div className="border-b p-2">
        <WorkspaceSwitcher workspaces={workspaces} currentSlug={workspaceSlug} />
      </div>

      <ProjectSidebar />

      <nav className="space-y-0.5 border-t p-2">
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      {/* Desktop: persistent sidebar (md+). */}
      <aside className="hidden w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        {content}
      </aside>

      {/* Mobile: off-canvas drawer (<md), toggled from the topbar. */}
      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r bg-sidebar text-sidebar-foreground shadow-xl">
            <div className="flex items-center justify-end p-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close navigation"
                onClick={() => setMobileNavOpen(false)}
              >
                <X className="size-4" />
              </Button>
            </div>
            {content}
          </aside>
        </div>
      ) : null}
    </>
  );
}
