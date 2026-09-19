import type { Query } from "./index.ts";

// What a window can be: a record, a view over the brain, a settings page or
// one of its sections, an app on a port, or anything else with an address.
export type Kind = "port" | "record" | "brain" | "settings" | "page";

// One window on a desktop: what it frames, and where it sits and how big it
// is, each as a share of the desktop's width and height, so a desktop laid out
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
  // Minimize in the dock, keeping the place it will come back to.
  minimized?: boolean;
  // Filling the whole desktop, keeping the place it will come back to.
  full?: boolean;
  // On the desktop itself, behind every window and with no bar: a widget.
  pinned?: boolean;
  // Which of the person's desktops it is on; the first when unsaid.
  desk?: number;
  // The desktop a window filling the screen came from: a filled window is
  // a desktop of its own, and goes back when it is let down.
  home?: number;
  // Where a widget lies on a phone, apart from where it lies on a laptop,
  // since the two desktops are not the same shape.
  phone?: { x: number; y: number; w: number; h: number };
};

// A desktop: the windows on it, in the order they stack. A desktop is the size
// of the display, drawn on the canvas, and never scrolls.
export type Screen = { cards: Card[] };

// A desktop, with how many times it has been kept: a save names the count it
// rests on, and one resting on an older count is refused.
export type SavedDesktop = {
  id: string;
  position: number;
  layout: Screen | null;
  rev: number;
};

const COLUMNS = "id, position, layout, rev";

// The person's desktops in order, as they left them.
export async function desktopsOf(q: Query): Promise<SavedDesktop[]> {
  return (
    await q.query<SavedDesktop>(
      `select ${COLUMNS} from desktops order by position`,
    )
  ).rows;
}

// A new desktop after the last, holding these windows.
export async function addDesktop(
  q: Query,
  layout: Screen | null,
): Promise<SavedDesktop> {
  const { rows } = await q.query<SavedDesktop>(
    `insert into desktops (position, layout)
     values ((select coalesce(max(position) + 1, 0) from desktops), $1::jsonb)
     returning ${COLUMNS}`,
    [layout === null ? null : JSON.stringify(layout)],
  );
  return rows[0]!;
}

// The desktop as it now is. Null when it is not theirs, or when it names a
// count the desktop has moved past.
export async function saveDesktop(
  q: Query,
  id: string,
  layout: Screen | null,
  rev?: number,
): Promise<SavedDesktop | null> {
  const { rows } = await q.query<SavedDesktop>(
    `update desktops set layout = $2::jsonb, rev = rev + 1
     where id = $1 and ($3::int is null or rev = $3)
     returning ${COLUMNS}`,
    [id, layout === null ? null : JSON.stringify(layout), rev ?? null],
  );
  return rows[0] ?? null;
}

// The person's first desktop, held against anyone else changing it for the
// rest of the transaction.
export async function holdDesktop(q: Query): Promise<SavedDesktop | null> {
  const { rows } = await q.query<SavedDesktop>(
    `select ${COLUMNS} from desktops order by position limit 1 for update`,
  );
  return rows[0] ?? null;
}
