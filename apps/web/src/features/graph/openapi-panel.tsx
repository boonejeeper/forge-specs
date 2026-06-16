"use client";

import dynamic from "next/dynamic";
import { FileJson } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

/**
 * Client entry for the OpenAPI explorer. Scalar is heavy and client-only, so the
 * inner renderer is dynamic-imported with ssr:false — keeping it off the editor
 * route and the server render path.
 */
const OpenApiExplorer = dynamic(() => import("./OpenApiExplorer"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  ),
});

export function OpenApiPanel({ source }: { source: string | null }) {
  if (!source) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={FileJson}
          title="No OpenAPI spec found"
          description="Add an OpenAPI 3.1 spec as a YAML or JSON code block to this API document to explore it here."
        />
      </div>
    );
  }
  return (
    <div className="h-full w-full">
      <OpenApiExplorer content={source} />
    </div>
  );
}
