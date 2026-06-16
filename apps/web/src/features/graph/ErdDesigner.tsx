"use client";

import * as React from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { KeyRound, Link2 } from "lucide-react";

import type { ErdModel } from "@forgespecs/core/graph";
import { layoutGraph } from "./layout";

/**
 * ERD designer surface: one React Flow node per table, a handle per column, and
 * FK edges connecting the referencing column to the referenced table's PK.
 * Backed by the DBML-derived ErdModel (parsed server-side). Heavy (React Flow) →
 * dynamic-imported with ssr:false by the panel wrapper.
 *
 * Editing is local (drag to rearrange, the model is the serialization source);
 * Export SQL/DBML is handled by the parent toolbar via the server `dbmlToSql`.
 */

type TableNodeData = { table: ErdModel["tables"][number] };
type TableNode = Node<TableNodeData, "table">;

function TableNodeCard({ data }: NodeProps<TableNode>) {
  const { table } = data;
  return (
    <div className="min-w-[200px] overflow-hidden rounded-md border bg-card text-left shadow-sm">
      <div className="border-b bg-muted/60 px-3 py-1.5 text-sm font-semibold">
        {table.name}
      </div>
      <ul className="divide-y text-xs">
        {table.columns.map((col) => (
          <li
            key={col.name}
            className="relative flex items-center justify-between gap-3 px-3 py-1.5"
          >
            {/* target handle (left) — referenced by FK edges */}
            <Handle
              type="target"
              position={Position.Left}
              id={`${col.name}-t`}
              className="!size-1.5 !bg-muted-foreground"
            />
            <span className="flex items-center gap-1 font-mono">
              {col.pk ? (
                <KeyRound className="size-3 text-amber-500" aria-label="primary key" />
              ) : col.ref ? (
                <Link2 className="size-3 text-blue-500" aria-label="foreign key" />
              ) : (
                <span className="inline-block w-3" />
              )}
              <span className={col.pk ? "font-semibold" : ""}>{col.name}</span>
            </span>
            <span className="text-muted-foreground">{col.type}</span>
            {/* source handle (right) — FK origin */}
            <Handle
              type="source"
              position={Position.Right}
              id={`${col.name}-s`}
              className="!size-1.5 !bg-muted-foreground"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

const nodeTypes = { table: TableNodeCard };

export default function ErdDesigner({ model }: { model: ErdModel }) {
  const { nodes, edges } = React.useMemo(() => {
    const rawNodes: TableNode[] = model.tables.map((table) => ({
      id: table.name,
      type: "table",
      position: { x: 0, y: 0 },
      width: 220,
      height: 60 + table.columns.length * 28,
      data: { table },
    }));

    const rawEdges: Edge[] = model.relations.map((r, i) => ({
      id: `fk-${i}-${r.fromTable}.${r.fromColumn}`,
      source: r.fromTable,
      sourceHandle: `${r.fromColumn}-s`,
      target: r.toTable,
      targetHandle: `${r.toColumn}-t`,
      label: `${r.fromColumn} → ${r.toColumn}`,
      style: { stroke: "#3b82f6" },
      labelStyle: { fontSize: 10, fill: "var(--muted-foreground)" },
      labelBgStyle: { fill: "var(--background)" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#3b82f6" },
    }));

    return {
      nodes: layoutGraph(rawNodes, rawEdges, { direction: "LR", rankSep: 120 }),
      edges: rawEdges,
    };
  }, [model]);

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} className="bg-muted/20" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-card" />
      </ReactFlow>
    </div>
  );
}
