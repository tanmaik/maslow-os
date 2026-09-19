import { Invalid, NotFound } from "@maslow/brain";
import { asPerson, type Query } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { appsOn, computerOf, portsReaching } from "@maslow/db/computers";
import {
  addDesktop,
  desktopsOf,
  holdDesktop,
  saveDesktop,
  type Card,
  type SavedDesktop,
  type Kind,
  type Screen,
} from "@maslow/db/desktops";
import type { SharedPort } from "@maslow/db/computers";
import { wallpaperOf } from "@maslow/db/wallpapers";

import { boxOf } from "@/app/desktop/apps";
import { clamp, fresh, MIN, share, type Port } from "@/app/desktop/tiles";

import { publishedOf, sharedWithMe, sharingOf, statsOf } from "./computer.ts";

// The room as the person left it, one desktop at least, the wallpaper it
// lies on, and the ports they could place: their own open ones and those
// other people opened to them.
export async function desktopOf(p: Principal): Promise<{
  desktops: SavedDesktop[];
  ports: Port[];
  wallpaper: string | null;
}> {
  const [{ desktops, wallpaper }, ports] = await Promise.all([
    asPerson(p, async (q) => {
      const wallpaper = await wallpaperOf(q);
      // The first desktop is made once, whether the page or the agent asks
      // first.
      await q.query("select pg_advisory_xact_lock(hashtext($1))", [
        `desktop:${p.userId}`,
      ]);
      const had = await desktopsOf(q);
      return {
        desktops: had.length > 0 ? had : [await addDesktop(q, null)],
        wallpaper,
      };
    }),
    // A computer that does not answer never takes the desktop down: the room
    // opens without its ports, the Computer pane says the door is silent,
    // and the next ask puts them back.
    portsOf(p).catch(() => []),
  ]);
  return { desktops, ports, wallpaper };
}

// The apps a person can open: the ports of their own computer they have
// published, each as they named it, only while it is listening this
// moment; and the ports other people opened to them, wearing the name and
// face their owner published them under, or saying whose they are. Their
// own listening ports never published come too, marked bare, so one asked
// for by number still opens.
export async function portsOf(p: Principal): Promise<Port[]> {
  const [mine, shared, published] = await Promise.all([
    sharingOf(p),
    sharedWithMe(p),
    publishedOf(p),
  ]);
  // A computer that does not answer is not one with no ports: the ask
  // fails, and the room keeps what it knew.
  const stats = mine ? await statsOf(p) : null;
  const live = new Map((stats?.ports ?? []).map((x) => [x.port, x]));
  return [
    ...(mine
      ? published
          .filter((a) => live.has(a.port))
          .map((a) => ({
            title: a.name,
            href: `/port/${mine.machineId}/${a.port}`,
            face: a.icon ?? live.get(a.port)?.face,
          }))
      : []),
    ...(mine
      ? [...live.values()]
          .filter((x) => !published.some((a) => a.port === x.port))
          .map((x) => ({
            title: `Port ${x.port}`,
            href: `/port/${mine.machineId}/${x.port}`,
            ...(x.face ? { face: x.face } : {}),
            bare: true as const,
          }))
      : []),
    ...shared.map((s) => ({
      title: s.name ?? `Port ${s.port} · ${s.owner}'s`,
      href: `/port/${s.machineId}/${s.port}`,
      ...(s.icon ? { face: s.icon } : {}),
    })),
  ];
}

// --- Keeping a desktop ----------------------------------------------------

// Whether a desktop is well formed: every window framing a path on our own
// site and no other, no longer than an address goes, sitting inside the
// desktop at no less than the smallest size, no two windows of one name, and
// not too many. Nothing can be parked in the table.
const KINDS = new Set<Kind>(["port", "record", "brain", "settings", "page"]);
// A place on a phone's desktop: four shares.
const spot = (p: unknown) =>
  !!p &&
  typeof p === "object" &&
  (["x", "y", "w", "h"] as const).every((k) =>
    share((p as Record<string, unknown>)[k]),
  );
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
      (c.minimized === undefined || typeof c.minimized === "boolean") &&
      (c.pinned === undefined || typeof c.pinned === "boolean") &&
      (c.phone === undefined || spot(c.phone)) &&
      !seen.has(c.id);
    if (!ok) return false;
    seen.add(c.id as string);
  }
  return true;
}

// Keeps a desktop as the browser left it, resting on the count it saw. Null
// when the desktop is not well formed or not theirs; "behind" when the desktop
// has moved past that count, with the desktop as it now is.
export async function keep(
  p: Principal,
  id: string,
  layout: unknown,
  rev: number,
): Promise<SavedDesktop | { behind: SavedDesktop } | null> {
  if (!wellFormed(layout)) return null;
  return asPerson(p, async (q) => {
    const kept = await saveDesktop(q, id, layout, rev);
    if (kept) return kept;
    const now = (await desktopsOf(q)).find((d) => d.id === id);
    return now ? { behind: now } : null;
  });
}

// The desktop, and how many times it has been kept, for a page asking
// whether it changed elsewhere.
export async function desktopNow(q: Query): Promise<SavedDesktop | null> {
  return (await desktopsOf(q))[0] ?? null;
}

// --- The desktop as the agent has it ----------------------------------------

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

// A desktop's windows and widgets; none where there is no desktop yet.
const cardsOf = (desktop: SavedDesktop | null): Card[] =>
  desktop?.layout?.cards ?? [];

// What lies on the person's desktop: the widgets, and nothing of the windows,
// which are the person's; and the ports that could lie there beside the
// person's own, those colleagues opened to them.
export async function widgetsOf(
  q: Query,
): Promise<{ widgets: Widget[]; shared: SharedPort[] }> {
  const widgets = cardsOf((await desktopsOf(q))[0] ?? null)
    .filter((c) => c.pinned && !c.minimized)
    .map(widgetOf);
  return { widgets, shared: await portsReaching(q) };
}

// What a widget shows: an app served on a port, of the person's own
// computer, or of a colleague's that was opened to them.
export type Shown = { port: number; machine?: string; title?: string };

// Where a widget lies, as shares of the desktop from its top left corner.
export type Spot = Partial<Pick<Card, "x" | "y" | "w" | "h">>;

// Puts a widget on the person's desktop, or moves one already there, which
// keeps what it shows unless told otherwise: at the spot given, or where
// the next widget goes. Answers the widget.
export async function place(
  q: Query,
  userId: string,
  shown: Shown | null,
  at: Spot,
  id?: string,
): Promise<Widget> {
  // One placing at a time per person, so two before their first desktop
  // exists make one desktop, not two.
  await q.query("select pg_advisory_xact_lock(hashtext($1))", [
    `desktop:${userId}`,
  ]);
  const desktop = (await holdDesktop(q)) ?? (await addDesktop(q, null));
  const cards = cardsOf(desktop);
  const was = id ? cards.find((c) => c.id === id && c.pinned) : undefined;
  if (id && !was) throw new NotFound(`no widget ${id} on the desktop`);
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
  if (!wellFormed(layout)) throw new Invalid("the desktop is full");
  await saveDesktop(q, desktop.id, layout);
  return widgetOf(card);
}

// Takes a widget off the person's desktop.
export async function unplace(q: Query, id: string): Promise<void> {
  const desktop = await holdDesktop(q);
  const cards = cardsOf(desktop);
  if (!desktop || !cards.some((c) => c.id === id && c.pinned))
    throw new NotFound(`no widget ${id} on the desktop`);
  await saveDesktop(q, desktop.id, {
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
      title: title || theirs.name || `Port ${shown.port} · ${theirs.owner}'s`,
      href: `/port/${theirs.machineId}/${theirs.port}`,
    };
  }
  const c = await computerOf(q, userId);
  if (!c?.machineId) throw new Invalid("the person has no computer yet");
  // Only an app lies on the desktop: a port never published is a port.
  const own = (await appsOn(q, c.id)).find((a) => a.port === shown.port);
  if (!own) throw new NotFound(`port ${shown.port} is not published as an app`);
  return {
    kind: "port",
    title: title || own.name,
    href: `/port/${c.machineId}/${shown.port}`,
  };
}
