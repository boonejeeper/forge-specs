"use client";

import * as React from "react";
import { Download, FileDown, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const FORMATS: { label: string; param: string; ext: string }[] = [
  { label: "Markdown", param: "md", ext: "md" },
  { label: "JSON", param: "json", ext: "json" },
  { label: "YAML", param: "yaml", ext: "yaml" },
];

/**
 * Per-document export control: downloads the content-negotiated export route
 * (document + dependency closure) in MD / JSON / YAML — the same artifact an
 * autonomous coding agent consumes.
 */
export function DocumentExportButton({
  documentId,
  baseFilename,
}: {
  documentId: string;
  baseFilename: string;
}) {
  const [busy, setBusy] = React.useState(false);

  const download = async (param: string, ext: string, closure: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/documents/${encodeURIComponent(documentId)}/export?format=${param}${
          closure ? "" : "&closure=0"
        }`,
      );
      if (!res.ok) return;
      const body = await res.text();
      const blob = new Blob([body], { type: "text/plain" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${baseFilename}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FileDown className="size-4" />}
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>With dependency closure</DropdownMenuLabel>
        {FORMATS.map((f) => (
          <DropdownMenuItem key={`b-${f.param}`} onClick={() => download(f.param, f.ext, true)}>
            <Download className="size-4" /> {f.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>This document only</DropdownMenuLabel>
        {FORMATS.map((f) => (
          <DropdownMenuItem key={`s-${f.param}`} onClick={() => download(f.param, f.ext, false)}>
            <Download className="size-4" /> {f.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
