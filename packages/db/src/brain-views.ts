import type { Query } from "./index.ts";

// How a person left one list of their brain: the address's own query, kept
// so the next visit opens where the last one ended. The brain reads it and
// says what it means; the database only holds it.

// What the person last left this list on, or null when they never set one.
export async function viewOf(
  q: Query,
  subject: string,
): Promise<string | null> {
  const { rows } = await q.query<{ state: string }>(
    `select state from brain_views where subject = $1`,
    [subject],
  );
  return rows[0]?.state ?? null;
}

// Remembers how this list is being looked at now.
export async function rememberView(
  q: Query,
  subject: string,
  state: string,
): Promise<void> {
  await q.query(
    `insert into brain_views (subject, state) values ($1, $2)
     on conflict (org_id, member_id, subject)
     do update set state = excluded.state, updated_at = now()`,
    [subject, state],
  );
}
