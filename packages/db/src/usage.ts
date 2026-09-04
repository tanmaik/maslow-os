import { asOrg } from "./index.ts";
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

// One person's lines since a moment.
export async function usageOfMember(
  p: Principal,
  since: Date,
): Promise<Line[]> {
  return (await usageOfOrg(p, since)).filter((l) => l.userId === p.userId);
}
