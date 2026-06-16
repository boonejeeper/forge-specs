import { KeyboardRoot } from "@/components/keyboard-root";
import { AiPanelToggle } from "@/features/ai/ai-panel-toggle";

/**
 * App chrome shared by every signed-in route. The left sidebar + topbar are
 * provided by the workspace layout (`[workspaceSlug]/layout.tsx`) because they
 * are workspace-scoped; this layer only owns the full-height frame and the
 * global keyboard system (palette, shortcuts, help overlay).
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-dvh overflow-hidden">
      {children}
      <AiPanelToggle />
      <KeyboardRoot />
    </div>
  );
}
