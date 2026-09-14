import type { Query } from "./index.ts";

export type Resource = "bucket" | "brain" | "vectors" | "actions";
export type Unit = "byte_second" | "token" | "run";

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

// What the org has spent of a resource since a moment, in its unit. Read
// inside the org's scope.
export async function spentSince(
  q: Query,
  resource: Resource,
  since: Date,
): Promise<number> {
  const { rows } = await q.query<{ sum: string | null }>(
    `select sum(quantity)::text as sum from usage
     where resource = $1 and from_at >= $2`,
    [resource, since],
  );
  return Number(rows[0]?.sum ?? 0);
}

export type Picture = {
  kind: "photo" | "logo" | "wallpaper";
  size: number;
  createdAt: Date;
};

// The bucket objects a member is charged for: their profile photo, the
// wallpapers they uploaded, and the org's logo while they are its
// principal, since the owner pays for the org. Read inside an org scope.
export async function picturesIn(q: Query, userId: string): Promise<Picture[]> {
  return (
    await q.query<Picture>(
      `select 'photo' as kind, avatar_bytes::float8 as size, avatar_at as "createdAt"
         from users where id = $1 and avatar_bytes is not null
       union all
       select 'wallpaper', bytes::float8, created_at
         from wallpapers where member_id = $1
       union all
       select 'logo', logo_bytes::float8, logo_at
         from orgs where principal_id = $1 and logo_bytes is not null`,
      [userId],
    )
  ).rows;
}
