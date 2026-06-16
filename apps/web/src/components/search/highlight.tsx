"use client";

import * as React from "react";
import {
  SEARCH_HL_START as HL_START,
  SEARCH_HL_END as HL_END,
} from "@forgespecs/config";

/**
 * Render a ts_headline snippet safely. The snippet is PLAIN TEXT with matched
 * terms wrapped in the HL_START / HL_END sentinels (never HTML — see the search
 * query builder). We split on the sentinels and render the highlighted segments
 * as React <mark> elements, so document content is always treated as text and
 * can never inject markup. No dangerouslySetInnerHTML.
 */
export function Highlight({
  snippet,
  className,
}: {
  snippet: string;
  className?: string;
}) {
  const parts = React.useMemo(() => splitHighlights(snippet), [snippet]);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.mark ? (
          <mark
            key={i}
            className="rounded-sm bg-amber-500/30 px-0.5 text-foreground"
          >
            {p.text}
          </mark>
        ) : (
          <React.Fragment key={i}>{p.text}</React.Fragment>
        ),
      )}
    </span>
  );
}

interface Segment {
  text: string;
  mark: boolean;
}

function splitHighlights(snippet: string): Segment[] {
  const segments: Segment[] = [];
  let rest = snippet;
  while (rest.length > 0) {
    const start = rest.indexOf(HL_START);
    if (start === -1) {
      segments.push({ text: rest, mark: false });
      break;
    }
    if (start > 0) segments.push({ text: rest.slice(0, start), mark: false });
    const afterStart = rest.slice(start + HL_START.length);
    const end = afterStart.indexOf(HL_END);
    if (end === -1) {
      // Unbalanced sentinel — render the remainder as plain text.
      segments.push({ text: afterStart, mark: false });
      break;
    }
    segments.push({ text: afterStart.slice(0, end), mark: true });
    rest = afterStart.slice(end + HL_END.length);
  }
  return segments.filter((s) => s.text.length > 0);
}
