"use client";

import type { Graph } from "@placeholder/brain";
import { useEffect, useState } from "react";

import { BrainGraph } from "./lazy";

// The graph of everything, fetched once the table beside it is on screen.
export function WholeGraph() {
  const [graph, setGraph] = useState<Graph | null>(null);
  useEffect(() => {
    let on = true;
    fetch("/brain/graph", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Graph>) : null))
      .then((g) => on && g && setGraph(g))
      .catch(() => {});
    return () => {
      on = false;
    };
  }, []);
  if (!graph) return <div className="bg-muted/30 h-full" />;
  return <BrainGraph graph={graph} />;
}
