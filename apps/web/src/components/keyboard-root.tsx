"use client";

import { KeyboardListener } from "@/lib/keyboard/listener";
import { useGlobalShortcuts } from "@/lib/keyboard/use-global-shortcuts";
import { CommandPalette } from "@/components/command-palette";
import { ShortcutHelp } from "@/components/shortcut-help";

/**
 * Wires the keyboard system into the app: registers global shortcuts, mounts
 * the single global listener, and renders the palette + help overlay (both
 * driven by the same registry).
 */
export function KeyboardRoot() {
  useGlobalShortcuts();
  return (
    <>
      <KeyboardListener />
      <CommandPalette />
      <ShortcutHelp />
    </>
  );
}
