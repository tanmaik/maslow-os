import { asOrg, asPerson, type Query } from "./index.ts";
import type { Principal } from "./auth.ts";

export type Resource =
  "compute" | "rootfs" | "disk" | "bucket" | "brain" | "vectors" | "actions";
export type Unit = "second" | "gb_second" | "byte_second" | "token" | "run";

// Records what a person just spent at a vendor, in the vendor's unit, at
// the price on its list, and what it was for, at the instant it happened.
// Read inside the person's scope.
export async function spend(
  q: Query,
  userId: string,
  resource: Resource,
  unit: Unit,
  quantity: number,
  price: number,
  cause: string,
): Promise<void> {
  await q.query(
    `insert into usage
       (org_id, user_id, resource, unit, quantity, price, cost, from_at, to_at,
        cause)
     values (current_org(), $1, $2, $3, $4::numeric, $5::numeric,
       $4::numeric * $5::numeric, clock_timestamp(),
       clock_timestamp() + interval '1 microsecond', $6)`,
    [userId, resource, unit, quantity, price, cause],
  );
}

export type Line = {
  userId: string;
  name: string | null;
  resource: Resource;
  unit: Unit;
  quantity: number;
  cost: number;
};

// Every line of the org's usage since a moment, by member and resource,
// with the member's name where they are still one; or one member's lines.
// The meter cuts a row at the turn of a month, so a row that ended after
// the moment lies wholly after it; one written before it did counts the
// share of itself that falls after.
async function lines(
  p: Principal,
  since: Date,
  userId: string | null,
): Promise<Line[]> {
  return asOrg(
    p.orgId,
    async (q) =>
      (
        await q.query<Line>(
          `select u.user_id as "userId", m.name, u.resource, u.unit,
                  sum(u.quantity * share)::float8 as quantity,
                  sum(u.cost * share)::float8 as cost
             from usage u
             left join users m on m.id = u.user_id
             cross join lateral (
               select case when u.from_at >= $1 then 1 else coalesce(
                 extract(epoch from (u.to_at - $1))
                 / nullif(extract(epoch from (u.to_at - u.from_at)), 0), 1) end as share
             ) s
            where u.to_at > $1 and ($2::uuid is null or u.user_id = $2)
            group by u.user_id, m.name, u.resource, u.unit
            order by m.name nulls last, u.resource`,
          [since, userId],
        )
      ).rows,
  );
}

export const usageOfOrg = (p: Principal, since: Date) => lines(p, since, null);
export const usageOfMember = (p: Principal, since: Date) =>
  lines(p, since, p.userId);

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
