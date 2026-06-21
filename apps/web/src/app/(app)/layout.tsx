import { KeyboardRoot } from "@/components/keyboard-root";
import { AiPanelToggle } from "@/features/ai/ai-panel-toggle";
import { AiContextSync } from "@/features/ai/ai-context-sync";
import { ChatPanel } from "@/features/ai/chat-panel";

/**
 * App chrome shared by every signed-in route. The left sidebar + topbar are
 * provided by the workspace layout (`[workspaceSlug]/layout.tsx`) because they
 * are workspace-scoped; this layer only owns the full-height frame, the global
 * keyboard system (palette, shortcuts, help overlay), and the AI chat panel.
 *
 * The chat panel is mounted here so it is reachable from EVERY signed-in route
 * (workspace landing, activity/inbox/settings, even /home and /welcome — not
 * just project routes). It self-hides on `!aiPanelOpen`, so mounting costs
 * nothing visually until the user opens it.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden">
      {children}
      <ChatPanel />
      <AiPanelToggle />
      <AiContextSync />
      <KeyboardRoot />
    </div>
  );
}
