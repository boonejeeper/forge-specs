"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
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

import type { GraphModel } from "@forgespecs/core/graph";
import { cn } from "@/lib/utils";
import { docTypeStyle, edgeKindStyle } from "./doc-node-meta";
import { layoutGraph } from "./layout";

/**
 * React Flow dependency DAG with custom DocType node cards + DependencyKind-typed
 * edges, hierarchically laid out via dagre. Clicking a node navigates to that
 * doc. This whole module is heavy (React Flow + dagre) and is loaded via
 * next/dynamic (ssr:false) so it never touches the editor hot path or SSR.
 *
 * Shared by the per-project graph and the per-spec neighborhood (the latter
 * passes `seedId` to highlight the center + dims by hop depth).
 */

type DocNodeData = {
  title: string;
  type: GraphModel["nodes"][number]["type"];
  status: string;
  depth?: number;
  isSeed: boolean;
};

type DocNode = Node<DocNodeData, "doc">;

function DocNodeCard({ data }: NodeProps<DocNode>) {
  const style = docTypeStyle(data.type);
  const dim = data.depth !== undefined && data.depth > 1 && !data.isSeed;
  return (
    <div
      className={cn(
        "w-[200px] rounded-md border bg-card px-3 py-2 text-left shadow-sm transition-opacity",
        data.isSeed && "ring-2 ring-primary",
        dim && "opacity-60",
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: style.color }}
    >
      <Handle type="target" position={Position.Top} className="!bg-muted-foreground" />
      <div className="flex items-center justify-between gap-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white"
          style={{ backgroundColor: style.color }}
        >
          {style.abbr}
        </span>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {data.status.toLowerCase()}
        </span>
      </div>
      <p className="mt-1 truncate text-sm font-medium" title={data.title}>
        {data.title}
      </p>
      <Handle type="source" position={Position.Bottom} className="!bg-muted-foreground" />
    </div>
  );
}

const nodeTypes = { doc: DocNodeCard };

export interface DependencyGraphProps {
  graph: GraphModel;
  /** Map a node id → its navigation href. Click navigates there. */
  hrefForNode: (node: GraphModel["nodes"][number]) => string;
  /** Highlight this node as the neighborhood center, if any. */
  seedId?: string;
}

export default function DependencyGraph({
  graph,
  hrefForNode,
  seedId,
}: DependencyGraphProps) {
  const router = useRouter();

  const { nodes, edges } = React.useMemo(() => {
    const rawNodes: DocNode[] = graph.nodes.map((n) => ({
      id: n.id,
      type: "doc",
      position: { x: 0, y: 0 },
      width: 200,
      height: 64,
      data: {
        title: n.title,
        type: n.type,
        status: n.status,
        depth: n.depth,
        isSeed: n.id === seedId,
      },
    }));
    const rawEdges: Edge[] = graph.edges.map((e) => {
      const style = edgeKindStyle(e.kind);
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: style.label,
        animated: false,
        style: {
          stroke: style.color,
          strokeDasharray: style.dashed ? "4 4" : undefined,
        },
        labelStyle: { fontSize: 10, fill: "var(--muted-foreground)" },
        labelBgStyle: { fill: "var(--background)" },
        markerEnd: { type: MarkerType.ArrowClosed, color: style.color },
      };
    });
    return { nodes: layoutGraph(rawNodes, rawEdges), edges: rawEdges };
  }, [graph, seedId]);

  const byId = React.useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph],
  );

  const onNodeClick = React.useCallback(
    (_: unknown, node: Node) => {
      const meta = byId.get(node.id);
      if (meta) router.push(hrefForNode(meta));
    },
    [byId, hrefForNode, router],
  );

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        fitView
        minZoom={0.1}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} className="bg-muted/20" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            docTypeStyle((n.data as DocNodeData).type).color
          }
          className="!bg-card"
        />
      </ReactFlow>
    </div>
  );
}
