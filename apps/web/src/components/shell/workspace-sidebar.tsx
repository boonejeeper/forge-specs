"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  LayoutTemplate,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
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
 *
 * Collapses to a 48px rail (icon-only) when `sidebarCollapsed` is set (⌘B or
 * the header chevron). Mobile drawer is unaffected — it's a separate code path.
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
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  // Close the mobile drawer on navigation.
  React.useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname, setMobileNavOpen]);

  const renderContent = (railed: boolean) => (
    <>
      <div
        className={cn(
          "flex items-center gap-1 border-b p-2",
          railed ? "justify-center" : "justify-between",
        )}
      >
        <WorkspaceSwitcher
          workspaces={workspaces}
          currentSlug={workspaceSlug}
          collapsed={railed}
        />
        {railed ? null : (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="Collapse sidebar (⌘B)"
            title="Collapse sidebar (⌘B)"
            onClick={toggleSidebar}
          >
            <PanelLeftClose className="size-4" />
          </Button>
        )}
      </div>

      <ProjectSidebar collapsed={railed} />

      <nav
        className={cn(
          "space-y-0.5 border-t p-2",
          railed && "flex flex-col items-center",
        )}
      >
        {railed ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="Expand sidebar (⌘B)"
            title="Expand sidebar (⌘B)"
            onClick={toggleSidebar}
          >
            <PanelLeftOpen className="size-4" />
          </Button>
        ) : null}
        {links.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              title={railed ? label : undefined}
              aria-label={railed ? label : undefined}
              className={cn(
                "flex items-center rounded-md text-sm font-medium transition-colors",
                railed
                  ? "size-8 justify-center"
                  : "gap-3 px-3 py-1.5",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              {railed ? null : <span>{label}</span>}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      {/* Desktop: persistent sidebar (md+). Collapses to a 48px rail. */}
      <aside
        className={cn(
          "hidden shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-150 md:flex",
          collapsed ? "w-12" : "w-64",
        )}
      >
        {renderContent(collapsed)}
      </aside>

      {/* Mobile: off-canvas drawer (<md), toggled from the topbar. Always shown
          fully expanded; the rail state is desktop-only. */}
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
            {renderContent(false)}
          </aside>
        </div>
      ) : null}
    </>
  );
}
