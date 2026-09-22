import type { Query } from "./index.ts";

// Something the agent asked to open for the person: where, and its name.
export type Open = { href: string; title: string };

// Leaves something to be opened on the person's page.
export async function askOpen(q: Query, open: Open): Promise<void> {
  await q.query("insert into open_requests (href, title) values ($1, $2)", [
    open.href,
    open.title,
  ]);
}

// What waits to be opened, taken as it is read so each opens once, oldest
// first. One nobody took within two minutes is dropped unopened: a page
// that arrives later should not have things spring open from before.
export async function takeOpens(q: Query): Promise<Open[]> {
  const taken = await q.query<Open & { fresh: boolean }>(
    `delete from open_requests
     returning href, title, asked_at > now() - interval '2 minutes' as fresh, asked_at`,
  );
  return taken.rows
    .filter((o) => o.fresh)
    .map(({ href, title }) => ({ href, title }));
}
