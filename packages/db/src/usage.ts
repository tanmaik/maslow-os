import { asOrg, asPerson, type Query } from "./index.ts";
import type { Principal } from "./auth.ts";

export type Resource = "compute" | "rootfs" | "disk" | "bucket" | "brain";
export type Unit = "second" | "gb_second" | "byte_second";

export type Line = {
  userId: string;
  name: string | null;
  resource: Resource;
  unit: Unit;
  quantity: number;
  cost: number;
};

// Every line of the org's usage since a moment, by member and resource,
// with the member's name where they are still one.
export async function usageOfOrg(p: Principal, since: Date): Promise<Line[]> {
  return asOrg(
    p.orgId,
    async (q) =>
      (
        await q.query<Line>(
          `select u.user_id as "userId", m.name, u.resource, u.unit,
                  sum(u.quantity)::float8 as quantity, sum(u.cost)::float8 as cost
             from usage u left join users m on m.id = u.user_id
            where u.to_at > $1
            group by u.user_id, m.name, u.resource, u.unit
            order by m.name nulls last, u.resource`,
          [since],
        )
      ).rows,
  );
}

// What the person's brain holds, by kind, biggest first: the bytes their
// records and links occupy.
export async function brainByKind(
  p: Principal,
): Promise<{ kind: string; records: number; bytes: number }[]> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<{ kind: string; records: number; bytes: number }>(
          `select kind, count(*)::int as records, sum(pg_column_size(r.*))::float8 as bytes
             from records r where person_id = current_member() group by kind order by bytes desc limit 20`,
        )
      ).rows,
  );
}

export type Picture = {
  kind: "photo" | "logo";
  size: number;
  createdAt: Date;
};

// The bucket objects a member is charged for: their profile photo, and
// the org's logo while they are its principal, since the owner pays for
// the org. Read inside an org scope.
export async function picturesIn(q: Query, userId: string): Promise<Picture[]> {
  return (
    await q.query<Picture>(
      `select 'photo' as kind, avatar_bytes::float8 as size, avatar_at as "createdAt"
         from users where id = $1 and avatar_bytes is not null
       union all
       select 'logo', logo_bytes::float8, logo_at
         from orgs where principal_id = $1 and logo_bytes is not null`,
      [userId],
    )
  ).rows;
}

export const picturesOf = (p: Principal) =>
  asOrg(p.orgId, (q) => picturesIn(q, p.userId));

// One person's lines since a moment.
export async function usageOfMember(
  p: Principal,
  since: Date,
): Promise<Line[]> {
  return (await usageOfOrg(p, since)).filter((l) => l.userId === p.userId);
}
