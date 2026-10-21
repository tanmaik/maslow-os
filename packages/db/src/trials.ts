import { asOrg, asTrials } from "./index.ts";

// How many trial orgs stand now, for the ceiling on new ones.
export async function trialCount(): Promise<number> {
  return asTrials(
    async (q) =>
      (
        await q.query<{ n: number }>(
          "select count(*)::int as n from orgs where trial_at is not null",
        )
      ).rows[0]!.n,
  );
}

// Deletes every trial org made more than `hours` ago, with everything it
// owns, and then its guest. Answers how many orgs went. Each org is
// deleted as itself, so nothing else is ever in reach of the delete.
export async function reapTrials(hours = 24): Promise<number> {
  const old = await asTrials(
    async (q) =>
      (
        await q.query<{ id: string }>(
          "select id from orgs where trial_at < now() - $1 * interval '1 hour'",
          [hours],
        )
      ).rows,
  );
  let gone = 0;
  for (const { id } of old) {
    const emails = await asOrg(id, async (q) => {
      await q.query("select set_config('app.past_members', 'on', true)");
      const guests = (
        await q.query<{ email: string }>("select email from users")
      ).rows.map((r) => r.email);
      const deleted = await q.query(
        "delete from orgs where id = $1 and trial_at is not null",
        [id],
      );
      return deleted.rowCount ? guests : null;
    });
    if (!emails) continue;
    gone++;
    await asTrials((q) =>
      q.query("delete from people where email = any($1::text[])", [emails]),
    );
  }
  return gone;
}
