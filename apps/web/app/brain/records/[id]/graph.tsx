"use client";

import "@xyflow/react/dist/style.css";

import type { Graph } from "@maslow/brain";
import {
  applyNodeChanges,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from "@xyflow/react";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { recordHref, typeColor, verbText } from "../../format";
import { TypeIcon } from "../../type-icon";
import {
  arrange,
  CHIP_HEIGHT,
  chipWidth,
  type Body,
  type Map as BrainMap,
} from "./arrange";

type RecordNode = Node<
  { title: string; type: string; focus: boolean },
  "record"
>;
type AnyNode = RecordNode;

// An edge knows how big each chip is, so it can stop at the chip's edge,
// and which lane it takes when other edges join the same two chips.
type VerbEdge = Edge<
  {
    verb: string;
    lane: number;
    from: { w: number; h: number };
    to: { w: number; h: number };
  },
  "verb"
>;

const ARROW = 5;
const LANE = 12;

// The record in focus or under the pointer, and everything one link away.
// Held beside the nodes rather than in them, so hovering redraws the chips
// it touches and not the whole graph.
const Attention = createContext<{ centre: string; near: Set<string> }>({
  centre: "",
  near: new Set(),
});

// A handle at the chip's centre, so a line is measured from there.
const HANDLE =
  "top-1/2! left-1/2! size-0! min-h-0! min-w-0! -translate-x-1/2! -translate-y-1/2! border-0! opacity-0!";

// A record as a chip: its type's icon and its title, small enough to sit
// with many and big enough to take hold of.
function RecordChip({ id, data }: NodeProps<RecordNode>) {
  const { centre, near } = useContext(Attention);
  const attended = centre === id || near.has(id);
  const color = typeColor(data.type);
  return (
    <div
      className={`bg-background flex cursor-grab items-center gap-1.5 rounded border px-1.5 text-xs leading-none transition-[background-color,border-color] active:cursor-grabbing ${
        attended ? "border-foreground/50 bg-accent" : "hover:bg-accent/60"
      } ${data.focus || attended ? "font-medium" : ""}`}
      style={{
        width: chipWidth(data.title),
        height: CHIP_HEIGHT,
        boxShadow: data.focus ? `0 0 0 2px ${color}` : undefined,
      }}
      title={data.title}
    >
      <Handle type="target" position={Position.Top} className={HANDLE} />
      <Handle type="source" position={Position.Top} className={HANDLE} />
      <TypeIcon type={data.type} />
      <span className="truncate">{data.title || "(untitled)"}</span>
    </div>
  );
}

// Where a line from a chip's centre leaves the chip, given its direction.
const leave = (ux: number, uy: number, w: number, h: number) =>
  Math.min(
    Math.abs(ux) > 1e-6 ? w / 2 / Math.abs(ux) : Infinity,
    Math.abs(uy) > 1e-6 ? h / 2 / Math.abs(uy) : Infinity,
  ) + 3;

// A link as a line from one chip's edge to the other's, with an arrowhead
// for its direction. Its verb shows when the link is named: touching the
// record in focus or the one under the pointer.
function VerbLine({
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps<VerbEdge>) {
  const zoom = useStore((s) => s.transform[2]);
  const { centre } = useContext(Attention);
  const named = centre === source || centre === target;
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const fromGap = leave(
    ux,
    uy,
    data?.from.w ?? 100,
    data?.from.h ?? CHIP_HEIGHT,
  );
  const toGap = leave(ux, uy, data?.to.w ?? 100, data?.to.h ?? CHIP_HEIGHT);
  if (length <= fromGap + toGap + ARROW) return null;
  // Its lane: a step to the side of the line between the chips' centres.
  const side = (data?.lane ?? 0) * LANE;
  const x1 = sourceX + ux * fromGap - uy * side;
  const y1 = sourceY + uy * fromGap + ux * side;
  const x2 = targetX - ux * toGap - uy * side;
  const y2 = targetY - uy * toGap + ux * side;
  const bx = x2 - ux * ARROW;
  const by = y2 - uy * ARROW;
  const half = ARROW / 2;
  const arrow = `M ${x2} ${y2} L ${bx - uy * half} ${by + ux * half} L ${bx + uy * half} ${by - ux * half} Z`;
  const color = named ? "var(--foreground)" : "var(--muted-foreground)";
  const opacity = named ? 0.9 : 0.4;
  return (
    <>
      <BaseEdge
        path={`M ${x1} ${y1} L ${bx} ${by}`}
        style={{ stroke: color, strokeWidth: named ? 1.5 : 1, opacity }}
      />
      <path d={arrow} fill={color} opacity={opacity} />
      {named && data && (
        <EdgeLabelRenderer>
          <div
            className="bg-background/90 text-muted-foreground absolute rounded px-1 text-[11px]"
            style={{
              transform: `translate(-50%, -50%) translate(${(x1 + x2) / 2}px, ${(y1 + y2) / 2}px) scale(${1 / zoom})`,
            }}
          >
            {verbText(data.verb)}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { record: RecordChip };
const edgeTypes = { verb: VerbLine };

// The box around the map, in graph units.
function extent(map: BrainMap) {
  const halfW = (n: { title: string }) => chipWidth(n.title) / 2;
  const minY = Math.min(...map.placed.map((n) => n.y - CHIP_HEIGHT / 2));
  return {
    minX: Math.min(...map.placed.map((n) => n.x - halfW(n))),
    maxX: Math.max(...map.placed.map((n) => n.x + halfW(n))),
    minY,
    maxY: Math.max(...map.placed.map((n) => n.y + CHIP_HEIGHT / 2)),
  };
}

// A chip is placed by its centre; React Flow places by the corner.
const corner = (b: { x: number; y: number; title: string }) => ({
  x: b.x - chipWidth(b.title) / 2,
  y: b.y - CHIP_HEIGHT / 2,
});

function toNodes(map: BrainMap, focus: string): AnyNode[] {
  return [
    ...map.placed.map<RecordNode>((n) => ({
      id: n.id,
      type: "record",
      position: corner(n),
      data: {
        title: n.title,
        type: n.type,
        focus: n.id === focus,
      },
      connectable: false,
    })),
  ];
}

// Edges joining the same two chips fan out, one lane each, counted from the
// same side whichever way they point.
function toEdges(graph: Graph): VerbEdge[] {
  const size = new Map(
    graph.nodes.map((n) => [n.id, { w: chipWidth(n.title), h: CHIP_HEIGHT }]),
  );
  const pair = (e: { fromId: string; toId: string }) =>
    [e.fromId, e.toId].sort().join(" ");
  const shared = new Map<string, number>();
  for (const e of graph.edges) {
    shared.set(pair(e), (shared.get(pair(e)) ?? 0) + 1);
  }
  const taken = new Map<string, number>();
  return graph.edges.map((e) => {
    const key = pair(e);
    const i = taken.get(key) ?? 0;
    taken.set(key, i + 1);
    const lane =
      (i - (shared.get(key)! - 1) / 2) * (e.fromId < e.toId ? 1 : -1);
    return {
      id: e.id,
      type: "verb",
      source: e.fromId,
      target: e.toId,
      data: {
        verb: e.verb,
        lane,
        from: size.get(e.fromId) ?? { w: 0, h: 0 },
        to: size.get(e.toId) ?? { w: 0, h: 0 },
      },
    };
  });
}

// The map drawn in its pane: fitted at full size when it fits and zoomed
// out when it does not, and alive under the pointer: drag a chip and its
// neighbours give way.
function Canvas({
  graph,
  focus,
  onHover,
}: {
  graph: Graph;
  focus: string;
  onHover: (id: string | null) => void;
}) {
  const router = useRouter();
  const { setViewport } = useReactFlow();
  const size = useStore((s) => `${s.width}x${s.height}`);
  const [w, h] = size.split("x").map(Number);
  const [nodes, setNodes] = useState<AnyNode[]>([]);
  const edges = useMemo(() => toEdges(graph), [graph]);
  const physics = useRef<BrainMap | null>(null);
  const bodies = useRef(new Map<string, Body>());

  // A new layout whenever the record's map changes; a new fit whenever the pane
  // does.
  useEffect(() => {
    physics.current?.simulation.stop();
    if (!w || !h || graph.nodes.length === 0) {
      setNodes([]);
      return;
    }
    const map = arrange(graph, w, h, focus);
    physics.current = map;
    bodies.current = new Map(map.nodes.map((b) => [b.id, b]));
    setNodes(toNodes(map, focus));
    map.simulation.on("tick", () => {
      setNodes((current) =>
        current.map((n) => {
          const b = bodies.current.get(n.id);
          // A chip under the hand goes where the hand puts it.
          if (!b || (b.fx !== undefined && b.fx !== null)) return n;
          return { ...n, position: corner(b) };
        }),
      );
    });

    const { minX, maxX, minY, maxY } = extent(map);
    const pad = 20;
    const zoom = Math.min(
      1,
      Math.max(
        Math.min((w - 2 * pad) / (maxX - minX), (h - 2 * pad) / (maxY - minY)),
        0.2,
      ),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    void setViewport({ x: w / 2 - cx * zoom, y: h / 2 - cy * zoom, zoom });
    return () => {
      map.simulation.stop();
    };
  }, [graph, w, h, focus, setViewport]);

  const onNodesChange = useCallback((changes: NodeChange<AnyNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);
  // Pins a chip under the hand, by its centre.
  const hold = (id: string, x: number, y: number) => {
    const b = bodies.current.get(id);
    if (!b) return;
    b.fx = x + chipWidth(b.title) / 2;
    b.fy = y + CHIP_HEIGHT / 2;
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      minZoom={0.2}
      maxZoom={3}
      panOnScroll
      zoomOnScroll={false}
      zoomOnPinch
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
      nodesFocusable={false}
      elementsSelectable={false}
      onNodeClick={(_, node) => {
        if (node.type === "record") router.push(recordHref(node.id));
      }}
      onNodeMouseEnter={(_, node) => {
        if (node.type === "record") onHover(node.id);
      }}
      onNodeMouseLeave={() => onHover(null)}
      onNodeDragStart={(_, node) => {
        hold(node.id, node.position.x, node.position.y);
        physics.current?.simulation.alphaTarget(0.15).restart();
      }}
      onNodeDrag={(_, node) => hold(node.id, node.position.x, node.position.y)}
      // A chip stays where it was put; only its neighbours settle.
      onNodeDragStop={() => physics.current?.simulation.alphaTarget(0)}
      className="bg-background"
    ></ReactFlow>
  );
}

// A record drawn as a map: that record in the middle, everything it links
// to on a ring, the verb on each spoke. Two fingers pan, a pinch zooms, a
// drag moves a chip, a click opens a record.
export function BrainGraph({ graph, focus }: { graph: Graph; focus: string }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const attention = useMemo(() => {
    const centre = hovered ?? focus;
    const near = new Set<string>();
    for (const e of graph.edges) {
      if (e.fromId === centre) near.add(e.toId);
      if (e.toId === centre) near.add(e.fromId);
    }
    return { centre, near };
  }, [hovered, focus, graph.edges]);

  return (
    <ReactFlowProvider>
      <Attention.Provider value={attention}>
        <Canvas graph={graph} focus={focus} onHover={setHovered} />
      </Attention.Provider>
    </ReactFlowProvider>
  );
}
