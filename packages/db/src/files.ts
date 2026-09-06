import { asOrg, asPerson } from "./index.ts";
import type { Principal } from "./auth.ts";

export type StoredFile = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  // The folder on the disk it lands in: "/" or "/a/b".
  path: string;
  key: string;
  // Arriving in parts; being joined; whole in the store; being pulled
  // onto the disk by the machine.
  // lost: whole once, but the store no longer has it; nothing lands it.
  state: "uploading" | "joining" | "ready" | "landing" | "lost";
  // Why the machine could not land it, when it could not.
  said: string | null;
  uploadId: string | null;
  createdAt: Date;
  readyAt: Date | null;
};

const COLUMNS =
  'id, name, size::float8 as size, content_type as "contentType", path, key, state, said, upload_id as "uploadId", created_at as "createdAt", ready_at as "readyAt"';

// Whether the store holds all of a file: staged, or on its way to the disk.
export const whole = (f: Pick<StoredFile, "state">) =>
  f.state === "ready" || f.state === "landing";

// The person's files that exist, newest first; how much the whole ones
// hold, and how much they all claim once every upload lands.
export async function filesOf(
  p: Principal,
): Promise<{ files: StoredFile[]; bytes: number; declared: number }> {
  return asPerson(p, async (q) => {
    const files = (
      await q.query<StoredFile>(
        `select ${COLUMNS} from files where deleted_at is null order by created_at desc`,
      )
    ).rows;
    return {
      files,
      bytes: files.reduce((n, f) => n + (whole(f) ? f.size : 0), 0),
      declared: files.reduce((n, f) => n + f.size, 0),
    };
  });
}

export async function fileOf(
  p: Principal,
  id: string,
): Promise<StoredFile | null> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<StoredFile>(
          `select ${COLUMNS} from files where id = $1 and deleted_at is null`,
          [id],
        )
      ).rows[0] ?? null,
  );
}

// Opens a file if the person's files, declared and whole, stay under the
// cap. The check and the insert are one, under a lock on the person, so two
// begins at once cannot both pass.
export async function beginFile(
  p: Principal,
  f: Pick<
    StoredFile,
    "id" | "name" | "size" | "contentType" | "key" | "path"
  > & {
    uploadId: string | null;
  },
  cap: number,
): Promise<boolean> {
  return asPerson(p, async (q) => {
    await q.query("select pg_advisory_xact_lock(hashtext($1))", [p.userId]);
    const declared = Number(
      (
        await q.query<{ n: string }>(
          "select coalesce(sum(size), 0) as n from files where user_id = $1 and deleted_at is null",
          [p.userId],
        )
      ).rows[0]!.n,
    );
    if (declared + f.size > cap) return false;
    await q.query(
      "insert into files (id, org_id, user_id, name, size, content_type, key, upload_id, path) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        f.id,
        p.orgId,
        p.userId,
        f.name,
        f.size,
        f.contentType,
        f.key,
        f.uploadId,
        f.path,
      ],
    );
    return true;
  });
}

// Marks the file whole, with the size the store confirms.
export async function readyFile(
  p: Principal,
  id: string,
  size: number,
): Promise<boolean> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query(
          "update files set state = 'ready', size = $2, ready_at = now(), upload_id = null where id = $1 and state = 'joining' and deleted_at is null",
          [id, size],
        )
      ).rowCount === 1,
  );
}

// Claims an upload for completion: one request joins it, others are told
// it is taken. A failed join hands it back.
export async function claimJoin(p: Principal, id: string): Promise<boolean> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query(
          "update files set state = 'joining' where id = $1 and state = 'uploading' and deleted_at is null",
          [id],
        )
      ).rowCount === 1,
  );
}

export async function unclaimJoin(p: Principal, id: string): Promise<void> {
  await asPerson(p, (q) =>
    q.query(
      "update files set state = 'uploading' where id = $1 and state = 'joining'",
      [id],
    ),
  );
}

// The row stays for the meter; the bytes are gone.
export async function forgetFile(p: Principal, id: string): Promise<void> {
  await asPerson(p, (q) =>
    q.query(
      "update files set deleted_at = now() where id = $1 and deleted_at is null",
      [id],
    ),
  );
}

// Uploads begun before a moment and never finished, across the org.
export async function staleUploads(
  orgId: string,
  before: Date,
): Promise<(StoredFile & { userId: string })[]> {
  return asOrg(orgId, async (q) => {
    await q.query("select set_config('app.meter', 'sweep', true)");
    const members = new Set<string>(
      (
        await q.query<{ user_id: string }>("select distinct user_id from files")
      ).rows.map((r) => r.user_id),
    );
    const out: (StoredFile & { userId: string })[] = [];
    for (const userId of members) {
      await q.query("select set_config('app.member_id', $1, true)", [userId]);
      for (const f of (
        await q.query<StoredFile>(
          `select ${COLUMNS} from files where user_id = $1 and state in ('uploading', 'joining') and deleted_at is null and created_at < $2`,
          [userId, before],
        )
      ).rows)
        out.push({ ...f, userId });
    }
    return out;
  });
}

// Claims a stale upload for deletion: only if it is still uploading, so
// one that completed meanwhile is untouched. True when claimed.
export async function claimStale(
  orgId: string,
  userId: string,
  id: string,
): Promise<boolean> {
  return asOrg(orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [userId]);
    return (
      (
        await q.query(
          "update files set deleted_at = now() where id = $1 and deleted_at is null and state in ('uploading', 'joining')",
          [id],
        )
      ).rowCount === 1
    );
  });
}

// Marks a file that arrived wrong as gone, before its bytes are dropped.
export async function rejectFile(p: Principal, id: string): Promise<void> {
  await asPerson(p, (q) =>
    q.query(
      "update files set deleted_at = now() where id = $1 and deleted_at is null",
      [id],
    ),
  );
}

// Gives a stale claim back when its bytes could not be dropped.
export async function unclaimStale(
  orgId: string,
  userId: string,
  id: string,
): Promise<void> {
  await asOrg(orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [userId]);
    await q.query("update files set deleted_at = null where id = $1", [id]);
  });
}

// Whether a file is still being uploaded, for a part arriving late.
export async function uploadingFile(
  orgId: string,
  userId: string,
  id: string,
): Promise<boolean> {
  return asOrg(orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [userId]);
    return (
      (
        await q.query(
          "select 1 from files where id = $1 and state = 'uploading' and deleted_at is null",
          [id],
        )
      ).rowCount === 1
    );
  });
}

// A staged file's key for the machine fetching it: whole and not gone,
// or nothing.
export async function stagedFile(
  orgId: string,
  userId: string,
  id: string,
): Promise<{ key: string } | null> {
  return asOrg(orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [userId]);
    return (
      (
        await q.query<{ key: string }>(
          "select key from files where id = $1 and state in ('ready', 'landing') and deleted_at is null",
          [id],
        )
      ).rows[0] ?? null
    );
  });
}

// Marks a whole file as being pulled onto the disk by the machine. False
// when it is not whole, or gone.
export async function landingFile(
  orgId: string,
  userId: string,
  id: string,
): Promise<boolean> {
  return asOrg(orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [userId]);
    return (
      (
        await q.query(
          "update files set state = 'landing', said = null where id = $1 and state in ('ready', 'landing') and deleted_at is null",
          [id],
        )
      ).rowCount === 1
    );
  });
}

// A file the machine was pulling, as it said how that went: still on its
// way, or nothing.
export async function landingIn(
  orgId: string,
  userId: string,
  id: string,
): Promise<StoredFile | null> {
  return asOrg(orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [userId]);
    return (
      (
        await q.query<StoredFile>(
          `select ${COLUMNS} from files where id = $1 and state = 'landing' and deleted_at is null`,
          [id],
        )
      ).rows[0] ?? null
    );
  });
}

// A file the store no longer has: nothing will land it, so the sweep
// stops asking, and the row says so until the person lets it go.
export async function lostFile(
  orgId: string,
  userId: string,
  id: string,
  said: string,
): Promise<void> {
  await asOrg(orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [userId]);
    await q.query(
      "update files set state = 'lost', said = $2 where id = $1 and state = 'landing'",
      [id, said],
    );
  });
}

// Puts a file the machine could not land back to staged, for the sweep,
// with why in the machine's words.
export async function stagedAgain(
  orgId: string,
  userId: string,
  id: string,
  said: string,
): Promise<void> {
  await asOrg(orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [userId]);
    await q.query(
      "update files set state = 'ready', said = $2 where id = $1 and state = 'landing'",
      [id, said],
    );
  });
}

// Files whole in the store and not yet off it, older than a moment: a
// landing that was interrupted, or one whose word never arrived, to be
// tried again by the sweep.
export async function stagedIn(
  orgId: string,
  before: Date,
): Promise<(StoredFile & { userId: string })[]> {
  return asOrg(orgId, async (q) => {
    await q.query("select set_config('app.meter', 'sweep', true)");
    return (
      await q.query<StoredFile & { userId: string }>(
        `select ${COLUMNS}, user_id as "userId" from files where state in ('ready', 'landing') and deleted_at is null and ready_at < $1`,
        [before],
      )
    ).rows;
  });
}

export async function forgetFileIn(
  orgId: string,
  userId: string,
  id: string,
): Promise<void> {
  await asOrg(orgId, async (q) => {
    await q.query("select set_config('app.member_id', $1, true)", [userId]);
    await q.query("update files set deleted_at = now() where id = $1", [id]);
  });
}
