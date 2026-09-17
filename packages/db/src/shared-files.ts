import type { Query } from "./index.ts";

// Files and folders a person shared from their computer, who may reach
// each, and the copy of each in the bucket. Every door here runs inside a
// transaction opened as a person of the org.

export type Level = "view" | "edit";
export type Subject =
  { who: "everyone" } | { who: "group" | "member"; id: string };

// One shared thing of the owner's, by the id its door marked it with.
export type SharedFile = {
  id: string;
  computerId: string;
  name: string;
  kind: "file" | "dir";
};

// Who one shared thing reaches, at what level.
export type FileShare = {
  fileId: string;
  subject: "everyone" | "group" | "member";
  memberId: string | null;
  groupId: string | null;
  level: Level;
};

// What one shared thing reaches, as the sheet sets it whole.
export type Reach = {
  everyone: boolean;
  groupIds: string[];
  memberIds: string[];
  level: Level;
};

// A shared thing as a reader sees it: whose, and how much they may do,
// which is owner for the owner's own.
export type Reaching = SharedFile & {
  ownerId: string;
  owner: string;
  machineId: string | null;
  ready: boolean;
  level: Level | "owner";
};

// One object in the bucket: the file itself at path "", or a file under
// a shared folder by its path there.
export type Copy = {
  fileId: string;
  path: string;
  key: string;
  bytes: number;
  modified: Date;
  pending: boolean;
};

const FILE = `id, computer_id as "computerId", name, kind`;
const REACHING = `f.id, f.computer_id as "computerId", f.name, f.kind,
  c.user_id as "ownerId", u.name as owner,
  c.machine_id as "machineId", c.ready_at is not null as ready,
  file_level(f.id) as level`;

// The owner's shared things on one computer, with who each reaches.
export async function sharedFilesOn(
  q: Query,
  computerId: string,
): Promise<{ files: SharedFile[]; shares: FileShare[] }> {
  const [files, shares] = await Promise.all([
    q.query<SharedFile>(
      `select ${FILE} from shared_files where computer_id = $1 order by name`,
      [computerId],
    ),
    q.query<FileShare>(
      `select file_id as "fileId", subject, member_id as "memberId",
              group_id as "groupId", level
       from file_shares where computer_id = $1
       order by file_id, subject, member_id, group_id`,
      [computerId],
    ),
  ]);
  return { files: files.rows, shares: shares.rows };
}

// One shared thing by id, as the reader may see it: its owner, whether
// the machine is ready, and the most the reader may do with it. Null when
// nothing of the kind reaches them.
export async function fileReaching(
  q: Query,
  id: string,
): Promise<Reaching | null> {
  return (
    (
      await q.query<Reaching>(
        `select ${REACHING}
         from shared_files f
         join computers c on c.id = f.computer_id
         join users u on u.id = c.user_id
         where f.id = $1`,
        [id],
      )
    ).rows[0] ?? null
  );
}

// Everything other people shared with the member reading, by name, by a
// group they are in, or with everyone in the org; their own are not among
// them.
export async function filesReaching(q: Query): Promise<Reaching[]> {
  return (
    await q.query<Reaching>(
      `select ${REACHING}
       from shared_files f
       join computers c on c.id = f.computer_id
       join users u on u.id = c.user_id
       where c.user_id <> current_member()
       order by u.name, f.name`,
    )
  ).rows;
}

// Makes what one shared thing reaches exactly this and nothing else. The
// thing is written first, so a first share makes it; a reach of nobody
// takes the thing away, and its copies with it. Answers whether it is
// still shared.
export async function shareFile(
  q: Query,
  file: SharedFile,
  to: Reach,
): Promise<boolean> {
  const shared =
    to.everyone || to.groupIds.length > 0 || to.memberIds.length > 0;
  if (!shared) {
    await q.query("delete from shared_files where id = $1", [file.id]);
    return false;
  }
  await q.query(
    `insert into shared_files (id, computer_id, name, kind) values ($1, $2, $3, $4)
     on conflict (id) do update set name = excluded.name`,
    [file.id, file.computerId, file.name, file.kind],
  );
  // The whole reach is set in one act: whoever is left off, or given at
  // another level, goes, and the rest is written in.
  await q.query(
    `delete from file_shares
     where file_id = $1
       and (level <> $2
         or not (subject = 'everyone' and $3)
           and (group_id is null or group_id <> all($4::uuid[]))
           and (member_id is null or member_id <> all($5::uuid[])))`,
    [file.id, to.level, to.everyone, to.groupIds, to.memberIds],
  );
  if (to.everyone)
    await q.query(
      `insert into file_shares (computer_id, file_id, subject, level)
       values ($1, $2, 'everyone', 'view') on conflict do nothing`,
      [file.computerId, file.id],
    );
  if (to.groupIds.length > 0)
    await q.query(
      `insert into file_shares (computer_id, file_id, subject, group_id, level)
       select $1, $2, 'group', unnest($3::uuid[]), $4 on conflict do nothing`,
      [file.computerId, file.id, to.groupIds, to.level],
    );
  if (to.memberIds.length > 0)
    await q.query(
      `insert into file_shares (computer_id, file_id, subject, member_id, level)
       select $1, $2, 'member', unnest($3::uuid[]), $4 on conflict do nothing`,
      [file.computerId, file.id, to.memberIds, to.level],
    );
  return true;
}

// Gives one shared thing to one more subject at a level, leaving whoever
// already has it: what accepting the agent's ask does.
export async function giveFile(
  q: Query,
  file: SharedFile,
  to: Subject,
  level: Level,
): Promise<void> {
  await q.query(
    `insert into shared_files (id, computer_id, name, kind) values ($1, $2, $3, $4)
     on conflict (id) do update set name = excluded.name`,
    [file.id, file.computerId, file.name, file.kind],
  );
  // A party already given it keeps what they had, or rises to edit.
  await q.query(
    `insert into file_shares (computer_id, file_id, subject, member_id, group_id, level)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (file_id, subject, coalesce(member_id, group_id, computer_id))
       do update set level = case when excluded.level = 'edit' then 'edit' else file_shares.level end`,
    [
      file.computerId,
      file.id,
      to.who,
      to.who === "member" ? to.id : null,
      to.who === "group" ? to.id : null,
      to.who === "everyone" ? "view" : level,
    ],
  );
}

// Takes a shared thing away entirely: the file is gone from the disk, or
// its owner is. Its shares and copies go with it.
export async function dropSharedFile(q: Query, id: string): Promise<void> {
  await q.query("delete from shared_files where id = $1", [id]);
}

// The members one reach names, one by one, for telling each: everyone in
// the org, every member of the groups, and the people named; never the
// member writing.
export async function membersReached(
  q: Query,
  to: { everyone: boolean; groupIds: string[]; memberIds: string[] },
): Promise<string[]> {
  const { rows } = await q.query<{ id: string }>(
    `select distinct u.id from users u
     where u.id <> current_member()
       and ($1 or u.id = any($3::uuid[])
         or exists (select 1 from group_members m
                    where m.member_id = u.id and m.group_id = any($2::uuid[])))`,
    [to.everyone, to.groupIds, to.memberIds],
  );
  return rows.map((r) => r.id);
}

// Owes an object its deletion from the moment it has an address, due once
// the address has expired: an upload nothing comes back to record is
// deleted by the sweep, and one still landing is not.
export const oweCopy = (
  q: Query,
  orgId: string,
  key: string,
  inSeconds: number,
  bytes: number,
) =>
  q.query(
    `insert into orphans (org_id, kind, ref, due_at, bytes)
       values ($1, 'copy', $2, now() + make_interval(secs => $3), $4)`,
    [orgId, key, inSeconds, bytes],
  );

// Takes back the debt on an object the member it was signed for says has
// landed; false when no such debt is theirs.
export async function copyLanded(q: Query, key: string): Promise<boolean> {
  return (
    (
      await q.query(
        `delete from orphans
           where kind = 'copy' and ref = $1 and user_id = current_member()`,
        [key],
      )
    ).rowCount === 1
  );
}

// Takes back the debts on objects recorded as copies, by the member who
// owed them.
export async function copiesRecorded(q: Query, keys: string[]): Promise<void> {
  await q.query(
    `delete from orphans
       where kind = 'copy' and ref = any($1::text[]) and user_id = current_member()`,
    [keys],
  );
}

const COPY = `file_id as "fileId", path, key, bytes, modified, pending`;

// Every copy of one shared thing.
export async function copiesOf(q: Query, fileId: string): Promise<Copy[]> {
  return (
    await q.query<Copy>(
      `select ${COPY} from file_copies where file_id = $1 order by path`,
      [fileId],
    )
  ).rows;
}

// One copy, or null when there is none. Held, it is held until the
// transaction ends, so two saves of it are one after the other.
export async function copyAt(
  q: Query,
  fileId: string,
  path: string,
  hold = false,
): Promise<Copy | null> {
  return (
    (
      await q.query<Copy>(
        `select ${COPY} from file_copies where file_id = $1 and path = $2${hold ? " for update" : ""}`,
        [fileId, path],
      )
    ).rows[0] ?? null
  );
}

// What a shared thing's copies weigh and count, against the ceilings,
// with every object signed for and not yet landed counted as if it had.
export async function copiesWeigh(
  q: Query,
  fileId: string,
): Promise<{ files: number; bytes: number }> {
  const { rows } = await q.query<{ files: string; bytes: string | null }>(
    `select count(*) as files, coalesce(sum(bytes), 0) as bytes from (
       select bytes from file_copies where file_id = $1
       union all
       select bytes from orphans
         where kind = 'copy' and ref like $2 and due_at > now() and bytes is not null
     ) as held`,
    [fileId, `shares/${fileId}/%`],
  );
  return { files: Number(rows[0]!.files), bytes: Number(rows[0]!.bytes ?? 0) };
}

// Records a copy as it now is in the bucket.
// Records a copy as it now is in the bucket. Told which object the copy
// named when it was read, it lands only if that is still the one, so a
// save that landed meanwhile is never written over; a copy from the disk
// never lands over a colleague's save still to be taken. Answers whether
// it landed.
export async function setCopy(
  q: Query,
  c: Copy,
  over?: string | null,
): Promise<boolean> {
  const r = await q.query(
    `insert into file_copies (file_id, path, key, bytes, modified, pending)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (file_id, path) do update
       set key = excluded.key, bytes = excluded.bytes,
           modified = excluded.modified, pending = excluded.pending
       where ($7::text is null or file_copies.key = $7)
         and (excluded.pending or not file_copies.pending or file_copies.key = $7)`,
    [c.fileId, c.path, c.key, c.bytes, c.modified, c.pending, over ?? null],
  );
  return (r.rowCount ?? 0) === 1;
}

// Holds a shared thing for the rest of the transaction, so what is
// counted against its ceilings is counted by one writer at a time. A
// lock on the id rather than the row, since an editor may not update the
// row and a row lock would pass them by.
export async function holdSharedFile(q: Query, id: string): Promise<void> {
  await q.query("select pg_advisory_xact_lock(hashtext($1))", [id]);
}

// The copies colleagues wrote to one shared thing that its door has not
// taken yet.
export async function pendingCopiesOf(
  q: Query,
  fileId: string,
): Promise<Copy[]> {
  return (
    await q.query<Copy>(
      `select ${COPY} from file_copies
       where file_id = $1 and pending order by path`,
      [fileId],
    )
  ).rows;
}

// Forgets a copy; its object is owed its deletion by the row's going.
export async function dropCopy(
  q: Query,
  fileId: string,
  path: string,
): Promise<void> {
  await q.query("delete from file_copies where file_id = $1 and path = $2", [
    fileId,
    path,
  ]);
}

// The copies colleagues wrote that a computer's door has not taken yet.
export async function pendingCopies(
  q: Query,
  computerId: string,
): Promise<Copy[]> {
  return (
    await q.query<Copy>(
      `select c.file_id as "fileId", c.path, c.key, c.bytes, c.modified, c.pending
       from file_copies c join shared_files f on f.id = c.file_id
       where f.computer_id = $1 and c.pending order by c.file_id, c.path`,
      [computerId],
    )
  ).rows;
}
