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

// Whether a string is shaped like an id at all, before a table is asked.
export const isUuid = (s: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

// Runs fn inside a transaction whose row-level policies read the given
// settings. With none set the connection sees no rows at all.
async function scoped<T>(
  settings: Record<string, string>,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  const client = await connection().connect();
  try {
    // A pooled connection may arrive carrying whatever a previous holder
    // set at session level; nothing set outside this transaction may
    // speak for it.
    await client.query("reset all");
    await client.query("begin");
    await client.query(
      `select set_config(name, value, true)
       from unnest($1::text[], $2::text[]) as settings(name, value)`,
      [Object.keys(settings), Object.values(settings)],
    );
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

// Thrown when the membership a request acts through has been removed since
// the request began.
export class Gone extends Error {}

// Runs fn as one person through one membership: the org's shared rows, the
// person's own row, and what that membership wrote in the brain. The
// membership is held for the transaction, so a removal that lands first is
// honoured and one that lands later waits.
export function asPerson<T>(
  p: { orgId: string; personId: string; userId: string },
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  return scoped(
    {
      "app.org_id": p.orgId,
      "app.person_id": p.personId,
      "app.member_id": p.userId,
    },
    async (q) => {
      const live = await q.query(
        "select 1 from users where id = $1 and person_id = $2 for share",
        [p.userId, p.personId],
      );
      if (!live.rowCount) throw new Gone("This membership was removed.");
      return fn(q);
    },
  );
}

// Runs fn as one person writing what is theirs in every org: the person's
// own row is held first and the membership only checked, so the same
// write from two of their orgs queues on the person and never on each
// other's membership.
export function asSelf<T>(
  p: { orgId: string; personId: string; userId: string },
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  return scoped(
    {
      "app.org_id": p.orgId,
      "app.person_id": p.personId,
      "app.member_id": p.userId,
    },
    async (q) => {
      await q.query("select 1 from people where id = $1 for update", [
        p.personId,
      ]);
      const live = await q.query(
        "select 1 from users where id = $1 and person_id = $2",
        [p.userId, p.personId],
      );
      if (!live.rowCount) throw new Gone("This membership was removed.");
      return fn(q);
    },
  );
}

// Runs fn seeing only the person and invitations that carry one email: the
// view a sign-in has before it knows an org.
export function asEmail<T>(
  email: string,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  return scoped({ "app.email": email }, fn);
}

// Runs fn as a sign-in that may found an org: the rows carrying one email,
// and a new org's own.
export function asSignIn<T>(
  email: string,
  orgId: string,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  return scoped({ "app.email": email, "app.org_id": orgId }, fn);
}

// Runs fn as one machine reporting on itself: its own computers row only.
export function asMachine<T>(
  machineId: string,
  secret: string,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  return scoped(
    { "app.machine_id": machineId, "app.machine_secret": secret },
    fn,
  );
}

// Runs fn as the meter's sweep: every org's id, nothing else.
export function asMeter<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  return scoped({ "app.meter": "sweep" }, fn);
}

// Runs fn seeing one throttle key.
export function asThrottle<T>(
  key: string,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  return scoped({ "app.throttle": key }, fn);
}
