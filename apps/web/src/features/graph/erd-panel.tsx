"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { Database, Download, Loader2 } from "lucide-react";

import type { ErdModel } from "@forgespecs/core/graph";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { exportErdSql } from "@/lib/actions/erd";

/**
 * ERD designer client entry. React Flow is loaded via next/dynamic (ssr:false).
 * The toolbar exports the model as DBML (client-side, already serialized) or SQL
 * (server action delegating to @dbml/core).
 */
const ErdDesigner = dynamic(() => import("./ErdDesigner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
    </div>
  ),
});

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ErdPanel({
  documentId,
  title,
  model,
  dbml,
}: {
  documentId: string;
  title: string;
  model: ErdModel;
  dbml: string;
}) {
  const [exporting, setExporting] = React.useState<null | "sql">(null);
  const [error, setError] = React.useState<string | null>(null);

  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "schema";

  const onExportSql = async () => {
    setExporting("sql");
    setError(null);
    try {
      const { sql } = await exportErdSql({ documentId, dbml, dialect: "postgres" });
      download(`${slug}.sql`, sql, "text/sql");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(null);
    }
  };

  if (model.tables.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={Database}
          title="No schema to render"
          description="Add a DBML code block or a Mermaid erDiagram to this schema document to design its ERD."
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <p className="text-xs text-muted-foreground">
          {model.tables.length} tables · {model.relations.length} relations
        </p>
        <div className="flex items-center gap-2">
          {error ? <span className="text-xs text-destructive">{error}</span> : null}
          <Button
            variant="outline"
            size="sm"
            onClick={() => download(`${slug}.dbml`, dbml, "text/plain")}
          >
            <Download className="size-3.5" />
            DBML
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onExportSql}
            disabled={exporting === "sql"}
          >
            {exporting === "sql" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            SQL
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ErdDesigner model={model} />
      </div>
    </div>
  );
}
