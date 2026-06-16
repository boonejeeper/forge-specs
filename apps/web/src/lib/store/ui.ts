"use client";

import { create } from "zustand";

/**
 * Tiny client-only UI store. Holds ephemeral interface state that is NOT a
 * server fact (those belong in TanStack Query) and NOT convergent content
 * (that belongs in Yjs). Examples: palette open, sidebar collapsed, which side
 * panels are visible, shortcut-help overlay.
 */
interface UiState {
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;

  shortcutHelpOpen: boolean;
  setShortcutHelpOpen: (open: boolean) => void;
  toggleShortcutHelp: () => void;

  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

  /** Mobile (<md) off-canvas nav drawer. Separate from desktop collapse. */
  mobileNavOpen: boolean;
  setMobileNavOpen: (open: boolean) => void;

  aiPanelOpen: boolean;
  setAiPanelOpen: (open: boolean) => void;
  toggleAiPanel: () => void;

  /** "Generate RFC from prompt" dialog (command palette + button entry). */
  generateRfcOpen: boolean;
  setGenerateRfcOpen: (open: boolean) => void;

  /**
   * AI context published by the active editor so the (parallel-route) AI panel
   * — which persists across spec navigation — knows the current document and
   * current selection to auto-assemble context against. This is ephemeral UI
   * wiring, not a server fact, so it lives here rather than in Query/Yjs.
   */
  aiContext: AiContext;
  setAiContext: (ctx: Partial<AiContext>) => void;
}

export interface AiContext {
  documentId: string | null;
  /** Slugs for building the project scope passed to the AI routes (RBAC). */
  workspaceId: string | null;
  projectId: string | null;
  /** Current selection text (drives focused retrieval / refine). */
  selectionText: string | null;
}

export const useUiStore = create<UiState>((set) => ({
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () =>
    set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),

  shortcutHelpOpen: false,
  setShortcutHelpOpen: (open) => set({ shortcutHelpOpen: open }),
  toggleShortcutHelp: () =>
    set((s) => ({ shortcutHelpOpen: !s.shortcutHelpOpen })),

  sidebarCollapsed: false,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  mobileNavOpen: false,
  setMobileNavOpen: (open) => set({ mobileNavOpen: open }),

  aiPanelOpen: false,
  setAiPanelOpen: (open) => set({ aiPanelOpen: open }),
  toggleAiPanel: () => set((s) => ({ aiPanelOpen: !s.aiPanelOpen })),

  generateRfcOpen: false,
  setGenerateRfcOpen: (open) => set({ generateRfcOpen: open }),

  aiContext: {
    documentId: null,
    workspaceId: null,
    projectId: null,
    selectionText: null,
  },
  setAiContext: (ctx) =>
    set((s) => ({ aiContext: { ...s.aiContext, ...ctx } })),
}));
