import pg from "pg";

// One pool per process, reused across dev-server reloads.
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

export type Query = pg.PoolClient;

// Runs fn inside a transaction whose row-level policies read the given
// settings. With none set the connection sees no rows at all.
async function scoped<T>(
  settings: Record<string, string>,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  const client = await connection().connect();
  try {
    await client.query("begin");
    for (const [name, value] of Object.entries(settings))
      await client.query("select set_config($1, $2, true)", [name, value]);
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

// Runs fn as one org.
export function asOrg<T>(
  orgId: string,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  return scoped({ "app.org_id": orgId }, fn);
}

// Runs fn seeing only the person and invitations that carry one email: the
// view a sign-in has before it knows an org.
export function asEmail<T>(
  email: string,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  return scoped({ "app.email": email }, fn);
}

// Runs fn seeing one throttle key.
export function asThrottle<T>(
  key: string,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  return scoped({ "app.throttle": key }, fn);
}
