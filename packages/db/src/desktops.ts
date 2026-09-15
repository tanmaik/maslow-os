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
  // Put away in the dock, keeping the place it will come back to.
  stowed?: boolean;
  // On the desk itself, behind every window and with no bar: a widget.
  pinned?: boolean;
};

// A desk: the windows on it, in the order they stack. A desk is the size
// of the display, drawn on the canvas, and never scrolls.
export type Screen = { cards: Card[] };

// A desk, with how many times it has been kept: a save names the count it
// rests on, and one resting on an older count is refused.
export type Desktop = {
  id: string;
  position: number;
  layout: Screen | null;
  rev: number;
};

const COLUMNS = "id, position, layout, rev";

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

// The desk as it now is. Null when it is not theirs, or when it names a
// count the desk has moved past.
export async function saveDesktop(
  q: Query,
  id: string,
  layout: Screen | null,
  rev?: number,
): Promise<Desktop | null> {
  const { rows } = await q.query<Desktop>(
    `update desktops set layout = $2::jsonb, rev = rev + 1
     where id = $1 and ($3::int is null or rev = $3)
     returning ${COLUMNS}`,
    [id, layout === null ? null : JSON.stringify(layout), rev ?? null],
  );
  return rows[0] ?? null;
}

// The person's first desk, held against anyone else changing it for the
// rest of the transaction.
export async function holdDesktop(q: Query): Promise<Desktop | null> {
  const { rows } = await q.query<Desktop>(
    `select ${COLUMNS} from desktops order by position limit 1 for update`,
  );
  return rows[0] ?? null;
}
