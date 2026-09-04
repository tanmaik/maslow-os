import { asOrg, asPerson } from "./index.ts";
import type { Principal } from "./auth.ts";

export type StoredFile = {
  id: string;
  name: string;
  size: number;
  contentType: string;
  // The folder it lives in: "/" or "/a/b".
  path: string;
  key: string;
  state: "uploading" | "ready";
  uploadId: string | null;
  createdAt: Date;
  readyAt: Date | null;
};

const COLUMNS =
  'id, name, size::float8 as size, content_type as "contentType", path, key, state, upload_id as "uploadId", created_at as "createdAt", ready_at as "readyAt"';

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
      bytes: files.reduce((n, f) => n + (f.state === "ready" ? f.size : 0), 0),
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

export type Folder = { path: string; name: string; createdAt: Date };

// One folder of the person's filesystem: its folders and its files.
export async function listing(
  p: Principal,
  path: string,
): Promise<{ folders: Folder[]; files: StoredFile[] }> {
  const prefix = path === "/" ? "/" : `${path}/`;
  return asPerson(p, async (q) => ({
    folders: (
      await q.query<Folder>(
        `select path, substring(path from '[^/]+$') as name, created_at as "createdAt"
           from folders where left(path, length($1)) = $1 and position('/' in substring(path from length($1) + 1)) = 0 order by name`,
        [prefix],
      )
    ).rows,
    files: (
      await q.query<StoredFile>(
        `select ${COLUMNS} from files where path = $1 and deleted_at is null order by name`,
        [path],
      )
    ).rows,
  }));
}

export async function folderExists(p: Principal, path: string) {
  if (path === "/") return true;
  return asPerson(
    p,
    async (q) =>
      (await q.query("select 1 from folders where path = $1", [path]))
        .rowCount === 1,
  );
}

// Makes a folder, and the folders above it that do not exist yet.
export async function createFolder(p: Principal, path: string): Promise<void> {
  await asPerson(p, async (q) => {
    const parts = path.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++)
      await q.query(
        "insert into folders (org_id, user_id, path) values ($1, $2, $3) on conflict do nothing",
        [p.orgId, p.userId, "/" + parts.slice(0, i).join("/")],
      );
  });
}

export async function renameFile(
  p: Principal,
  id: string,
  name: string,
): Promise<boolean> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query(
          "update files set name = $2 where id = $1 and deleted_at is null",
          [id, name],
        )
      ).rowCount === 1,
  );
}

export async function moveFile(
  p: Principal,
  id: string,
  path: string,
): Promise<boolean> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query(
          "update files set path = $2 where id = $1 and deleted_at is null",
          [id, path],
        )
      ).rowCount === 1,
  );
}

// Moves or renames a folder: it and everything under it take the new path.
export async function moveFolder(
  p: Principal,
  from: string,
  to: string,
): Promise<boolean> {
  return asPerson(p, async (q) => {
    const moved = await q.query(
      "update folders set path = $2 where path = $1",
      [from, to],
    );
    if (!moved.rowCount) return false;
    // Descendants by literal prefix, never by pattern: a folder named with
    // % or _ moves only its own.
    await q.query(
      "update folders set path = $2 || substring(path from length($1) + 1) where left(path, length($1) + 1) = $1 || '/'",
      [from, to],
    );
    await q.query(
      "update files set path = $2 || substring(path from length($1) + 1) where path = $1 or left(path, length($1) + 1) = $1 || '/'",
      [from, to],
    );
    return true;
  });
}

// Every file under a folder, any depth, that still has bytes.
export async function filesUnder(
  p: Principal,
  path: string,
): Promise<StoredFile[]> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query<StoredFile>(
          `select ${COLUMNS} from files where (path = $1 or left(path, length($1) + 1) = $1 || '/') and deleted_at is null`,
          [path],
        )
      ).rows,
  );
}

// Forgets a folder and every folder under it; its files must be gone first.
export async function deleteFolder(
  p: Principal,
  path: string,
): Promise<boolean> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query(
          "delete from folders where path = $1 or left(path, length($1) + 1) = $1 || '/'",
          [path],
        )
      ).rowCount! > 0,
  );
}

// Marks a file gone only if it is still under the folder being deleted; one
// moved out meanwhile is left alone. True when marked.
export async function forgetFileUnder(
  p: Principal,
  id: string,
  path: string,
): Promise<boolean> {
  return asPerson(
    p,
    async (q) =>
      (
        await q.query(
          "update files set deleted_at = now() where id = $1 and deleted_at is null and (path = $2 or left(path, length($2) + 1) = $2 || '/')",
          [id, path],
        )
      ).rowCount === 1,
  );
}

// Gives a file back its place when its bytes would not go.
export async function unforgetFile(p: Principal, id: string): Promise<void> {
  await asPerson(p, (q) =>
    q.query("update files set deleted_at = null where id = $1", [id]),
  );
}
