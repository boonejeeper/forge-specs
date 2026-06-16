"use client";

import * as React from "react";
import { Check, Copy, Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";

type Format = "markdown" | "json" | "yaml";

const FORMATS: { key: Format; label: string; param: string; ext: string }[] = [
  { key: "markdown", label: "Markdown", param: "md", ext: "md" },
  { key: "json", label: "JSON", param: "json", ext: "json" },
  { key: "yaml", label: "YAML", param: "yaml", ext: "yaml" },
];

/**
 * Copy / download buttons for an agent's export bundle in each format. Fetches
 * the content-negotiated export route and either writes to the clipboard or
 * triggers a file download — the bundle is exactly what an autonomous coding
 * agent would consume.
 */
export function AgentExportButtons({
  agentName,
  workspaceId,
  baseFilename,
}: {
  agentName: string;
  workspaceId: string;
  baseFilename: string;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<Format | null>(null);

  const url = (param: string) =>
    `/api/agents/${encodeURIComponent(agentName)}/export?workspaceId=${encodeURIComponent(
      workspaceId,
    )}&format=${param}`;

  const fetchBody = async (param: string): Promise<string> => {
    const res = await fetch(url(param));
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.text();
  };

  const onCopy = async (fmt: Format, param: string) => {
    setBusy(`copy-${fmt}`);
    try {
      const body = await fetchBody(param);
      await navigator.clipboard.writeText(body);
      setCopied(fmt);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* surfaced via no state change; keep UI resilient */
    } finally {
      setBusy(null);
    }
  };

  const onDownload = async (fmt: Format, param: string, ext: string) => {
    setBusy(`dl-${fmt}`);
    try {
      const body = await fetchBody(param);
      const blob = new Blob([body], { type: "text/plain" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = `${baseFilename}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
    } catch {
      /* keep UI resilient */
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {FORMATS.map(({ key, label, param, ext }) => (
        <div key={key} className="flex items-center overflow-hidden rounded-md border">
          <button
            type="button"
            onClick={() => onCopy(key, param)}
            disabled={busy !== null}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            {busy === `copy-${key}` ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : copied === key ? (
              <Check className="size-3.5 text-green-600" />
            ) : (
              <Copy className="size-3.5" />
            )}
            {label}
          </button>
          <button
            type="button"
            onClick={() => onDownload(key, param, ext)}
            disabled={busy !== null}
            title={`Download ${label}`}
            className="border-l px-2 py-1.5 hover:bg-accent disabled:opacity-50"
          >
            {busy === `dl-${key}` ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
          </button>
        </div>
      ))}
      <Button variant="ghost" size="sm" asChild>
        <a href={url("md")} target="_blank" rel="noreferrer">
          Open raw
        </a>
      </Button>
    </div>
  );
}
