"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";

/**
 * OpenAPI explorer powered by Scalar. Receives the spec source text extracted
 * from an API_SPEC document (the OpenAPI yaml block M7 seeds) and renders an
 * interactive reference. Scalar is a large bundle, so this module is only ever
 * loaded via next/dynamic (ssr:false) from the panel wrapper.
 */
export default function OpenApiExplorer({ content }: { content: string }) {
  return (
    <div className="h-full w-full overflow-auto">
      <ApiReferenceReact
        configuration={{
          content,
          // Match the app shell; Scalar reads the prefers-color-scheme too.
          hideDownloadButton: false,
          theme: "default",
        }}
      />
    </div>
  );
}
