"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";

import type { GraphModel } from "@forgespecs/core/graph";
import { docTypeStyle, edgeKindStyle } from "./doc-node-meta";

/**
 * Workspace-wide knowledge graph — an Obsidian-style WebGL force-directed view
 * built on graphology + sigma. Heavy + WebGL-only, so loaded via next/dynamic
 * (ssr:false). Degrades gracefully on large graphs: ForceAtlas2 iteration count
 * scales down as node count grows, and hover/click highlight neighbors.
 *
 * Click a node → navigate to its document.
 */
export interface KnowledgeGraphProps {
  graph: GraphModel;
  hrefForNode: (id: string) => string;
}

export default function KnowledgeGraph({ graph, hrefForNode }: KnowledgeGraphProps) {
  const router = useRouter();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const hrefRef = React.useRef(hrefForNode);
  hrefRef.current = hrefForNode;

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || graph.nodes.length === 0) return;

    const g = new Graph();

    // Seed nodes on a circle so ForceAtlas2 has a non-degenerate start.
    const n = graph.nodes.length;
    graph.nodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / n;
      const style = docTypeStyle(node.type);
      g.addNode(node.id, {
        label: node.title,
        x: Math.cos(angle),
        y: Math.sin(angle),
        // Size by degree so hubs read as bigger (knowledge-graph ergonomics).
        size: 4 + Math.min(12, node.degree * 1.5),
        color: style.color,
      });
    });

    for (const edge of graph.edges) {
      if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) continue;
      if (g.hasEdge(edge.id)) continue;
      g.addEdgeWithKey(edge.id, edge.source, edge.target, {
        color: edgeKindStyle(edge.kind).color,
        size: 1,
      });
    }

    // Degrade gracefully: fewer iterations for larger graphs.
    const iterations = n > 800 ? 80 : n > 200 ? 200 : 400;
    forceAtlas2.assign(g, {
      iterations,
      settings: {
        ...forceAtlas2.inferSettings(g),
        scalingRatio: 10,
        gravity: 1,
      },
    });

    const renderer = new Sigma(g, container, {
      renderLabels: n <= 400,
      labelDensity: 0.5,
      labelRenderedSizeThreshold: 6,
      defaultEdgeColor: "#cbd5e1",
    });

    // Hover highlight: dim non-neighbors.
    let hovered: string | null = null;
    const setHover = (node: string | null) => {
      hovered = node;
      renderer.refresh();
    };
    renderer.on("enterNode", ({ node }) => setHover(node));
    renderer.on("leaveNode", () => setHover(null));
    renderer.on("clickNode", ({ node }) => router.push(hrefRef.current(node)));

    renderer.setSetting("nodeReducer", (node, data) => {
      if (hovered && node !== hovered && !g.areNeighbors(hovered, node)) {
        return { ...data, color: "#e2e8f0", label: "" };
      }
      return data;
    });
    renderer.setSetting("edgeReducer", (edge, data) => {
      if (hovered && !g.extremities(edge).includes(hovered)) {
        return { ...data, hidden: true };
      }
      return data;
    });

    return () => {
      renderer.kill();
    };
  }, [graph, router]);

  return <div ref={containerRef} className="h-full w-full" />;
}
