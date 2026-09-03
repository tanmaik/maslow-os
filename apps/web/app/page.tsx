import { asOrg } from "@placeholder/db";
import { orgs } from "@placeholder/db/seed";

type Row = { name: string; email: string };

// Shows what one org's connection can see, and that no org sees nothing.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ org?: string }>;
}) {
  const { org: slug } = await searchParams;
  const current = orgs.find((o) => o.slug === slug) ?? null;

  const { orgName, users } = await asOrg(current?.id ?? null, async (q) => ({
    orgName:
      (await q.query<{ name: string }>("select name from orgs")).rows[0]
        ?.name ?? null,
    users: (await q.query<Row>("select name, email from users order by name"))
      .rows,
  }));

  return (
    <main>
      <nav style={{ display: "flex", gap: "1rem" }}>
        <a href="/">no org</a>
        {orgs.map((o) => (
          <a
            key={o.slug}
            href={`/?org=${o.slug}`}
            style={{ fontWeight: o.slug === slug ? 700 : 400 }}
          >
            {o.name}
          </a>
        ))}
      </nav>
      <h1>{orgName ?? "No org set"}</h1>
      <p>
        {users.length} of {orgs.reduce((n, o) => n + o.users.length, 0)} users
        visible
      </p>
      <ul>
        {users.map((u) => (
          <li key={u.email}>
            {u.name} — {u.email}
          </li>
        ))}
      </ul>
    </main>
  );
}
