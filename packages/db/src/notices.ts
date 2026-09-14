import type pg from "pg";

// What waits on one person: a note their agent left them, or an ask it
// cannot answer itself. Nobody else in the org ever sees one. Every door
// here runs inside a transaction opened as the person.

// A client inside a person-scoped transaction.
type Query = pg.ClientBase;

export type Notice = {
  id: string;
  kind: "note" | "ask";
  title: string;
  body: string;
  // Who wrote it: the app connected as the person, or the person.
  from: string;
  records: string[];
  options: string[];
  answer: string | null;
  // The ask to share this notice carries, if it is one.
  request: string | null;
  readAt: string | null;
  createdAt: string;
};

const columns = `id, kind, title, body,
  regexp_replace(author, '^model:', '') as "from",
  records, options, answer, request_id as request,
  read_at as "readAt", created_at as "createdAt"`;

// Thrown when a notice cannot be answered as asked.
export class Unanswerable extends Error {}

// Leaves a notice for the person whose transaction this is, in the name
// the transaction carries.
export async function leaveNotice(
  q: Query,
  n: {
    kind: "note" | "ask";
    title: string;
    body?: string;
    records?: string[];
    options?: string[];
    request?: string;
  },
): Promise<Notice> {
  const title = n.title.trim();
  if (!title) throw new Unanswerable("a notice needs a title");
  const { rows } = await q.query<Notice>(
    `insert into notices (kind, title, body, records, options, request_id)
     values ($1, $2, $3, $4, $5, $6) returning ${columns}`,
    [
      n.kind,
      title,
      n.body?.trim() ?? "",
      n.records ?? [],
      n.kind === "ask" ? (n.options ?? []) : [],
      n.request ?? null,
    ],
  );
  return rows[0]!;
}

// The person's notices, newest first.
export async function noticesOf(
  q: Query,
  only: { unanswered?: boolean; limit?: number } = {},
): Promise<Notice[]> {
  const { rows } = await q.query<Notice>(
    `select ${columns} from notices
     where (not $1::boolean or (kind = 'ask' and answer is null))
     order by created_at desc, id desc limit $2`,
    [only.unanswered ?? false, only.limit ?? 100],
  );
  return rows;
}

export async function noticeOf(q: Query, id: string): Promise<Notice | null> {
  const { rows } = await q.query<Notice>(
    `select ${columns} from notices where id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

// How much waits on the person: asks nobody has answered, and notices
// nobody has looked at.
export async function noticeCounts(
  q: Query,
): Promise<{ waiting: number; unread: number }> {
  const { rows } = await q.query<{ waiting: string; unread: string }>(
    `select count(*) filter (where kind = 'ask' and answer is null) as waiting,
            count(*) filter (where read_at is null) as unread
     from notices`,
  );
  return { waiting: Number(rows[0]!.waiting), unread: Number(rows[0]!.unread) };
}

// Marks every notice the person has now seen.
export async function markRead(q: Query): Promise<void> {
  await q.query("update notices set read_at = now() where read_at is null");
}

// Clears what is done with: notices read, and asks already answered. An
// ask still waiting stays however often it has been seen.
export async function clearRead(q: Query): Promise<number> {
  const { rowCount } = await q.query(
    `delete from notices
     where read_at is not null and (kind = 'note' or answer is not null)`,
  );
  return rowCount ?? 0;
}

// Answers an ask: the option chosen, or what the person typed where an
// ask offers none. Answering twice is refused, so the answer the asker
// reads is the one the person gave.
export async function answerNotice(
  q: Query,
  id: string,
  answer: string,
): Promise<Notice> {
  const said = answer.trim();
  if (!said) throw new Unanswerable("an answer says something");
  const notice = await noticeOf(q, id);
  if (!notice) throw new Unanswerable(`no notice ${id}`);
  if (notice.kind !== "ask") throw new Unanswerable("a note asks nothing");
  if (notice.answer !== null)
    throw new Unanswerable(`that ask is already answered "${notice.answer}"`);
  if (notice.options.length > 0 && !notice.options.includes(said))
    throw new Unanswerable(`answer with ${notice.options.join(" or ")}`);
  const { rows } = await q.query<Notice>(
    `update notices set answer = $2, read_at = coalesce(read_at, now())
     where id = $1 and answer is null returning ${columns}`,
    [id, said],
  );
  if (!rows[0]) throw new Unanswerable("that ask is already answered");
  return rows[0];
}

// Marks the notice that carried an ask to share with the answer the
// person gave it elsewhere, so one ask never waits in two places, and
// answers with that notice's id, or null where none carried it.
export async function answerRequestNotice(
  q: Query,
  request: string,
  answer: string,
): Promise<string | null> {
  const { rows } = await q.query<{ id: string }>(
    `update notices set answer = $2, read_at = coalesce(read_at, now())
     where request_id = $1 and answer is null
     returning id`,
    [request, answer],
  );
  return rows[0]?.id ?? null;
}
