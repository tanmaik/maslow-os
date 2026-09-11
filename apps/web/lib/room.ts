import { asPerson } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import {
  addDesktop,
  desktopsOf,
  removeDesktop,
  saveDesktop,
  type Card,
  type Desktop,
  type Kind,
  type Screen,
} from "@maslow/db/desktops";

import { boxOf } from "@/app/room/blocks";
import { cascade, clamp, fresh, MIN, share, type Port } from "@/app/room/tiles";

import { sharedWithMe, sharingOf, statsOf } from "./computer.ts";

// The room as the person left it, one desk at least, and the ports they
// could place: their own open ones and those other people opened to them.
export async function roomOf(
  p: Principal,
): Promise<{ desktops: Desktop[]; ports: Port[] }> {
  const [desktops, mine, shared, stats] = await Promise.all([
    asPerson(p, async (q) => {
      const had = await desktopsOf(q);
      if (had.length === 0) return [await addDesktop(q, null)];
      // A desk kept in a shape the room had before is read as its windows
      // in order and kept in today's shape.
      return Promise.all(
        had.map(async (d) => {
          const older = d.layout && fromBefore(d.layout);
          return older ? ((await saveDesktop(q, d.id, older)) ?? d) : d;
        }),
      );
    }),
    sharingOf(p),
    sharedWithMe(p),
    statsOf(p).catch(() => null),
  ]);
  const ports: Port[] = [
    ...(mine
      ? (stats?.ports ?? []).map((x) => ({
          title: `Port ${x.port}${x.name ? ` · ${x.name}` : ""}`,
          href: `/port/${mine.machineId}/${x.port}`,
        }))
      : []),
    ...shared.map((s) => ({
      title: `${s.owner}'s port ${s.port}`,
      href: `/port/${s.machineId}/${s.port}`,
    })),
  ];
  return { desktops, ports };
}

// --- The shapes the room had before ------------------------------------

type Named = { kind: Kind; title: string; href: string };
type Leaf = { window: Named };
type Tree = Leaf | { split: "x" | "y"; a: Tree; b: Tree };
// The grid the room was for a day: cells across and down, and sizes.
type Cell = Named & { size: "s" | "m" | "l" | "xl"; x: number; y: number };

const leavesOf = (t: Tree): Named[] =>
  "window" in t ? [t.window] : [...leavesOf(t.a), ...leavesOf(t.b)];

// The windows an older desk held, in order, each opened at its size where
// a cascade puts it, or today's windows given names where they had none;
// null when the desk is already in today's shape.
function fromBefore(layout: unknown): Screen | null {
  if (typeof layout !== "object" || layout === null) return null;
  const l = layout as Record<string, unknown>;
  let named: Named[] | null = null;
  if ("window" in l || "split" in l) named = leavesOf(layout as Tree);
  else if (
    Array.isArray(l.cards) &&
    (l.cards as Cell[]).some((c) => "size" in c)
  )
    named = (l.cards as Cell[]).map(({ kind, title, href }) => ({
      kind,
      title,
      href,
    }));
  if (!named) {
    const cards = Array.isArray(l.cards) ? (l.cards as Card[]) : null;
    if (!cards || cards.every((c) => typeof c.id === "string")) return null;
    return { cards: cards.map((c) => ({ ...c, id: c.id ?? fresh() })) };
  }
  const cards: Card[] = [];
  for (const n of named) {
    const box = boxOf(n);
    cards.push(clamp({ id: fresh(), ...n, ...box, ...cascade(cards, box) }));
  }
  return { cards };
}

// --- Keeping a desk ----------------------------------------------------

// Whether a desk is well formed: every window framing a path on our own
// site and no other, sitting inside the desk at no less than the smallest
// size, no two windows of one name, and not too many.
const KINDS = new Set<Kind>(["port", "record", "brain", "settings", "page"]);
function wellFormed(layout: unknown): layout is Screen | null {
  if (layout === null) return true;
  if (typeof layout !== "object") return false;
  const s = layout as Record<string, unknown>;
  if (!Array.isArray(s.cards) || s.cards.length > 32) return false;
  const seen = new Set<string>();
  for (const c of s.cards as Record<string, unknown>[]) {
    if (!c || typeof c !== "object") return false;
    const ok =
      typeof c.id === "string" &&
      /^[a-z0-9]{4,16}$/.test(c.id) &&
      KINDS.has(c.kind as Kind) &&
      typeof c.title === "string" &&
      c.title.length > 0 &&
      c.title.length <= 120 &&
      typeof c.href === "string" &&
      /^\/(?!\/)[^\\\s]*$/.test(c.href) &&
      share(c.x) &&
      share(c.y) &&
      share(c.w) &&
      share(c.h) &&
      c.w >= MIN.w &&
      c.h >= MIN.h &&
      c.x + c.w <= 1.0001 &&
      c.y + c.h <= 1.0001 &&
      !seen.has(c.id);
    if (!ok) return false;
    seen.add(c.id as string);
  }
  return true;
}

// Keeps a desk, or makes a new one holding these windows. Null when the
// desk is not well formed or not theirs.
export async function keep(
  p: Principal,
  id: string | null,
  layout: unknown,
): Promise<Desktop | null> {
  if (!wellFormed(layout)) return null;
  return asPerson(p, (q) =>
    id ? saveDesktop(q, id, layout) : addDesktop(q, layout),
  );
}

// Takes a desk away.
export async function drop(p: Principal, id: string): Promise<boolean> {
  return asPerson(p, (q) => removeDesktop(q, id));
}
