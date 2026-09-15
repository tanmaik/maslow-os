import { Invalid, NotFound } from "@maslow/brain";
import { asPerson, type Query } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { computerOf, portsReaching } from "@maslow/db/computers";
import {
  addDesktop,
  desktopsOf,
  holdDesktop,
  saveDesktop,
  type Card,
  type Desktop,
  type Kind,
  type Screen,
} from "@maslow/db/desktops";
import type { SharedPort } from "@maslow/db/computers";
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
      // The first desk is made once, whether the page or the agent asks
      // first.
      await q.query("select pg_advisory_xact_lock(hashtext($1))", [
        `desk:${p.userId}`,
      ]);
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

// Keeps a desk as the browser left it, resting on the count it saw. Null
// when the desk is not well formed or not theirs; "behind" when the desk
// has moved past that count, with the desk as it now is.
export async function keep(
  p: Principal,
  id: string,
  layout: unknown,
  rev: number,
): Promise<Desktop | { behind: Desktop } | null> {
  if (!wellFormed(layout)) return null;
  return asPerson(p, async (q) => {
    const kept = await saveDesktop(q, id, layout, rev);
    if (kept) return kept;
    const now = (await desktopsOf(q)).find((d) => d.id === id);
    return now ? { behind: now } : null;
  });
}

// The desk, and how many times it has been kept, for a page asking
// whether it changed elsewhere.
export async function deskNow(q: Query): Promise<Desktop | null> {
  return (await desktopsOf(q))[0] ?? null;
}

// --- The desk as the agent has it ----------------------------------------

// A widget as the agent sees it: its id, what it shows and where it lies.
export type Widget = Pick<
  Card,
  "id" | "title" | "href" | "x" | "y" | "w" | "h"
>;

const widgetOf = ({ id, title, href, x, y, w, h }: Card): Widget => ({
  id,
  title,
  href,
  x,
  y,
  w,
  h,
});

// A desk's cards as they are, or read into today's shape from an older
// one; a window of today's is left exactly as the person has it.
function cardsOf(desk: Desktop | null): Card[] {
  const layout = desk?.layout as Record<string, unknown> | null | undefined;
  if (!layout) return [];
  const cards = Array.isArray(layout.cards) ? (layout.cards as Card[]) : null;
  if (cards && cards.every((c) => typeof c.id === "string")) return cards;
  return fromBefore(layout)?.cards ?? [];
}

// What lies on the person's desk: the widgets, and nothing of the windows,
// which are the person's; and the ports that could lie there beside the
// person's own, those colleagues opened to them.
export async function deskOf(
  q: Query,
): Promise<{ widgets: Widget[]; shared: SharedPort[] }> {
  const widgets = cardsOf((await desktopsOf(q))[0] ?? null)
    .filter((c) => c.pinned && !c.stowed)
    .map(widgetOf);
  return { widgets, shared: await portsReaching(q) };
}

// What a widget shows: an app served on a port, of the person's own
// computer, or of a colleague's that was opened to them.
export type Shown = { port: number; machine?: string; title?: string };

// Where a widget lies, as shares of the desk from its top left corner.
export type Spot = Partial<Pick<Card, "x" | "y" | "w" | "h">>;

// Puts a widget on the person's desk, or moves one already there, which
// keeps what it shows unless told otherwise: at the spot given, or where
// the next widget goes. Answers the widget.
export async function place(
  q: Query,
  userId: string,
  shown: Shown | null,
  at: Spot,
  id?: string,
): Promise<Widget> {
  // One placing at a time per person, so two before their first desk
  // exists make one desk, not two.
  await q.query("select pg_advisory_xact_lock(hashtext($1))", [
    `desk:${userId}`,
  ]);
  const desk = (await holdDesktop(q)) ?? (await addDesktop(q, null));
  const cards = cardsOf(desk);
  const was = id ? cards.find((c) => c.id === id && c.pinned) : undefined;
  if (id && !was) throw new NotFound(`no widget ${id} on the desk`);
  if (!shown && !was) throw new Invalid("a widget shows a port");
  const named = shown
    ? await nameOf(q, userId, shown)
    : { kind: was!.kind, title: was!.title, href: was!.href };
  const box = { ...boxOf(named), ...(was ? { w: was.w, h: was.h } : {}) };
  const n = cards.filter((c) => c.pinned && c.id !== id).length;
  const card = clamp({
    id: was?.id ?? fresh(),
    ...named,
    ...box,
    x: was?.x ?? 1 - box.w - 0.02 - 0.02 * n,
    y: was?.y ?? 1 - box.h - 0.03 - 0.03 * n,
    ...at,
    pinned: true,
  });
  // A widget lies under every window: first in the stack.
  const layout = { cards: [card, ...cards.filter((c) => c.id !== card.id)] };
  if (!wellFormed(layout)) throw new Invalid("the desk is full");
  await saveDesktop(q, desk.id, layout);
  return widgetOf(card);
}

// Takes a widget off the person's desk.
export async function unplace(q: Query, id: string): Promise<void> {
  const desk = await holdDesktop(q);
  const cards = cardsOf(desk);
  if (!desk || !cards.some((c) => c.id === id && c.pinned))
    throw new NotFound(`no widget ${id} on the desk`);
  await saveDesktop(q, desk.id, {
    cards: cards.filter((c) => c.id !== id),
  });
}

// What a widget frames, named the way a window of it would be: a port of
// the person's own computer, or one a colleague opened to them.
async function nameOf(
  q: Query,
  userId: string,
  shown: Shown,
): Promise<Pick<Card, "kind" | "title" | "href">> {
  const title = shown.title?.trim().slice(0, 120);
  if (shown.machine) {
    const theirs = (await portsReaching(q)).find(
      (s) => s.machineId === shown.machine && s.port === shown.port,
    );
    if (!theirs)
      throw new NotFound(
        `no port ${shown.port} on ${shown.machine} is open to the person`,
      );
    return {
      kind: "port",
      title: title || `Port ${shown.port} · ${theirs.owner}'s`,
      href: `/port/${theirs.machineId}/${theirs.port}`,
    };
  }
  const c = await computerOf(q, userId);
  if (!c?.machineId) throw new Invalid("the person has no computer yet");
  return {
    kind: "port",
    title: title || `Port ${shown.port}`,
    href: `/port/${c.machineId}/${shown.port}`,
  };
}
