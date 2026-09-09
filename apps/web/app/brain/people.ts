import type { Query } from "@maslow/brain";

// Every current member of the org by id, for naming who wrote, owns or
// shared something.
export async function peopleOf(q: Query): Promise<Map<string, string>> {
  const { rows } = await q.query<{ id: string; name: string }>(
    "select id, name from users order by name",
  );
  return new Map(rows.map((u) => [u.id, u.name]));
}
