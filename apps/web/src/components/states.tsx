import * as React from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared loading / error states for consistent surfaces across the app (M11
 * polish). Empty states use the existing <EmptyState/>; these cover the other
 * two of the three states so every main surface has a uniform treatment.
 */

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      className={cn("size-5 animate-spin text-muted-foreground", className)}
      aria-hidden="true"
    />
  );
}

export function LoadingState({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-40 flex-col items-center justify-center gap-3 p-12 text-center",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <Spinner />
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-destructive/40 p-12 text-center",
        className,
      )}
      role="alert"
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
        <TriangleAlert className="size-6 text-destructive" />
      </div>
      <h3 className="text-sm font-medium">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
