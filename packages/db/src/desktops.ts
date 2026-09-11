import type { Query } from "./index.ts";

// What a window can be: a record, a view over the brain, a settings page or
// one of its sections, an app on a port, or anything else with an address.
export type Kind = "port" | "record" | "brain" | "settings" | "page";

// One window on a desk: what it frames, and where it sits and how big it
// is, each as a share of the desk's width and height, so a desk laid out
// on one display reads the same on another. Later in the list is nearer
// the front.
export type Card = {
  // The window's own name, so one surface may be open in two windows.
  id: string;
  kind: Kind;
  title: string;
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

// A desk: the windows on it, in the order they stack. A desk is the size
// of the display, drawn on the canvas, and never scrolls.
export type Screen = { cards: Card[] };

export type Desktop = { id: string; position: number; layout: Screen | null };

const COLUMNS = "id, position, layout";

// The person's desks in order, as they left them.
export async function desktopsOf(q: Query): Promise<Desktop[]> {
  return (
    await q.query<Desktop>(`select ${COLUMNS} from desktops order by position`)
  ).rows;
}

// A new desk after the last, holding these windows.
export async function addDesktop(
  q: Query,
  layout: Screen | null,
): Promise<Desktop> {
  const { rows } = await q.query<Desktop>(
    `insert into desktops (position, layout)
     values ((select coalesce(max(position) + 1, 0) from desktops), $1::jsonb)
     returning ${COLUMNS}`,
    [layout === null ? null : JSON.stringify(layout)],
  );
  return rows[0]!;
}

// The desk as it now is. Null when it is not theirs.
export async function saveDesktop(
  q: Query,
  id: string,
  layout: Screen | null,
): Promise<Desktop | null> {
  const { rows } = await q.query<Desktop>(
    `update desktops set layout = $2::jsonb where id = $1 returning ${COLUMNS}`,
    [id, layout === null ? null : JSON.stringify(layout)],
  );
  return rows[0] ?? null;
}

// Takes a desk away. Whether there was one.
export async function removeDesktop(q: Query, id: string): Promise<boolean> {
  const { rowCount } = await q.query("delete from desktops where id = $1", [
    id,
  ]);
  return (rowCount ?? 0) > 0;
}
