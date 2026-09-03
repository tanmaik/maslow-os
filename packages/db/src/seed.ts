import pg from "pg";

// Three orgs that could never be mistaken for one another, so a row showing up
// under the wrong org is obvious at a glance.
export const orgs = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    slug: "acme-rockets",
    name: "Acme Rockets",
    users: [
      { id: "10000000-0000-4000-8000-000000000001", name: "Wile Coyote", email: "wile@acme-rockets.test" },
      { id: "10000000-0000-4000-8000-000000000002", name: "Road Runner", email: "beep@acme-rockets.test" },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000002",
    slug: "blue-whale-bakery",
    name: "Blue Whale Bakery",
    users: [
      { id: "20000000-0000-4000-8000-000000000001", name: "Marge Crumb", email: "marge@bluewhale.test" },
      { id: "20000000-0000-4000-8000-000000000002", name: "Otto Loaf", email: "otto@bluewhale.test" },
      { id: "20000000-0000-4000-8000-000000000003", name: "Pim Sourdough", email: "pim@bluewhale.test" },
    ],
  },
  {
    id: "00000000-0000-4000-8000-000000000003",
    slug: "chartreuse-observatory",
    name: "Chartreuse Observatory",
    users: [
      { id: "30000000-0000-4000-8000-000000000001", name: "Vera Nebula", email: "vera@chartreuse.test" },
    ],
  },
] as const;

// Idempotent: rows that already exist are left alone.
export async function seed(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    for (const org of orgs) {
      await client.query(
        "insert into orgs (id, slug, name) values ($1, $2, $3) on conflict (id) do nothing",
        [org.id, org.slug, org.name],
      );
      for (const u of org.users) {
        await client.query(
          "insert into users (id, org_id, email, name) values ($1, $2, $3, $4) on conflict (id) do nothing",
          [u.id, org.id, u.email, u.name],
        );
      }
    }
  } finally {
    await client.end();
  }
}
