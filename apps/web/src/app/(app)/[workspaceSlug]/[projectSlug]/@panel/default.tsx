import { ChatPanel } from "@/features/ai/chat-panel";

/**
 * Default slot for the `@panel` parallel route. Next renders `default.tsx` for a
 * parallel slot when the current URL doesn't match a slot-specific page — which
 * is every spec sub-route here. Rendering the panel from the DEFAULT (and not a
 * URL-matched page) is exactly what makes the panel persist across spec
 * navigation without re-mounting: the slot subtree is stable while the children
 * slot changes. The panel hides itself unless `aiPanelOpen` (the panel toggle)
 * is set, so it costs nothing visually until invoked.
 */
export default function PanelDefault() {
  return <ChatPanel />;
}
