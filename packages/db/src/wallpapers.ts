import type { Query } from "./index.ts";

// One wallpaper a person put in the bucket: its object and what it weighs.
export type Own = { id: string; key: string; bytes: number; createdAt: Date };

// What a desk wears: a built-in's name, "plain" for the bare ground, or
// "own:<key>" for one of the person's own.
export type Choice = string;

const COLUMNS = 'id, key, bytes::float8 as bytes, created_at as "createdAt"';

// The wallpapers the person uploaded, newest first.
export async function ownWallpapers(q: Query): Promise<Own[]> {
  return (
    await q.query<Own>(
      `select ${COLUMNS} from wallpapers order by created_at desc`,
    )
  ).rows;
}

// The wallpaper the person's desk wears, or null while they have not
// chosen one.
export async function wallpaperOf(q: Query): Promise<Choice | null> {
  return (
    (
      await q.query<{ wallpaper: string | null }>(
        "select wallpaper from users where id = current_member()",
      )
    ).rows[0]?.wallpaper ?? null
  );
}

// Wears this wallpaper from now on.
export async function wearWallpaper(q: Query, choice: Choice): Promise<void> {
  await q.query("update users set wallpaper = $1 where id = current_member()", [
    choice,
  ]);
}

// Keeps a wallpaper the person uploaded. One object is one wallpaper, so
// finishing the same upload twice answers the row that is already there.
export async function addWallpaper(
  q: Query,
  key: string,
  bytes: number,
): Promise<Own> {
  const made = await q.query<Own>(
    `insert into wallpapers (key, bytes) values ($1, $2)
       on conflict (member_id, key) do nothing returning ${COLUMNS}`,
    [key, bytes],
  );
  return (
    made.rows[0] ??
    (
      await q.query<Own>(`select ${COLUMNS} from wallpapers where key = $1`, [
        key,
      ])
    ).rows[0]!
  );
}

// Forgets one of the person's own wallpapers; the row's going owes its
// object its deletion. A desk wearing it falls back to the bare ground.
// False when they have no such wallpaper.
export async function removeWallpaper(q: Query, key: string): Promise<boolean> {
  const gone = await q.query("delete from wallpapers where key = $1", [key]);
  if (gone.rowCount !== 1) return false;
  await q.query(
    "update users set wallpaper = null where id = current_member() and wallpaper = $1",
    [`own:${key}`],
  );
  return true;
}
