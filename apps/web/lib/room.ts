import { asPerson } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import {
  addDesktop,
  desktopsOf,
  saveDesktop,
  type Card,
  type Desktop,
  type Kind,
  type Screen,
} from "@maslow/db/desktops";
import { wallpaperOf } from "@maslow/db/wallpapers";

import { boxOf } from "@/app/room/blocks";
import { cascade, clamp, fresh, MIN, share, type Port } from "@/app/room/tiles";

import { sharedWithMe, sharingOf, statsOf } from "./computer.ts";

// The room as the person left it, one desk at least, the wallpaper it
// lies on, and the ports they could place: their own open ones and those
// other people opened to them.
export async function roomOf(p: Principal): Promise<{
  desktops: Desktop[];
  ports: Port[];
  wallpaper: string | null;
}> {
  const [{ desktops, wallpaper }, ports] = await Promise.all([
    asPerson(p, async (q) => {
      const wallpaper = await wallpaperOf(q);
      const had = await desktopsOf(q);
      if (had.length === 0)
        return { desktops: [await addDesktop(q, null)], wallpaper };
      // A desk kept in a shape the room had before is read as its windows
      // in order and kept in today's shape.
      const desktops = await Promise.all(
        had.map(async (d) => {
          const older = d.layout && fromBefore(d.layout);
          return older ? ((await saveDesktop(q, d.id, older)) ?? d) : d;
        }),
      );
      // There is one desk: windows kept on desks from before are gathered
      // onto it, so nothing a person placed is out of reach.
      const [first, ...rest] = desktops;
      const strays = rest.flatMap((d) => d.layout?.cards ?? []);
      if (first && strays.length > 0) {
        const cards = [...(first.layout?.cards ?? []), ...strays];
        const gathered = await saveDesktop(q, first.id, { cards });
        await Promise.all(rest.map((d) => saveDesktop(q, d.id, { cards: [] })));
        return { desktops: [gathered ?? first], wallpaper };
      }
      return { desktops, wallpaper };
    }),
    // A computer that does not answer never takes the desk down: the room
    // opens without its ports, the Computer pane says the door is silent,
    // and the next ask puts them back.
    portsOf(p).catch(() => []),
  ]);
  return { desktops, ports, wallpaper };
}

// The ports a person can open: their own, as their computer reports them
// this moment, and those other people have opened to them, which say whose
// they are.
export async function portsOf(p: Principal): Promise<Port[]> {
  const [mine, shared] = await Promise.all([sharingOf(p), sharedWithMe(p)]);
  // A computer that does not answer is not one with no ports: the ask
  // fails, and the room keeps what it knew.
  const stats = mine ? await statsOf(p) : null;
  return [
    ...(mine
      ? (stats?.ports ?? []).map((x) => ({
          title: `Port ${x.port}${x.name ? ` · ${x.name}` : ""}`,
          href: `/port/${mine.machineId}/${x.port}`,
          face: x.face,
        }))
      : []),
    ...shared.map((s) => ({
      title: `Port ${s.port} · ${s.owner}'s`,
      href: `/port/${s.machineId}/${s.port}`,
    })),
  ];
}

// --- The shapes the room had before ------------------------------------

type Named = { kind: Kind; title: string; href: string };
type Leaf = { window: Named };
type Tree = Leaf | { split: "x" | "y"; a: Tree; b: Tree };
// The grid the room was for a day: cells across and down, and sizes.
type Cell = Named & { size: "s" | "m" | "l" | "xl"; x: number; y: number };

const leavesOf = (t: Tree): Named[] =>
  "window" in t ? [t.window] : [...leavesOf(t.a), ...leavesOf(t.b)];

// A window that framed one section of settings frames all of it, since the
// dock offers settings as one block.
const sectioned = (c: { href: string }) => c.href.startsWith("/settings?");
const whole = <T extends { href: string; title: string }>(c: T): T =>
  sectioned(c) ? { ...c, href: "/settings", title: "Settings" } : c;

// The windows an older desk held, in order, each opened at its size where
// a cascade puts it, or today's windows given names where they had none or
// pointed at a section of settings; null when the desk is already as it
// should be.
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
    if (!cards) return null;
    if (cards.every((c) => typeof c.id === "string") && !cards.some(sectioned))
      return null;
    return { cards: cards.map((c) => whole({ ...c, id: c.id ?? fresh() })) };
  }
  const cards: Card[] = [];
  for (const n of named.map(whole)) {
    const box = boxOf(n);
    cards.push(clamp({ id: fresh(), ...n, ...box, ...cascade(cards, box) }));
  }
  return { cards };
}

// --- Keeping a desk ----------------------------------------------------

// Whether a desk is well formed: every window framing a path on our own
// site and no other, no longer than an address goes, sitting inside the
// desk at no less than the smallest size, no two windows of one name, and
// not too many. Nothing can be parked in the table.
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
      c.href.length <= 2000 &&
      /^\/(?!\/)[^\\\s]*$/.test(c.href) &&
      share(c.x) &&
      share(c.y) &&
      share(c.w) &&
      share(c.h) &&
      c.w >= MIN.w &&
      c.h >= MIN.h &&
      c.x + c.w <= 1.0001 &&
      c.y + c.h <= 1.0001 &&
      (c.stowed === undefined || typeof c.stowed === "boolean") &&
      (c.pinned === undefined || typeof c.pinned === "boolean") &&
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
  id: string,
  layout: unknown,
): Promise<Desktop | null> {
  if (!wellFormed(layout)) return null;
  return asPerson(p, (q) => saveDesktop(q, id, layout));
}
