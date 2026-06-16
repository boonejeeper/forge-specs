import dagre from "dagre";
import type { Edge, Node } from "@xyflow/react";

/**
 * Hierarchical layout via dagre. Pure positioning: takes React Flow nodes/edges
 * (no positions) and returns them with `position` set. Used by the dependency
 * graph + ERD designer. Top-to-bottom by default (idea → execution reads down).
 *
 * dagre is a small, sync, dependency-free layout engine — preferred over elk for
 * our DAG sizes; it runs instantly client-side inside the code-split graph
 * bundle.
 */
export interface LayoutOptions {
  direction?: "TB" | "LR";
  nodeWidth?: number;
  nodeHeight?: number;
  rankSep?: number;
  nodeSep?: number;
}

export function layoutGraph<N extends Node, E extends Edge>(
  nodes: N[],
  edges: E[],
  options: LayoutOptions = {},
): N[] {
  const {
    direction = "TB",
    nodeWidth = 200,
    nodeHeight = 64,
    rankSep = 70,
    nodeSep = 40,
  } = options;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep });

  for (const node of nodes) {
    g.setNode(node.id, {
      width: node.width ?? nodeWidth,
      height: node.height ?? nodeHeight,
    });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  return nodes.map((node) => {
    const pos = g.node(node.id);
    const w = node.width ?? nodeWidth;
    const h = node.height ?? nodeHeight;
    return {
      ...node,
      // dagre centers nodes; React Flow positions from the top-left.
      position: { x: pos.x - w / 2, y: pos.y - h / 2 },
    };
  });
}
