"use client";

import { PanelLeft, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/kbd";
import { ThemeToggle } from "@/components/theme-toggle";
import { InboxButton } from "@/components/shell/inbox-button";
import { useUiStore } from "@/lib/store/ui";

export function Topbar() {
  const openMobileNav = useUiStore((s) => s.setMobileNavOpen);
  const openPalette = useUiStore((s) => s.setCommandPaletteOpen);

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      {/* Opens the off-canvas nav on mobile; the sidebar is always visible at md+. */}
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open navigation"
        className="md:hidden"
        onClick={() => openMobileNav(true)}
      >
        <PanelLeft className="size-4" />
      </Button>

      <button
        type="button"
        onClick={() => openPalette(true)}
        className="flex h-9 flex-1 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-accent/50 sm:max-w-sm"
      >
        <Search className="size-4" />
        <span>Search or jump to…</span>
        <span className="ml-auto flex items-center gap-1">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <InboxButton />
        <ThemeToggle />
      </div>
    </header>
  );
}
