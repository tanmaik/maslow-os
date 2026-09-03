import pg from "pg";

let pool: pg.Pool | undefined;

function connection(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. `pnpm dev` sets it; in production it is required.",
      );
    }
    pool = new pg.Pool({ connectionString: url });
  }
  return pool;
}

// Runs fn inside a transaction scoped to one org. With orgId null the
// connection sees no rows at all, which is the point: nothing is visible until
// an org is named.
export async function asOrg<T>(
  orgId: string | null,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await connection().connect();
  try {
    await client.query("begin");
    if (orgId)
      await client.query("select set_config('app.org_id', $1, true)", [orgId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
