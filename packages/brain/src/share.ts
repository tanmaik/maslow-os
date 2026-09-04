import { Forbidden, Invalid, NotFound } from "./errors.ts";
import type { Access, Author, Grant, Query, Subject } from "./types.ts";

const RANK: Record<Access, number> = { view: 1, edit: 2, owner: 3 };

// What the current member may do with a record, or null when they cannot
// see it at all.
export async function accessOf(q: Query, id: string): Promise<Access | null> {
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

type GrantRow = {
  id: string;
  record_id: string;
  subject: Subject["kind"];
  member_id: string | null;
  group_id: string | null;
  level: Access;
  author: string;
  created_at: Date;
};

const toGrant = (g: GrantRow): Grant => ({
  id: g.id,
  recordId: g.record_id,
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
  "id, record_id, subject, member_id, group_id, level, author, created_at";

// Every share on a record, for anyone who can see the record.
export async function grantsOf(q: Query, id: string): Promise<Grant[]> {
  await need(q, id, "view");
  const { rows } = await q.query<GrantRow>(
    `select ${columns} from grants where record_id = $1 order by created_at, id`,
    [id],
  );
  return rows.map(toGrant);
}

const memberId = (s: Subject) => (s.kind === "member" ? s.id : null);
const groupId = (s: Subject) => (s.kind === "group" ? s.id : null);

// Lets a member, a group or everyone do this much with a record. Sharing
// again with the same subject changes the level.
export async function share(
  q: Query,
  author: Author,
  id: string,
  subject: Subject,
  level: Access,
): Promise<Grant> {
  await need(q, id, "owner");
  if (!(level in RANK)) throw new Invalid(`"${String(level)}" is not a level`);
  if (subject.kind === "everyone" && level !== "view") {
    throw new Invalid("everyone can only be given view");
  }
  const { rows } = await q
    .query<GrantRow>(
      `insert into grants
         (record_id, subject, member_id, group_id, level, author)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (org_id, record_id, subject, member_id, group_id)
         do update set level = excluded.level, author = excluded.author
       returning ${columns}`,
      [id, subject.kind, memberId(subject), groupId(subject), level, author],
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
  id: string,
  subject: Subject,
): Promise<void> {
  await need(q, id, "owner");
  await q.query(
    `delete from grants
     where record_id = $1 and subject = $2
       and member_id is not distinct from $3
       and group_id is not distinct from $4`,
    [id, subject.kind, memberId(subject), groupId(subject)],
  );
}
