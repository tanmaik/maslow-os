import pg from "pg";

// Three orgs that could never be mistaken for one another, so a row showing up
// under the wrong org is obvious at a glance. Otto is in two of them.
export const people = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Wile Coyote",
    email: "wile@acme-rockets.test",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Road Runner",
    email: "beep@acme-rockets.test",
  },
  {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Marge Crumb",
    email: "marge@bluewhale.test",
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    name: "Otto Loaf",
    email: "otto@bluewhale.test",
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    name: "Pim Sourdough",
    email: "pim@bluewhale.test",
  },
  {
    id: "30000000-0000-4000-8000-000000000001",
    name: "Vera Nebula",
    email: "vera@chartreuse.test",
  },
] as const;

const person = (id: string) => people.find((p) => p.id === id)!;

// Each org lists its memberships; the first is the owner. A membership id is
// the person id with the org's digit swapped in, so it stays readable.
export const orgs = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "acme-rockets",
    name: "Acme Rockets",
    users: [
      {
        ...person("10000000-0000-4000-8000-000000000001"),
        id: "10000000-0000-4000-8000-000000000001",
      },
      {
        ...person("10000000-0000-4000-8000-000000000002"),
        id: "10000000-0000-4000-8000-000000000002",
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "blue-whale-bakery",
    name: "Blue Whale Bakery",
    users: [
      {
        ...person("20000000-0000-4000-8000-000000000001"),
        id: "20000000-0000-4000-8000-000000000001",
      },
      {
        ...person("20000000-0000-4000-8000-000000000002"),
        id: "20000000-0000-4000-8000-000000000002",
      },
      {
        ...person("20000000-0000-4000-8000-000000000003"),
        id: "20000000-0000-4000-8000-000000000003",
      },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    slug: "chartreuse-observatory",
    name: "Chartreuse Observatory",
    users: [
      {
        ...person("30000000-0000-4000-8000-000000000001"),
        id: "30000000-0000-4000-8000-000000000001",
      },
      {
        ...person("20000000-0000-4000-8000-000000000002"),
        id: "30000000-0000-4000-8000-000000000002",
      },
    ],
  },
] as const;

// Idempotent: rows that already exist are left alone.
export async function seed(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const p of people) {
      await client.query(
        "insert into people (id, email, name) values ($1, $2, $3) on conflict (id) do nothing",
        [p.id, p.email, p.name],
      );
    }
    for (const org of orgs) {
      await client.query(
        "insert into orgs (id, slug, name) values ($1, $2, $3) on conflict (id) do nothing",
        [org.id, org.slug, org.name],
      );
      for (const [i, u] of org.users.entries()) {
        const personId = people.find((p) => p.email === u.email)!.id;
        await client.query(
          "insert into users (id, org_id, person_id, email, name, role) values ($1, $2, $3, $4, $5, $6) on conflict (id) do nothing",
          [
            u.id,
            org.id,
            personId,
            u.email,
            u.name,
            i === 0 ? "owner" : "member",
          ],
        );
      }
    }
  } finally {
    await client.end();
  }
}
