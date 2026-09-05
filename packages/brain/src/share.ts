import { Forbidden, Invalid, NotFound } from "./errors.ts";
import type { Access, Author, Grant, Query, Subject, Target } from "./types.ts";

const RANK: Record<Access, number> = { view: 1, edit: 2, owner: 3 };

// What the current member may do with a record, or null when they cannot
// see it at all.
async function accessOf(q: Query, id: string): Promise<Access | null> {
  const { rows } = await q.query<{ access: Access | null }>(
    "select access_level($1) as access from records where id = $1",
    [id],
  );
  return rows[0]?.access ?? null;
}

// Refuses unless the current member may do this much with the record.
export async function need(q: Query, id: string, level: Access) {
  const have = await accessOf(q, id);
  if (!have) throw new NotFound(`record ${id} is not in this brain`);
  if (RANK[have] < RANK[level]) {
    throw new Forbidden(`you may ${have} this record, not ${level} it`);
  }
}

// Refuses unless the current member may see the kind, or for a share, owns
// it: a kind is shared by whoever defined it and nobody else.
async function needKind(q: Query, id: string, level: "view" | "owner") {
  const { rows } = await q.query<{ own: boolean }>(
    "select person_id = current_member() as own from record_kinds where id = $1",
    [id],
  );
  if (!rows[0]) throw new NotFound(`kind ${id} is not in this brain`);
  if (level === "owner" && !rows[0].own) {
    throw new Forbidden("only the kind's owner shares it");
  }
}

const allowed = (q: Query, on: Target, level: "view" | "owner") =>
  "record" in on ? need(q, on.record, level) : needKind(q, on.kind, level);

type GrantRow = {
  id: string;
  record_id: string | null;
  kind_id: string | null;
  subject: Subject["kind"];
  member_id: string | null;
  group_id: string | null;
  level: Access;
  author: string;
  created_at: Date;
};

const toGrant = (g: GrantRow): Grant => ({
  id: g.id,
  on: g.record_id ? { record: g.record_id } : { kind: g.kind_id! },
  subject:
    g.subject === "everyone"
      ? { kind: "everyone" }
      : g.subject === "group"
        ? { kind: "group", id: g.group_id! }
        : { kind: "member", id: g.member_id! },
  level: g.level,
  author: g.author,
  createdAt: g.created_at,
});

const columns =
  "id, record_id, kind_id, subject, member_id, group_id, level, author, created_at";

const recordId = (on: Target) => ("record" in on ? on.record : null);
const kindId = (on: Target) => ("kind" in on ? on.kind : null);
const memberId = (s: Subject) => (s.kind === "member" ? s.id : null);
const groupId = (s: Subject) => (s.kind === "group" ? s.id : null);

// Every share on a record or a kind, for anyone who can see it.
export async function grantsOf(q: Query, on: Target): Promise<Grant[]> {
  await allowed(q, on, "view");
  const { rows } = await q.query<GrantRow>(
    `select ${columns} from grants
     where record_id is not distinct from $1 and kind_id is not distinct from $2
     order by created_at, id`,
    [recordId(on), kindId(on)],
  );
  return rows.map(toGrant);
}

// Lets a member, a group or everyone do this much with a record, or with
// every record of a kind. Sharing again with the same subject changes the
// level.
export async function share(
  q: Query,
  author: Author,
  on: Target,
  subject: Subject,
  level: Access,
): Promise<Grant> {
  await allowed(q, on, "owner");
  if (!(level in RANK)) throw new Invalid(`"${String(level)}" is not a level`);
  if (subject.kind === "everyone" && level !== "view") {
    throw new Invalid("everyone can only be given view");
  }
  const { rows } = await q
    .query<GrantRow>(
      `insert into grants
         (record_id, kind_id, subject, member_id, group_id, level, author)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (org_id, record_id, kind_id, subject, member_id, group_id)
         do update set level = excluded.level, author = excluded.author
       returning ${columns}`,
      [
        recordId(on),
        kindId(on),
        subject.kind,
        memberId(subject),
        groupId(subject),
        level,
        author,
      ],
    )
    .catch((err) => {
      if ((err as { code?: string }).code === "23503") {
        throw new NotFound(`no such ${subject.kind} in this org`);
      }
      throw err;
    });
  return toGrant(rows[0]!);
}

// Takes a share away. Taking away one that is not there changes nothing.
export async function unshare(
  q: Query,
  on: Target,
  subject: Subject,
): Promise<void> {
  await allowed(q, on, "owner");
  await q.query(
    `delete from grants
     where record_id is not distinct from $1
       and kind_id is not distinct from $2
       and subject = $3
       and member_id is not distinct from $4
       and group_id is not distinct from $5`,
    [
      recordId(on),
      kindId(on),
      subject.kind,
      memberId(subject),
      groupId(subject),
    ],
  );
}
