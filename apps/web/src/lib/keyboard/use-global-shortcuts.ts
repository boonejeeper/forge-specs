"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { usePathname, useRouter } from "next/navigation";

import { useUiStore } from "@/lib/store/ui";
import { useKeyboardRegistry, type Shortcut } from "./registry";

/**
 * Registers the always-available global shortcuts. Mount once in the app shell.
 * Returns nothing; cleanup unregisters on unmount.
 */
export function useGlobalShortcuts() {
  const register = useKeyboardRegistry((s) => s.register);
  const { setTheme, resolvedTheme } = useTheme();
  const router = useRouter();
  const pathname = usePathname();

  // Stable refs so handlers always see current store/theme without re-registering.
  const setThemeRef = React.useRef(setTheme);
  const resolvedThemeRef = React.useRef(resolvedTheme);
  const routerRef = React.useRef(router);
  const pathnameRef = React.useRef(pathname);
  setThemeRef.current = setTheme;
  resolvedThemeRef.current = resolvedTheme;
  routerRef.current = router;
  pathnameRef.current = pathname;

  React.useEffect(() => {
    const ui = useUiStore.getState;

    const shortcuts: Shortcut[] = [
      {
        id: "command-palette",
        keys: ["$mod+k"],
        scope: "global",
        label: "Open command palette",
        group: "General",
        showInPalette: false,
        handler: () => ui().toggleCommandPalette(),
      },
      {
        id: "shortcut-help",
        keys: ["?"],
        scope: "global",
        label: "Show keyboard shortcuts",
        group: "General",
        handler: () => ui().toggleShortcutHelp(),
      },
      {
        id: "toggle-theme",
        keys: ["$mod+shift+l"],
        scope: "global",
        label: "Toggle dark mode",
        group: "General",
        handler: () =>
          setThemeRef.current(
            resolvedThemeRef.current === "dark" ? "light" : "dark",
          ),
      },
      {
        id: "toggle-sidebar",
        keys: ["$mod+b"],
        scope: "app",
        label: "Toggle sidebar",
        group: "Navigation",
        handler: () => ui().toggleSidebar(),
      },
      {
        id: "toggle-ai-panel",
        keys: ["$mod+j"],
        scope: "app",
        label: "Toggle AI assistant",
        group: "Navigation",
        handler: () => ui().toggleAiPanel(),
      },
      {
        id: "go-search",
        keys: ["g s"],
        scope: "app",
        label: "Search specs",
        group: "Navigation",
        handler: () => {
          // First path segment is the workspace slug for any in-app route.
          const slug = (pathnameRef.current ?? "").split("/").filter(Boolean)[0];
          if (slug) routerRef.current.push(`/${slug}/search`);
        },
      },
      {
        id: "go-home",
        keys: ["g d"],
        scope: "app",
        label: "Go to home",
        group: "Navigation",
        handler: () => routerRef.current.push("/home"),
      },
      {
        id: "go-inbox",
        keys: ["g n"],
        scope: "app",
        label: "Go to inbox",
        group: "Navigation",
        handler: () => {
          const slug = (pathnameRef.current ?? "").split("/").filter(Boolean)[0];
          if (slug) routerRef.current.push(`/${slug}/inbox`);
        },
      },
      {
        id: "go-activity",
        keys: ["g y"],
        scope: "app",
        label: "Go to activity",
        group: "Navigation",
        handler: () => {
          const slug = (pathnameRef.current ?? "").split("/").filter(Boolean)[0];
          if (slug) routerRef.current.push(`/${slug}/activity`);
        },
      },
      {
        id: "go-templates",
        keys: ["g t"],
        scope: "app",
        label: "Go to templates",
        group: "Navigation",
        handler: () => {
          const slug = (pathnameRef.current ?? "").split("/").filter(Boolean)[0];
          if (slug) routerRef.current.push(`/${slug}/templates`);
        },
      },
      {
        id: "go-graph",
        keys: ["g g"],
        scope: "app",
        label: "Go to dependency graph",
        group: "Navigation",
        handler: () => {
          const slug = (pathnameRef.current ?? "").split("/").filter(Boolean)[0];
          if (slug) routerRef.current.push(`/${slug}/graph`);
        },
      },
      {
        id: "go-settings",
        keys: ["g ,"],
        scope: "app",
        label: "Go to workspace settings",
        group: "Navigation",
        handler: () => {
          const slug = (pathnameRef.current ?? "").split("/").filter(Boolean)[0];
          if (slug) routerRef.current.push(`/${slug}/settings`);
        },
      },
      {
        id: "go-history",
        keys: ["g h"],
        scope: "app",
        label: "View version history",
        group: "Navigation",
        // Only meaningful on a spec route (/ws/proj/specs/specId/…).
        when: () => {
          const segs = (pathnameRef.current ?? "").split("/").filter(Boolean);
          return segs.length >= 4 && segs[2] === "specs";
        },
        handler: () => {
          const segs = (pathnameRef.current ?? "").split("/").filter(Boolean);
          if (segs.length >= 4 && segs[2] === "specs") {
            routerRef.current.push(
              `/${segs[0]}/${segs[1]}/specs/${segs[3]}/history`,
            );
          }
        },
      },
      {
        id: "generate-rfc",
        keys: ["g r"],
        scope: "app",
        label: "Generate RFC from prompt",
        group: "AI",
        handler: () => ui().setGenerateRfcOpen(true),
      },
      {
        id: "generate-architecture",
        keys: ["g a"],
        scope: "app",
        label: "Generate complete architecture",
        group: "AI",
        handler: () => {
          // Needs a project route; the segments are /ws/proj/...
          const segs = (pathnameRef.current ?? "").split("/").filter(Boolean);
          if (segs.length >= 2) {
            routerRef.current.push(`/${segs[0]}/${segs[1]}/generate`);
          }
        },
      },
    ];

    const unregisters = shortcuts.map((s) => register(s));
    return () => unregisters.forEach((u) => u());
  }, [register]);
}
