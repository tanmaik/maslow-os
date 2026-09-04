import pg from "pg";

// Three orgs that could never be mistaken for one another, so a row showing up
// under the wrong org is obvious at a glance. Otto is in two of them.
export const people = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    firstName: "Wile",
    lastName: "Coyote",
    email: "wile@acme-rockets.test",
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    firstName: "Road",
    lastName: "Runner",
    email: "beep@acme-rockets.test",
  },
  {
    id: "20000000-0000-4000-8000-000000000001",
    firstName: "Marge",
    lastName: "Crumb",
    email: "marge@bluewhale.test",
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    firstName: "Otto",
    lastName: "Loaf",
    email: "otto@bluewhale.test",
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    firstName: "Pim",
    lastName: "Sourdough",
    email: "pim@bluewhale.test",
  },
  {
    id: "30000000-0000-4000-8000-000000000001",
    firstName: "Vera",
    lastName: "Nebula",
    email: "vera@chartreuse.test",
  },
] as const;

// A membership carries its person's email and name, and remembers the person.
const person = (id: string) => ({
  ...people.find((p) => p.id === id)!,
  personId: id,
});

// Each org lists its memberships; the first is the principal. A membership id is
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

// Idempotent: rows that already exist are left alone. One transaction, so an
// org and its principal arrive together.
export async function seed(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    for (const p of people) {
      await client.query(
        "insert into people (id, email, first_name, last_name) values ($1, $2, $3, $4) on conflict (id) do nothing",
        [p.id, p.email, p.firstName, p.lastName],
      );
    }
    for (const org of orgs) {
      await client.query(
        "insert into orgs (id, slug, name, principal_id) values ($1, $2, $3, $4) on conflict (id) do nothing",
        [org.id, org.slug, org.name, org.users[0].id],
      );
      for (const [i, u] of org.users.entries()) {
        await client.query(
          "insert into users (id, org_id, person_id, email, first_name, last_name, role) values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing",
          [
            u.id,
            org.id,
            u.personId,
            u.email,
            u.firstName,
            u.lastName,
            i === 0 ? "owner" : "member",
          ],
        );
      }
    }
    await client.query("commit");
  } finally {
    await client.end();
  }
}
