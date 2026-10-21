import type pg from "pg";

// What waits on one person: a note their agent left them, or an ask it
// cannot answer itself. Nobody else in the org ever sees one. Every door
// here runs inside a transaction opened as the person.

// A client inside a person-scoped transaction.
type Query = pg.ClientBase;

export type Notification = {
  id: string;
  kind: "note" | "ask";
  title: string;
  body: string;
  // Who wrote it: the app connected as the person, or the person.
  from: string;
  records: string[];
  options: string[];
  answer: string | null;
  // The ask to share this notification carries, if it is one.
  request: string | null;
  // The conversation on the person's computer the answer goes back to,
  // where the ask named one.
  replyTo: string | null;
  readAt: string | null;
  createdAt: string;
};

const columns = `id, kind, title, body,
  regexp_replace(author, '^model:', '') as "from",
  records, options, answer, request_id as request, reply_to as "replyTo",
  read_at as "readAt", created_at as "createdAt"`;

// Thrown when a notification cannot be answered as asked.
export class Unanswerable extends Error {}

// Leaves a notification for the person whose transaction this is, in the name
// the transaction carries.
export async function leaveNotification(
  q: Query,
  n: {
    kind: "note" | "ask";
    title: string;
    body?: string;
    records?: string[];
    options?: string[];
    request?: string;
    replyTo?: string;
  },
): Promise<Notification> {
  const title = n.title.trim();
  if (!title) throw new Unanswerable("a notification needs a title");
  const { rows } = await q.query<Notification>(
    `insert into notifications
       (kind, title, body, records, options, request_id, reply_to)
     values ($1, $2, $3, $4, $5, $6, $7) returning ${columns}`,
    [
      n.kind,
      title,
      n.body?.trim() ?? "",
      n.records ?? [],
      n.kind === "ask" ? (n.options ?? []) : [],
      n.request ?? null,
      n.kind === "ask" ? (n.replyTo ?? null) : null,
    ],
  );
  return rows[0]!;
}

// Leaves a note for another member of the org, in the name given: what a
// share landing says to the person it reached.
export async function tellNotification(
  q: Query,
  personId: string,
  n: { title: string; body?: string; from: string },
): Promise<Notification> {
  const { rows } = await q.query<Notification>(
    `insert into notifications (person_id, kind, title, body, author)
     values ($1, 'note', $2, $3, $4) returning ${columns}`,
    [personId, n.title.trim(), n.body?.trim() ?? "", n.from],
  );
  return rows[0]!;
}

// The person's notifications, newest first.
export async function notificationsOf(
  q: Query,
  only: { unanswered?: boolean; limit?: number } = {},
): Promise<Notification[]> {
  const { rows } = await q.query<Notification>(
    `select ${columns} from notifications
     where (not $1::boolean or (kind = 'ask' and answer is null))
     order by created_at desc, id desc limit $2`,
    [only.unanswered ?? false, only.limit ?? 100],
  );
  return rows;
}

export async function notificationOf(
  q: Query,
  id: string,
): Promise<Notification | null> {
  const { rows } = await q.query<Notification>(
    `select ${columns} from notifications where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// How much waits on the person: asks nobody has answered, and notifications
// nobody has looked at.
export async function notificationCounts(
  q: Query,
): Promise<{ waiting: number; unread: number }> {
  const { rows } = await q.query<{ waiting: string; unread: string }>(
    `select count(*) filter (where kind = 'ask' and answer is null) as waiting,
            count(*) filter (where read_at is null) as unread
     from notifications`,
  );
  return { waiting: Number(rows[0]!.waiting), unread: Number(rows[0]!.unread) };
}

// Marks every notification the person has now seen.
export async function markRead(q: Query): Promise<void> {
  await q.query(
    "update notifications set read_at = now() where read_at is null",
  );
}

// Clears what the person is done with: every note, and every ask they
// have answered. An ask still waiting on them stays until it is.
export async function clearDone(q: Query): Promise<number> {
  const { rowCount } = await q.query(
    `delete from notifications where kind = 'note' or answer is not null`,
  );
  return rowCount ?? 0;
}

// Answers an ask: the option chosen, or what the person typed where an
// ask offers none. Answering twice is refused, so the answer the asker
// reads is the one the person gave.
export async function answerNotification(
  q: Query,
  id: string,
  answer: string,
): Promise<Notification> {
  const said = answer.trim();
  if (!said) throw new Unanswerable("an answer says something");
  const notification = await notificationOf(q, id);
  if (!notification) throw new Unanswerable(`no notification ${id}`);
  if (notification.kind !== "ask")
    throw new Unanswerable("a note asks nothing");
  if (notification.answer !== null)
    throw new Unanswerable(
      `that ask is already answered "${notification.answer}"`,
    );
  if (notification.options.length > 0 && !notification.options.includes(said))
    throw new Unanswerable(`answer with ${notification.options.join(" or ")}`);
  const { rows } = await q.query<Notification>(
    `update notifications set answer = $2, read_at = coalesce(read_at, now())
     where id = $1 and answer is null returning ${columns}`,
    [id, said],
  );
  if (!rows[0]) throw new Unanswerable("that ask is already answered");
  return rows[0];
}

// Marks the notification that carried an ask to share with the answer the
// person gave it elsewhere, so one ask never waits in two places, and
// answers with that notification's id, or null where none carried it.
export async function answerRequestNotification(
  q: Query,
  request: string,
  answer: string,
): Promise<string | null> {
  const { rows } = await q.query<{ id: string }>(
    `update notifications set answer = $2, read_at = coalesce(read_at, now())
     where request_id = $1 and answer is null
     returning id`,
    [request, answer],
  );
  return rows[0]?.id ?? null;
}
