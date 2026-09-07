import { Forbidden, Invalid, NotFound } from "./errors.ts";
import type { Access, Query, Share, Subject, Target } from "./types.ts";

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

// Refuses unless the current member may see the type, or for a share, owns
// it: a type is shared by whoever defined it and nobody else.
async function needType(q: Query, id: string, level: "view" | "owner") {
  const { rows } = await q.query<{ own: boolean }>(
    "select person_id = current_member() as own from types where id = $1",
    [id],
  );
  if (!rows[0]) throw new NotFound(`type ${id} is not in this brain`);
  if (level === "owner" && !rows[0].own) {
    throw new Forbidden("only the type's owner shares it");
  }
}

const allowed = (q: Query, on: Target, level: "view" | "owner") =>
  "record" in on ? need(q, on.record, level) : needType(q, on.type, level);

type ShareRow = {
  id: string;
  record_id: string | null;
  type_id: string | null;
  subject: Subject["who"];
  member_id: string | null;
  group_id: string | null;
  level: Access;
};

const toShare = (s: ShareRow): Share => ({
  id: s.id,
  on: s.record_id ? { record: s.record_id } : { type: s.type_id! },
  subject:
    s.subject === "everyone"
      ? { who: "everyone" }
      : s.subject === "group"
        ? { who: "group", id: s.group_id! }
        : { who: "member", id: s.member_id! },
  level: s.level,
});

const columns = "id, record_id, type_id, subject, member_id, group_id, level";

const recordId = (on: Target) => ("record" in on ? on.record : null);
const typeId = (on: Target) => ("type" in on ? on.type : null);
const memberId = (s: Subject) => (s.who === "member" ? s.id : null);
const groupId = (s: Subject) => (s.who === "group" ? s.id : null);

// Every share on a record or a type, for anyone who can see it.
export async function sharesOf(q: Query, on: Target): Promise<Share[]> {
  await allowed(q, on, "view");
  const { rows } = await q.query<ShareRow>(
    `select ${columns} from shares
     where record_id is not distinct from $1 and type_id is not distinct from $2
     order by subject, level, id`,
    [recordId(on), typeId(on)],
  );
  return rows.map(toShare);
}

// Lets a member, a group or everyone do this much with a record, or with
// every record of a type. Sharing again with the same subject changes the
// level.
export async function share(
  q: Query,
  on: Target,
  subject: Subject,
  level: Access,
): Promise<Share> {
  await allowed(q, on, "owner");
  if (!(level in RANK)) throw new Invalid(`"${String(level)}" is not a level`);
  if (subject.who === "everyone" && level !== "view") {
    throw new Invalid("everyone can only be given view");
  }
  const { rows } = await q
    .query<ShareRow>(
      `insert into shares
         (record_id, type_id, subject, member_id, group_id, level)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (org_id, record_id, type_id, subject, member_id, group_id)
         do update set level = excluded.level
       returning ${columns}`,
      [
        recordId(on),
        typeId(on),
        subject.who,
        memberId(subject),
        groupId(subject),
        level,
      ],
    )
    .catch((err) => {
      if ((err as { code?: string }).code === "23503") {
        throw new NotFound(`no such ${subject.who} in this org`);
      }
      throw err;
    });
  return toShare(rows[0]!);
}

// Takes a share away. Taking away one that is not there changes nothing.
export async function unshare(
  q: Query,
  on: Target,
  subject: Subject,
): Promise<void> {
  await allowed(q, on, "owner");
  await q.query(
    `delete from shares
     where record_id is not distinct from $1
       and type_id is not distinct from $2
       and subject = $3
       and member_id is not distinct from $4
       and group_id is not distinct from $5`,
    [
      recordId(on),
      typeId(on),
      subject.who,
      memberId(subject),
      groupId(subject),
    ],
  );
}
