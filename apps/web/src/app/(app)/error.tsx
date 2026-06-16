"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/states";

/** Error boundary for in-app route segments. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[app] route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <ErrorState
        title="This page hit an error"
        description="An unexpected error occurred while loading this view. You can retry, or head back and try again."
        action={
          <Button variant="outline" onClick={() => reset()}>
            Try again
          </Button>
        }
      />
    </div>
  );
}
