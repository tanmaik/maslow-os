import { asMachine, asOrg, asPerson } from "./index.ts";
import type { Principal } from "./auth.ts";

export type Backup = {
  id: string;
  key: string;
  uploadId: string | null;
  size: number | null;
  startedAt: Date;
  finishedAt: Date | null;
};

const COLUMNS =
  'id, key, upload_id as "uploadId", size::float8 as size, started_at as "startedAt", finished_at as "finishedAt"';

// The machine behind a backup call: its computer's row, by its id and its
// secret, or nothing.
export async function computerByMachine(
  machineId: string,
  secret: string,
): Promise<{
  id: string;
  orgId: string;
  userId: string;
  diskGb: number;
} | null> {
  return asMachine(
    machineId,
    secret,
    async (q) =>
      (
        await q.query<{
          id: string;
          orgId: string;
          userId: string;
          diskGb: number;
        }>(
          'select id, org_id as "orgId", user_id as "userId", disk_gb as "diskGb" from computers where machine_id = $1 and id in (select computer_id from computer_secrets)',
          [machineId],
        )
      ).rows[0] ?? null,
  );
}

// Opens a backup the moment the machine starts one, so an object half
// sent is never unrecorded. Null when one is already on its way.
export async function beginBackup(
  c: { orgId: string; userId: string },
  key: string,
  uploadId: string | null,
): Promise<string | null> {
  return asOrg(c.orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [c.userId]);
    // One at a time per person: the check and the insert are one.
    await q.query("select pg_advisory_xact_lock(hashtext($1))", [c.userId]);
    // One a day per person: one on its way, or one finished today, is it.
    const running = await q.query(
      "select 1 from backups where user_id = $1 and deleted_at is null and (finished_at is null or finished_at > now() - interval '23 hours') and started_at > now() - interval '1 day'",
      [c.userId],
    );
    if (running.rowCount) return null;
    return (
      await q.query<{ id: string }>(
        "insert into backups (user_id, key, upload_id) values ($1, $2, $3) returning id",
        [c.userId, key, uploadId],
      )
    ).rows[0]!.id;
  });
}

export async function backupInProgress(
  c: { orgId: string; userId: string },
  id: string,
): Promise<Backup | null> {
  return asOrg(c.orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [c.userId]);
    return (
      (
        await q.query<Backup>(
          `select ${COLUMNS} from backups where id = $1 and user_id = $2 and finished_at is null and deleted_at is null`,
          [id, c.userId],
        )
      ).rows[0] ?? null
    );
  });
}

// Closes the row with the size the store confirmed; false when the row
// was dropped meanwhile, in which case the object must go too.
export async function finishBackup(
  c: { orgId: string; userId: string },
  id: string,
  size: number,
): Promise<boolean> {
  return asOrg(c.orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [c.userId]);
    return (
      (
        await q.query(
          "update backups set finished_at = now(), size = $2, upload_id = null where id = $1 and user_id = $3 and finished_at is null and deleted_at is null",
          [id, Math.round(size), c.userId],
        )
      ).rowCount === 1
    );
  });
}

// A backup that will not finish: marked gone once its parts are.
export async function dropBackup(orgId: string, id: string): Promise<void> {
  await asOrg(orgId, async (q) => {
    await q.query("select set_config('app.meter', 'sweep', true)");
    await q.query("update backups set deleted_at = now() where id = $1", [id]);
  });
}

// The person's finished backups, newest first.
export async function backupsOf(p: Principal): Promise<Backup[]> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<Backup>(
          `select ${COLUMNS} from backups where finished_at is not null and deleted_at is null order by finished_at desc`,
        )
      ).rows,
  );
}

export async function backupOf(
  p: Principal,
  id: string,
): Promise<Backup | null> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<Backup>(
          `select ${COLUMNS} from backups where id = $1 and finished_at is not null and deleted_at is null`,
          [id],
        )
      ).rows[0] ?? null,
  );
}

// For the sweep: per member of the org, when the last backup finished,
// and the ones past the seven kept, and the ones that never finished.
export async function backupsIn(orgId: string): Promise<{
  lastFinished: Map<string, Date>;
  running: Set<string>;
  surplus: Backup[];
  stale: Backup[];
}> {
  return asOrg(orgId, async (q) => {
    await q.query("select set_config('app.meter', 'sweep', true)");
    const rows = (
      await q.query<Backup & { userId: string }>(
        `select ${COLUMNS}, user_id as "userId" from backups where deleted_at is null order by user_id, finished_at desc nulls first`,
      )
    ).rows;
    const lastFinished = new Map<string, Date>();
    const running = new Set<string>();
    const surplus: Backup[] = [];
    const stale: Backup[] = [];
    const kept = new Map<string, number>();
    for (const b of rows) {
      if (!b.finishedAt) {
        if (b.startedAt < new Date(Date.now() - 86400_000)) stale.push(b);
        else running.add(b.userId);
        continue;
      }
      if (!lastFinished.has(b.userId)) lastFinished.set(b.userId, b.finishedAt);
      const n = (kept.get(b.userId) ?? 0) + 1;
      kept.set(b.userId, n);
      if (n > 7) surplus.push(b);
    }
    return { lastFinished, running, surplus, stale };
  });
}

// Every finished backup's size and lifetime, for the meter.
export async function backupBytes(
  q: {
    query: (
      sql: string,
      params: unknown[],
    ) => Promise<{
      rows: { size: string; finished_at: Date; deleted_at: Date | null }[];
    }>;
  },
  userId: string,
) {
  return (
    await q.query(
      "select size, finished_at, deleted_at from backups where user_id = $1 and finished_at is not null",
      [userId],
    )
  ).rows;
}

// Whether the machine's person is still a member: a removed member's
// machine opens no backup. Asked as the org, since a machine sees no users.
export async function memberLive(c: {
  orgId: string;
  userId: string;
}): Promise<boolean> {
  return asOrg(
    c.orgId,
    async (q) =>
      (
        await q.query(
          "select 1 from users where id = $1 and removed_at is null",
          [c.userId],
        )
      ).rowCount === 1,
  );
}
