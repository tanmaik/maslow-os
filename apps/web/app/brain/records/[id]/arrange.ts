import type { Graph } from "@maslow/brain";
import {
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
} from "d3-force";

type Placed = Graph["nodes"][number] & { x: number; y: number };

// A node is a chip: its type's icon and its title on one line. How wide one
// is, in pixels, from the title's length, capped so a long title is cut
// short with an ellipsis.
const CHIP_MAX = 190;
export const CHIP_HEIGHT = 24;
export const chipWidth = (title: string) =>
  Math.min(Math.max(title.length, 6) * 7.2 + 32, CHIP_MAX);

// Room between chips in a cluster.
const ROW = CHIP_HEIGHT + 8;
const SLOT_GAP = 10;

export type Body = SimulationNodeDatum &
  Placed & {
    w: number;
    h: number;
    x: number;
    y: number;
    tx: number;
    ty: number;
  };

export type Map = {
  placed: Placed[];
  nodes: Body[];
  simulation: Simulation<Body, undefined>;
};

// Pushes apart chips of one type that overlap, so a dragged chip shoulders
// its neighbours aside.
function separate(nodes: Body[], strength: number) {
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!;
      if (a.type !== b.type) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const ox = (a.w + b.w) / 2 + SLOT_GAP - Math.abs(dx);
      const oy = ROW - Math.abs(dy);
      if (ox <= 0 || oy <= 0) continue;
      const alongX = ox < oy;
      const s = (alongX ? ox : oy) * strength * 0.5;
      const sign = (alongX ? Math.sign(dx) : Math.sign(dy)) || (i % 2 ? 1 : -1);
      if (alongX) {
        a.vx = (a.vx ?? 0) - sign * s;
        b.vx = (b.vx ?? 0) + sign * s;
      } else {
        a.vy = (a.vy ?? 0) - sign * s;
        b.vy = (b.vy ?? 0) + sign * s;
      }
    }
  }
}

// The map around one record: that record in the middle and everything it
// links to on a ring around it. The positions are exact; the simulation
// only lets a drag move things.
export function arrange(
  graph: Graph,
  width: number,
  height: number,
  focus: string,
): Map {
  // The ring follows the pane: wider than tall in a wide pane, taller
  // than wide in a tall one.
  const aspect = Math.sqrt(Math.min(2, Math.max(0.5, width / height)));
  const nodes: Body[] = [];
  const centre = graph.nodes.find((n) => n.id === focus);

  if (centre) {
    const others = graph.nodes.filter((n) => n.id !== centre.id);
    // A ring wide enough for every chip to have its own angle without
    // touching, and tall enough for names to stack on its sides.
    const n = Math.max(others.length, 1);
    const radius = Math.max(
      110,
      (n * (CHIP_MAX * 0.75 + 20)) / (2 * Math.PI),
      (Math.ceil(n / 2) * ROW) / 2,
    );
    nodes.push({
      ...centre,
      x: 0,
      y: 0,
      tx: 0,
      ty: 0,
      w: chipWidth(centre.title),
      h: CHIP_HEIGHT,
    });
    // Same types sit together around the ring.
    const sorted = [...others].sort(
      (a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title),
    );
    sorted.forEach((o, i) => {
      const angle = -Math.PI / 2 + (i / n) * 2 * Math.PI;
      const x = Math.cos(angle) * radius * 1.2 * aspect;
      const y = (Math.sin(angle) * radius) / aspect;
      nodes.push({
        ...o,
        x,
        y,
        tx: x,
        ty: y,
        w: chipWidth(o.title),
        h: CHIP_HEIGHT,
      });
    });
  }

  const simulation = forceSimulation(nodes)
    .force("x", forceX<Body>((n) => n.tx).strength(0.12))
    .force("y", forceY<Body>((n) => n.ty).strength(0.12))
    .force("apart", (alpha: number) => separate(nodes, alpha))
    .stop();

  return {
    placed: nodes.map(({ id, type, title, depth, x, y }) => ({
      id,
      type,
      title,
      depth,
      x,
      y,
    })),
    nodes,
    simulation,
  };
}
