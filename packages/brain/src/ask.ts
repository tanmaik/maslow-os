import { Invalid, NotFound } from "./errors.ts";
import { need, share } from "./share.ts";
import type { Access, Query, Subject, Target } from "./types.ts";

// The agent does not share; it asks. A request names what to share, with
// whom, at what level and why, and waits for the owner to accept or decline
// it. Accepting makes the shares in the owner's name.

// What an ask may name: a record or a type of the brain's, or a port on the
// person's computer, which is only ever looked at.
type Asked = Target | { port: number };

export type ShareRequest = {
  id: string;
  items: Asked[];
  subjects: Subject[];
  level: Access;
  reason: string;
};

// Gives one port of the caller's computer to one subject; the computer is
// not the brain's to reach, so whoever accepts an ask hands this in.
type GivePort = (port: number, subject: Subject) => Promise<void>;

// Whom to share with, as an asker names them: "everyone", a colleague's
// email (it has an @), or a group's name (it does not).
export type Whom = string;

type Row = {
  id: string;
  items: Asked[];
  subjects: Subject[];
  level: Access;
  reason: string;
};

const columns = "id, items, subjects, level, reason";

const LEVELS = new Set<string>(["view", "edit", "owner"]);

// Resolves the people named to subjects in this org, refusing a name that
// is nobody's. The word everyone is the org; an email is a member; any other
// name is a group.
async function whom(q: Query, to: Whom[]): Promise<Subject[]> {
  const out: Subject[] = [];
  for (const name of new Set(to.map((s) => s.trim()))) {
    if (name === "everyone") {
      out.push({ who: "everyone" });
      continue;
    }
    const who = name.includes("@") ? "member" : "group";
    const { rows } = await q.query<{ id: string }>(
      who === "member"
        ? "select id from users where email = $1"
        : "select id from groups where name = $1",
      [name],
    );
    if (!rows[0]) {
      throw new NotFound(
        who === "member"
          ? `nobody in this org has the email "${name}"`
          : `this org has no group "${name}"`,
      );
    }
    out.push({ who, id: rows[0].id });
  }
  return out;
}

// The caller's own type of this name, by id.
async function ownType(q: Query, name: string): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    "select id from types where name = $1 and person_id = current_member() and deleted_at is null",
    [name],
  );
  if (!rows[0]) throw new NotFound(`no type "${name}" in your vocabulary`);
  return rows[0].id;
}

// Writes down an ask: these records and types of the caller's, to these
// people, at this level, for this reason. Nothing is shared by it.
export async function askToShare(
  q: Query,
  ask: {
    records?: string[];
    types?: string[];
    ports?: number[];
    to: Whom[];
    level: Access;
    reason: string;
  },
): Promise<ShareRequest> {
  if (!LEVELS.has(ask.level))
    throw new Invalid(`"${ask.level}" is not a level`);
  if (!ask.reason.trim()) throw new Invalid("an ask needs a reason");
  const items: Asked[] = [];
  for (const id of new Set(ask.records ?? [])) {
    await need(q, id, "owner");
    items.push({ record: id });
  }
  for (const name of new Set(ask.types ?? [])) {
    items.push({ type: await ownType(q, name) });
  }
  for (const port of new Set(ask.ports ?? [])) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Invalid(`${port} is not a port`);
    if (ask.level !== "view")
      throw new Invalid("a port is only ever looked at; ask at view");
    items.push({ port });
  }
  if (items.length === 0)
    throw new Invalid("an ask names a record, a type or a port");
  const subjects = await whom(q, ask.to);
  if (subjects.some((s) => s.who === "everyone") && ask.level !== "view") {
    throw new Invalid("everyone can only be given view");
  }
  const { rows } = await q.query<Row>(
    `insert into share_requests (items, subjects, level, reason)
     values ($1::jsonb, $2::jsonb, $3, $4) returning ${columns}`,
    [
      JSON.stringify(items),
      JSON.stringify(subjects),
      ask.level,
      ask.reason.trim(),
    ],
  );
  return rows[0]!;
}

// How much waits on the caller: their open asks to share.
export async function waiting(q: Query): Promise<number> {
  const { rows } = await q.query<{ n: string }>(
    "select count(*) as n from share_requests",
  );
  return Number(rows[0]!.n);
}

// The caller's open asks, oldest first.
export async function requestsOf(q: Query): Promise<ShareRequest[]> {
  const { rows } = await q.query<Row>(
    `select ${columns} from share_requests order by id`,
  );
  return rows;
}

async function take(q: Query, id: string): Promise<Row> {
  const { rows } = await q.query<Row>(
    `delete from share_requests where id = $1 returning ${columns}`,
    [id],
  );
  if (!rows[0]) throw new NotFound(`no ask ${id} waiting for you`);
  return rows[0];
}

// What an ask still names: a record or a type removed since the ask was
// written is left out, since nobody could see it anyway. A port stays: the
// door decides what listens there.
async function stillThere(q: Query, items: Asked[]): Promise<Asked[]> {
  const records = items.flatMap((it) => ("record" in it ? [it.record] : []));
  const types = items.flatMap((it) => ("type" in it ? [it.type] : []));
  const { rows } = await q.query<{ id: string }>(
    `select id from records where id = any($1::text[]) and deleted_at is null
     union all
     select id::text from types where id = any($2::uuid[]) and deleted_at is null`,
    [records, types],
  );
  const live = new Set(rows.map((r) => r.id));
  return items.filter(
    (it) => "port" in it || live.has("record" in it ? it.record : it.type),
  );
}

// Who an ask still names: a member who has left or a group deleted since
// the ask was written is left out.
async function stillHere(q: Query, subjects: Subject[]): Promise<Subject[]> {
  const members = subjects.flatMap((s) => (s.who === "member" ? [s.id] : []));
  const groups = subjects.flatMap((s) => (s.who === "group" ? [s.id] : []));
  const { rows } = await q.query<{ id: string }>(
    `select id from users where id = any($1::uuid[])
     union all
     select id from groups where id = any($2::uuid[])`,
    [members, groups],
  );
  const here = new Set(rows.map((r) => r.id));
  return subjects.filter((s) => s.who === "everyone" || here.has(s.id));
}

// Accepts an ask: everything it still names, to everyone it still names, at
// its level, in the caller's name; then the ask is gone. A port named is
// given through the hand passed in, since the computer is not the brain's.
// Returns how many shares it made.
export async function acceptRequest(
  q: Query,
  id: string,
  givePort?: GivePort,
): Promise<number> {
  const ask = await take(q, id);
  let made = 0;
  const subjects = await stillHere(q, ask.subjects);
  for (const item of await stillThere(q, ask.items)) {
    for (const subject of subjects) {
      if ("port" in item) {
        if (!givePort) throw new Invalid("nothing here gives a port away");
        await givePort(item.port, subject);
      } else await share(q, item, subject, ask.level);
      made += 1;
    }
  }
  return made;
}

// Declines an ask: nothing is shared and the ask is gone.
export async function declineRequest(q: Query, id: string): Promise<void> {
  await take(q, id);
}
