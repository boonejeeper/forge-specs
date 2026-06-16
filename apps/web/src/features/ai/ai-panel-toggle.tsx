"use client";

import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useUiStore } from "@/lib/store/ui";
import { cn } from "@/lib/utils";

/**
 * Floating toggle for the AI assistant panel (also bound to ⌘/Ctrl+J). Rendered
 * in the app shell so it is available on every signed-in route; the panel itself
 * is the `@panel` parallel route and reads `aiPanelOpen` from this same store.
 */
export function AiPanelToggle() {
  const open = useUiStore((s) => s.aiPanelOpen);
  const toggle = useUiStore((s) => s.toggleAiPanel);
  return (
    <Button
      type="button"
      size="icon"
      variant={open ? "default" : "outline"}
      onClick={toggle}
      aria-label="Toggle AI assistant (⌘J)"
      title="AI assistant (⌘J)"
      className={cn("fixed bottom-4 right-4 z-40 size-10 rounded-full shadow-md")}
    >
      <Sparkles className="size-4" />
    </Button>
  );
}
