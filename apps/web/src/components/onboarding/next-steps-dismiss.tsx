"use client";

import * as React from "react";
import { X } from "lucide-react";

/**
 * Per-project dismiss wrapper for the NextStepsCard. Reads
 * `forge:nextsteps:${projectId}=hidden` from localStorage and renders nothing
 * when set. Adds a tiny ✕ button to the card's top-right so the user can hide it.
 *
 * Kept as a thin client wrapper so the parent server component remains a pure
 * projection of `OnboardingState` — no client state in the card itself.
 */
export function NextStepsDismiss({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const key = `forge:nextsteps:${projectId}`;
  const [hidden, setHidden] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    setHidden(window.localStorage.getItem(key) === "hidden");
  }, [key]);

  if (hidden === null) return null;
  if (hidden) return null;

  const dismiss = (): void => {
    window.localStorage.setItem(key, "hidden");
    setHidden(true);
  };

  return (
    <div className="relative">
      {children}
      <button
        type="button"
        aria-label="Hide get-started checklist"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}
