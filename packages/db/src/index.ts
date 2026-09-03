import pg from "pg";

// One pool per process. Kept on globalThis so a dev-server reload reuses it
// instead of opening another.
const shared = globalThis as { __pool?: pg.Pool };

function connection(): pg.Pool {
  if (!shared.__pool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. `pnpm dev` sets it; in production it is required.",
      );
    }
    shared.__pool = new pg.Pool({ connectionString: url });
  }
  return shared.__pool;
}

// Runs fn inside a transaction scoped to one org. With orgId null the
// connection sees no rows at all: nothing is visible until an org is named.
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
    client.release();
    return result;
  } catch (err) {
    // A client that cannot roll back is broken and leaves the pool.
    await client.query("rollback").then(
      () => client.release(),
      (rollbackErr) => client.release(rollbackErr as Error),
    );
    throw err;
  }
}
