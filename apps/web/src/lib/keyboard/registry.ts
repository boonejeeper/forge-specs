"use client";

import { create } from "zustand";

/**
 * Central keyboard shortcut registry. Single source of truth consumed by BOTH
 * the global key listener and the command palette, so a shortcut is defined
 * exactly once.
 *
 * `keys` uses a tinykeys-style notation:
 *   - chords joined by " " (space): "g i" means press g then i
 *   - modifiers joined by "+": "$mod+k" ($mod = ⌘ on mac, Ctrl elsewhere)
 *   - examples: "$mod+k", "g i", "?", "$mod+shift+p"
 */
export type ShortcutScope = "global" | "app" | "editor";

export interface Shortcut {
  id: string;
  /** Binding(s) — may provide alternates. */
  keys: string[];
  scope: ShortcutScope;
  /** Human label, shown in palette & help overlay. */
  label: string;
  /** Grouping for palette/help sections. */
  group: string;
  /** Optional predicate gating when the shortcut is active. */
  when?: () => boolean;
  handler: (e: KeyboardEvent | null) => void;
  /** If false, the shortcut is hidden from the command palette. */
  showInPalette?: boolean;
}

interface RegistryState {
  shortcuts: Map<string, Shortcut>;
  register: (shortcut: Shortcut) => () => void;
  unregister: (id: string) => void;
  list: () => Shortcut[];
}

export const useKeyboardRegistry = create<RegistryState>((set, get) => ({
  shortcuts: new Map(),

  register: (shortcut) => {
    set((state) => {
      const next = new Map(state.shortcuts);
      next.set(shortcut.id, shortcut);
      return { shortcuts: next };
    });
    return () => get().unregister(shortcut.id);
  },

  unregister: (id) =>
    set((state) => {
      if (!state.shortcuts.has(id)) return state;
      const next = new Map(state.shortcuts);
      next.delete(id);
      return { shortcuts: next };
    }),

  list: () => [...get().shortcuts.values()],
}));

const IS_APPLE =
  typeof navigator !== "undefined" &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

/** Render a binding for display, e.g. "$mod+k" → "⌘ K". */
export function formatKeys(keys: string): string {
  return keys
    .split(" ")
    .map((chord) =>
      chord
        .split("+")
        .map((part) => {
          switch (part) {
            case "$mod":
              return IS_APPLE ? "⌘" : "Ctrl";
            case "shift":
              return IS_APPLE ? "⇧" : "Shift";
            case "alt":
              return IS_APPLE ? "⌥" : "Alt";
            case "ctrl":
              return "Ctrl";
            default:
              return part.length === 1 ? part.toUpperCase() : part;
          }
        })
        .join(IS_APPLE ? "" : "+"),
    )
    .join(" ");
}

/** Normalize a KeyboardEvent into a single "chord" token, e.g. "$mod+k". */
export function eventToChord(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push("$mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  // Don't emit a bare modifier as the key.
  if (!["meta", "control", "shift", "alt"].includes(key)) {
    parts.push(key);
  }
  return parts.join("+");
}
