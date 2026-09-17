import { randomBytes } from "node:crypto";

import { asOrg, asPerson, type Query } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { computerById, type Computer } from "@maslow/db/computers";
import { groupsOf } from "@maslow/db/groups";
import { tellNotification } from "@maslow/db/notifications";
import { orgOf } from "@maslow/db/settings";
import {
  copiesOf,
  copiesRecorded,
  copiesWeigh,
  copyAt,
  copyLanded,
  holdSharedFile,
  dropCopy,
  dropSharedFile,
  fileReaching,
  filesReaching,
  giveFile,
  membersReached,
  oweCopy,
  pendingCopies,
  pendingCopiesOf,
  setCopy,
  shareFile as setReach,
  sharedFilesOn,
  type Copy,
  type FileShare,
  type Level,
  type Reach,
  type Reaching,
  type SharedFile,
  type Subject,
} from "@maslow/db/shared-files";

import { ready, ticket } from "./computer.ts";
import { deployment } from "./deployment.ts";
import { Changed, fly, Gone, type Entry, type SharedEntry } from "./fly.ts";
import { CEILINGS } from "./prices.ts";
import { bucketed, bytesOf, putBytes, signed } from "./storage.ts";
import { typeOf } from "../app/computer/files/serve.ts";

// Files and folders shared from a person's computer. A shared thing is
// read from the owner's machine while it is up and from its copy in the
// bucket while it is not; the copy is written on the share, after every
// save a colleague makes, whenever a read finds it behind, and every hour.
// A colleague's save lands on the disk at once when the machine is up and
// the next time it is.

// Thrown for what the person can be told in a sentence: not theirs, not
// ready, too big.
export class Refused extends Error {}

// How long an address a colleague reads a copy at is good for.
const READ_FOR = 3600;
// How long an address the door mirrors to or takes from is good for.
const MIRROR_FOR = 3 * 3600;
// The most a copy weighs to be read through us rather than at its own
// address: what the editor takes.
const THROUGH = 2 * 1024 * 1024;

// A fresh id for a shared thing: twelve characters the door takes.
const freshId = () => randomBytes(6).toString("hex");

// Where a copy of one file of a shared thing is kept: a fresh key each
// time it is written, so a write in flight never lands on the object a
// reader is reading, and the object a row stops naming is owed its
// deletion by the row's change.
const keyOf = (id: string, path: string) =>
  `shares/${id}/${randomBytes(4).toString("hex")}/${path || "file"}`;

const t = (c: Computer) => ticket(c, 60);

// A colleague's view of one shared thing: what it is, who owns it, how
// much they may do, and the owner's machine when it is up.
export type Opened = { file: Reaching; live: Computer | null };

// The shared thing by id, as the reader may see it, or null when nothing
// of the kind reaches them: not signed in, not shared with them, or no
// such id, all one nothing.
export async function openShared(
  p: Principal,
  id: string,
): Promise<Opened | null> {
  if (deployment.computers.kind === "none") return null;
  const o = await asPerson(p, async (q) => {
    const file = await fileReaching(q, id);
    if (!file) return null;
    const c = await computerById(q, file.computerId);
    return { file, live: c?.readyAt && c.machineId ? c : null };
  });
  // A machine ready on its row may be stopped or moving right now: it is
  // live only if its door answers, and its copy stands in otherwise.
  if (o?.live && !(await fly.answers(o.live.machineId!, 3_000)))
    return { ...o, live: null };
  // Saves made while the machine was off land on the disk before anyone
  // reads, saves or checks against it, so the disk is the latest word.
  if (o?.live && bucketed()) {
    const waiting = await asPerson(p, (q) => pendingCopiesOf(q, o.file.id));
    if (waiting.length > 0)
      await takePending(await ownerPrincipal(o.live), o.live, o.file.id);
  }
  return o;
}

// What the sheet on a file or folder needs: the groups and people it can
// be given to, and everything the person has shared with who each
// reaches. Null until their computer is ready.
export async function sharingOf(p: Principal): Promise<{
  members: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  files: SharedFile[];
  shares: FileShare[];
} | null> {
  const c = await ready(p);
  if (!c) return null;
  const [{ members }, groups, mine] = await Promise.all([
    orgOf(p),
    groupsOf(p),
    asPerson(p, (q) => sharedFilesOn(q, c.id)),
  ]);
  return {
    members: members
      .filter((m) => m.id !== p.userId)
      .map((m) => ({ id: m.id, name: m.name })),
    groups: groups
      .filter((g) => !g.everyone)
      .map((g) => ({ id: g.id, name: g.name })),
    ...mine,
  };
}

// Everything shared with this person, by whom. Empty where this
// deployment has no computers.
export async function sharedWithMe(
  p: Principal,
): Promise<{ owner: string; ownerId: string; files: Reaching[] }[]> {
  if (deployment.computers.kind === "none") return [];
  const all = await asPerson(p, filesReaching);
  const by = new Map<
    string,
    { owner: string; ownerId: string; files: Reaching[] }
  >();
  for (const f of all) {
    const had = by.get(f.ownerId) ?? {
      owner: f.owner,
      ownerId: f.ownerId,
      files: [],
    };
    had.files.push(f);
    by.set(f.ownerId, had);
  }
  return [...by.values()];
}

// What a shared thing weighs and holds, against the ceilings, said as a
// refusal when it is past them.
function tooBig(files: SharedEntry[], more: boolean): string | null {
  const bytes = files.reduce((n, f) => n + f.size, 0);
  if (more || files.length > CEILINGS.shareFiles)
    return `That holds more than ${CEILINGS.shareFiles.toLocaleString()} files, which is more than can be shared.`;
  if (bytes > CEILINGS.shareBytes)
    return `That weighs more than ${Math.round(CEILINGS.shareBytes / 1024 ** 3)} GB, which is more than can be shared.`;
  return null;
}

// Whether the thing, as it stands on the disk, is under the ceilings;
// refused with why when it is not. A mark made for this alone is undone.
async function fits(
  c: Computer,
  file: SharedFile,
  had: boolean,
): Promise<void> {
  const walked = await fly.shared.files(c.machineId!, t(c), file.id);
  if (!("files" in walked)) return;
  const why = tooBig(walked.files, walked.more);
  if (!why) return;
  if (!had)
    await fly.shared.forget(c.machineId!, t(c), file.id).catch(() => {});
  throw new Refused(why);
}

// Whether the thing's copies, with one more file of so many bytes at this
// path, stay under the ceilings; refused with why when they would not.
// The thing is held, so two writers count one after the other.
async function room(
  q: Query,
  id: string,
  at: string,
  bytes: number,
): Promise<void> {
  await holdSharedFile(q, id);
  const [weigh, was] = await Promise.all([
    copiesWeigh(q, id),
    copyAt(q, id, at),
  ]);
  const files = weigh.files + (was ? 0 : 1);
  const total = weigh.bytes - (was?.bytes ?? 0) + bytes;
  if (files > CEILINGS.shareFiles)
    throw new Refused(
      `That would hold more than ${CEILINGS.shareFiles.toLocaleString()} files.`,
    );
  if (total > CEILINGS.shareBytes)
    throw new Refused(
      `That would weigh more than ${Math.round(CEILINGS.shareBytes / 1024 ** 3)} GB.`,
    );
}

// Marks a thing of the person's with an id through their door, or finds
// the id it already has. Refused while their computer is not ready.
async function marked(
  p: Principal,
  at: string,
): Promise<{ c: Computer; file: SharedFile; had: boolean }> {
  const c = await ready(p);
  if (!c) throw new Refused("Your computer is not ready.");
  const { had, ...got } = await fly.shared.share(
    c.machineId!,
    t(c),
    at,
    freshId(),
  );
  return { c, file: { ...got, computerId: c.id }, had };
}

// Makes what one file or folder of the person's reaches exactly this:
// everyone in the org, or some groups and people, at view or edit. Given
// nobody, the share ends and the copy goes. Answers the thing, still
// shared or not, so the caller can copy it out and tell whoever it
// reached.
export async function shareFile(
  p: Principal,
  at: string,
  to: Reach,
): Promise<{ file: SharedFile; shared: boolean }> {
  const { c, file, had } = await marked(p, at);
  const shared =
    to.everyone || to.groupIds.length > 0 || to.memberIds.length > 0;
  if (shared) await fits(c, file, had);
  const still = await asPerson(p, (q) => setReach(q, file, to));
  if (!still)
    await fly.shared.forget(c.machineId!, t(c), file.id).catch(() => {});
  return { file, shared: still };
}

// Gives one thing of the person's to one more party at a level, inside
// the transaction that accepts the agent's ask.
export async function giveSharedFile(
  q: Query,
  p: Principal,
  at: string,
  to: Subject,
  level: Level,
): Promise<{ file: SharedFile; had: boolean }> {
  const { c, file, had } = await marked(p, at);
  await fits(c, file, had);
  await giveFile(q, file, to, level);
  return { file, had };
}

// Undoes the marks an ask made before it failed, so nothing on the disk
// says shared that reaches nobody.
export async function unmarked(
  p: Principal,
  files: { file: SharedFile; had: boolean }[],
): Promise<void> {
  const c = await ready(p);
  if (!c) return;
  for (const { file, had } of files)
    if (!had)
      await fly.shared.forget(c.machineId!, t(c), file.id).catch(() => {});
}

// Tells each person a share reached, in the sharer's name: a note behind
// their clock, with the way to open it.
export async function tellReached(
  p: Principal,
  file: SharedFile,
  to: { everyone: boolean; groupIds: string[]; memberIds: string[] },
): Promise<void> {
  await asPerson(p, async (q) => {
    const { members } = await orgOf(p);
    const me = members.find((m) => m.id === p.userId)?.name ?? "A colleague";
    for (const id of await membersReached(q, to))
      await tellNotification(q, id, {
        title: `${me} shared ${file.name} with you`,
        body: `It is in Files, under ${me}, and at /file/${file.id}.`,
        from: me,
      });
  });
}

// Files an accepted ask handed over, said to whoever each reached and
// copied out, once the answer has landed.
export async function told(
  p: Principal,
  files: { file: SharedFile; to: Subject }[],
): Promise<void> {
  // One note per person per thing, however many ways it reached them.
  const by = new Map<
    string,
    {
      file: SharedFile;
      everyone: boolean;
      groupIds: string[];
      memberIds: string[];
    }
  >();
  for (const { file, to } of files) {
    const r = by.get(file.id) ?? {
      file,
      everyone: false,
      groupIds: [],
      memberIds: [],
    };
    if (to.who === "everyone") r.everyone = true;
    if (to.who === "group") r.groupIds.push(to.id);
    if (to.who === "member") r.memberIds.push(to.id);
    by.set(file.id, r);
  }
  for (const { file, ...reach } of by.values()) {
    await tellReached(p, file, reach).catch((err) =>
      console.error(`share ${file.id}: ${(err as Error).message}`),
    );
    const o = await openShared(p, file.id);
    if (o) await refreshAfterRead(o);
  }
}

// A shared thing the door says is gone from the disk for good: its share
// ends now, for everyone, its rows go and its copies are owed, rather
// than on the next hourly look.
async function ended(o: Opened): Promise<void> {
  if (!o.live) return;
  try {
    const owner = await ownerPrincipal(o.live);
    await asPerson(owner, (q) => dropSharedFile(q, o.file.id));
    await fly.shared.forget(o.live.machineId!, t(o.live), o.file.id);
  } catch (err) {
    console.error(`share ${o.file.id}: ${(err as Error).message}`);
  }
}

// Entries under a shared folder from its copies alone, for a machine that
// is off: the files at this depth, and the folders their paths imply.
function fromCopies(copies: Copy[], at: string): Entry[] {
  const under = at ? `${at}/` : "";
  const seen = new Map<string, Entry>();
  for (const c of copies) {
    if (!c.path.startsWith(under)) continue;
    const rest = c.path.slice(under.length);
    const [name, ...deeper] = rest.split("/");
    if (!name) continue;
    if (deeper.length === 0)
      seen.set(name, {
        name,
        kind: "file",
        size: c.bytes,
        modified: c.modified.toISOString(),
      });
    else if (!seen.has(name))
      seen.set(name, {
        name,
        kind: "dir",
        size: 0,
        modified: c.modified.toISOString(),
      });
  }
  return [...seen.values()].sort((a, b) =>
    a.kind === b.kind
      ? a.name.localeCompare(b.name)
      : a.kind === "dir"
        ? -1
        : 1,
  );
}

// What one folder of a shared thing holds: from the machine while it is
// up, from the copies while it is not.
export async function listShared(
  p: Principal,
  o: Opened,
  at: string,
): Promise<Entry[] | null> {
  if (o.live) {
    try {
      return await fly.shared.list(o.live.machineId!, t(o.live), o.file.id, at);
    } catch (err) {
      if (!(err instanceof Gone)) throw err;
      await ended(o);
      return null;
    }
  }
  return fromCopies(await asPerson(p, (q) => copiesOf(q, o.file.id)), at);
}

// One file of a shared thing as it now is, and where the answer came
// from. Null when there is no such file.
export async function statShared(
  p: Principal,
  o: Opened,
  at: string,
): Promise<{
  name: string;
  kind: "file" | "dir";
  size: number;
  modified: string;
  live: boolean;
} | null> {
  if (o.live) {
    const s = await fly.shared.stat(
      o.live.machineId!,
      t(o.live),
      o.file.id,
      at,
    );
    if (s && "gone" in s) await ended(o);
    if (!s || !("name" in s)) return null;
    return {
      name: s.name,
      kind: s.kind,
      size: s.size,
      modified: s.modified,
      live: true,
    };
  }
  // A shared folder itself is known without the machine; a file under
  // it, or a shared file, from its copy.
  if (at === "" && o.file.kind === "dir")
    return {
      name: o.file.name,
      kind: "dir",
      size: 0,
      modified: "",
      live: false,
    };
  const copy = await asPerson(p, (q) => copyAt(q, o.file.id, at));
  if (!copy) return null;
  return {
    name: at.split("/").pop() || o.file.name,
    kind: "file",
    size: copy.bytes,
    modified: copy.modified.toISOString(),
    live: false,
  };
}

// The bytes of one file of a shared thing: streamed from the machine while
// it is up; while it is not, the bytes through us when they are few, as
// the editor reads them, or an address in the bucket signed for reading
// it. Null when there is no such file, and Refused when the machine is
// off and nothing holds a copy.
export async function readShared(
  p: Principal,
  o: Opened,
  at: string,
  range?: string,
): Promise<{ stream: Response } | { redirect: string } | null> {
  if (o.live) {
    try {
      return {
        stream: await fly.shared.read(
          o.live.machineId!,
          t(o.live),
          o.file.id,
          at,
          range,
        ),
      };
    } catch (err) {
      if (!(err instanceof Gone)) throw err;
      await ended(o);
      return null;
    }
  }
  const copy = await asPerson(p, (q) => copyAt(q, o.file.id, at));
  if (!copy) return null;
  const url = signed(
    "GET",
    copy.key,
    READ_FOR,
    undefined,
    typeOf(at || o.file.name),
  );
  if (!url) throw new Refused("The owner's computer is off.");
  if (copy.bytes > THROUGH) return { redirect: url };
  const res = await fetch(url, { headers: range ? { range } : {} });
  if (!res.ok && res.status !== 416)
    throw new Error(`the bucket answered ${res.status}`);
  return { stream: res };
}

// A file of a shared thing as a PDF, which only the owner's machine can
// make from a document; a PDF as it is comes as any other read does.
export async function pdfShared(o: Opened, at: string): Promise<Response> {
  if (!o.live) throw new Refused("The owner's computer is off.");
  return fly.shared.pdf(o.live.machineId!, t(o.live), o.file.id, at);
}

// A file of a shared thing written whole by a colleague at edit. The save
// says when the file was last changed as it was opened, and a file
// changed since throws Changed rather than being written over. On the
// disk at once while the machine is up, and into the copy either way;
// while the machine is off the copy waits for it.
export async function writeShared(
  p: Principal,
  o: Opened,
  at: string,
  bytes: Uint8Array,
  opened?: string,
): Promise<{ size: number; modified: string }> {
  if (at === "" && o.file.kind === "dir")
    throw new Refused("A folder is not written; a file in it is.");
  // The right to write is read as the write happens, not as the page was
  // opened: a share taken away meanwhile is refused here.
  const now = await asPerson(p, (q) => fileReaching(q, o.file.id));
  if (!now || now.level === "view")
    throw new Refused("You may only look at it.");
  const key = keyOf(o.file.id, at);
  if (o.live) {
    // Room for it in the copy is checked before anything lands on the
    // disk, so a refusal leaves both sides as they were; and the copy
    // this save replaces is the one it saw before writing, so a slower
    // save never lands over a quicker one that came after it.
    const was = bucketed()
      ? await asPerson(p, async (q) => {
          await room(q, o.file.id, at, bytes.length);
          return copyAt(q, o.file.id, at);
        })
      : null;
    const wrote = await fly.shared.write(
      o.live.machineId!,
      t(o.live),
      o.file.id,
      at,
      bytes,
      opened,
    );
    // The object is owed in a transaction of its own before it is
    // written, so a write that fails after the bytes landed still owes
    // them, and the debt is taken back once a row names them.
    if (bucketed()) {
      await asPerson(p, (q) =>
        oweCopy(q, p.orgId, key, READ_FOR, bytes.length),
      );
      await putBytes(key, bytes, typeOf(at || o.file.name));
      await asPerson(p, async (q) => {
        if (
          await setCopy(
            q,
            {
              fileId: o.file.id,
              path: at,
              key,
              bytes: bytes.length,
              modified: new Date(wrote.modified),
              pending: false,
            },
            was?.key ?? null,
          )
        )
          await copiesRecorded(q, [key]);
      });
    }
    return wrote;
  }
  if (!bucketed()) throw new Refused("The owner's computer is off.");
  // Room is counted and the debt owed first, in a transaction of their
  // own, so the debt outlives a write that fails after the bytes landed;
  // then the check, the write and the record are one held transaction,
  // so two saves of one file while the machine is off land one after the
  // other and the second is told it fell behind.
  const modified = new Date();
  await asPerson(p, async (q) => {
    await room(q, o.file.id, at, bytes.length);
    await oweCopy(q, p.orgId, key, READ_FOR, bytes.length);
  });
  try {
    await asPerson(p, async (q) => {
      const was = await copyAt(q, o.file.id, at, true);
      if (opened && !was) throw new Refused("That file is not there any more.");
      if (opened && was && was.modified.toISOString() !== opened)
        throw new Changed(was.modified.toISOString());
      await putBytes(key, bytes, typeOf(at || o.file.name));
      await setCopy(
        q,
        {
          fileId: o.file.id,
          path: at,
          key,
          bytes: bytes.length,
          modified,
          pending: true,
        },
        was?.key,
      );
      await copiesRecorded(q, [key]);
    });
  } catch (err) {
    // A save refused before its bytes were written owes nothing: the
    // debt goes, so it counts against the ceiling no longer.
    if (err instanceof Refused || err instanceof Changed)
      await asPerson(p, (q) => copiesRecorded(q, [key])).catch(() => {});
    throw err;
  }
  return { size: bytes.length, modified: modified.toISOString() };
}

// Where a colleague's browser puts a file of a shared thing itself: an
// address in the bucket signed for exactly those bytes, owed its deletion
// until the browser comes back to say it landed. Null where nothing signs
// addresses, and the bytes come through us instead.
export async function uploadShared(
  p: Principal,
  o: Opened,
  at: string,
  bytes: number,
): Promise<{ key: string; url: string } | null> {
  if (o.file.level === "view") throw new Refused("You may only look at it.");
  if (at === "" && o.file.kind === "dir")
    throw new Refused("A folder is not written; a file in it is.");
  const key = keyOf(o.file.id, at);
  const url = signed("PUT", key, MIRROR_FOR, bytes);
  if (!url) return null;
  await asPerson(p, async (q) => {
    await room(q, o.file.id, at, bytes);
    await oweCopy(q, p.orgId, key, MIRROR_FOR, bytes);
  });
  return { key, url };
}

// A file the colleague's browser put in the bucket itself, recorded once
// it is there, at the size the bucket says, and taken onto the owner's
// disk at once when the machine is up. Refused when no such upload was
// theirs, or nothing landed.
export async function landedShared(
  p: Principal,
  o: Opened,
  at: string,
  key: string,
): Promise<void> {
  if (
    !key.startsWith(`shares/${o.file.id}/`) ||
    !key.endsWith(`/${at || "file"}`)
  )
    throw new Refused("That upload is not yours.");
  const modified = new Date();
  const bytes = await bytesOf(key);
  if (bytes === null) throw new Refused("That file never arrived.");
  await asPerson(p, async (q) => {
    // Counted once more with what really landed, and still owed if it
    // does not fit, so the sweep takes it back.
    await room(q, o.file.id, at, bytes);
    if (!(await copyLanded(q, key)))
      throw new Refused("That upload is not yours.");
    const was = await copyAt(q, o.file.id, at);
    await setCopy(
      q,
      { fileId: o.file.id, path: at, key, bytes, modified, pending: true },
      was?.key,
    );
  });
  if (o.live) await takePending(p, o.live, o.file.id);
}

// Copies colleagues wrote that the owner's door has not taken yet, taken
// now: fetched onto the disk from addresses signed for them.
async function takePending(
  p: Principal,
  c: Computer,
  id?: string,
): Promise<void> {
  await asPerson(p, async (q) => {
    for (const copy of await pendingCopies(q, c.id)) {
      if (id && copy.fileId !== id) continue;
      const url = signed("GET", copy.key, MIRROR_FOR);
      if (!url) continue;
      try {
        const took = await fly.shared.take(
          c.machineId!,
          t(c),
          copy.fileId,
          copy.path,
          url,
          copy.modified.toISOString(),
        );
        // Recorded only if the copy is still the one taken; a newer save
        // landed meanwhile stays, pending, for the next take.
        await setCopy(
          q,
          { ...copy, modified: new Date(took.modified), pending: false },
          copy.key,
        );
      } catch (err) {
        // The disk is newer than the copy: the last save is the file, so
        // the copy stops waiting and the next refresh copies the disk out.
        if (err instanceof Changed) {
          await setCopy(q, { ...copy, pending: false }, copy.key);
          continue;
        }
        console.error(
          `share ${copy.fileId}: could not take ${copy.path}: ${(err as Error).message}`,
        );
      }
    }
  });
}

// Brings the copy of one shared thing up to the disk: every file changed
// or added since is sent to an address signed for it, every file gone is
// forgotten, a renamed thing is renamed here, and a thing gone from the
// disk for good ends its share. Nothing is sent where there is no bucket.
async function refreshShared(
  p: Principal,
  c: Computer,
  file: SharedFile,
): Promise<void> {
  const m = c.machineId!;
  const s = await fly.shared.stat(m, t(c), file.id);
  if (s === null || "gone" in s) {
    await asPerson(p, (q) => dropSharedFile(q, file.id));
    await fly.shared.forget(m, t(c), file.id).catch(() => {});
    return;
  }
  if ("missing" in s) return;
  if (s.name !== file.name)
    await asPerson(p, (q) =>
      q.query("update shared_files set name = $2 where id = $1", [
        file.id,
        s.name,
      ]),
    );
  if (!bucketed()) return;
  await takePending(p, c, file.id);
  const walked = await fly.shared.files(m, t(c), file.id);
  if (!("files" in walked)) return;
  if (tooBig(walked.files, walked.more)) {
    console.error(`share ${file.id}: past the ceiling, not copied`);
    return;
  }
  const copies = await asPerson(p, (q) => copiesOf(q, file.id));
  const had = new Map(copies.map((x) => [x.path, x]));
  // What the disk has that the copy does not: a file with no copy, or
  // one changed since; never one whose copy is a colleague's save still
  // to be taken.
  const puts = walked.files.filter((f) => {
    const was = had.get(f.path);
    return !was?.pending && (!was || was.modified.toISOString() !== f.modified);
  });
  const now = new Set(walked.files.map((f) => f.path));
  await asPerson(p, async (q) => {
    for (const x of copies)
      if (!now.has(x.path) && !x.pending) await dropCopy(q, file.id, x.path);
  });
  if (puts.length > 0) {
    // Every object is owed its deletion before anything is sent to it,
    // and the debt taken back once a row names it; what never landed, or
    // landed after the door stopped answering, is deleted by the sweep.
    const keys = new Map(puts.map((f) => [f.path, keyOf(file.id, f.path)]));
    await asPerson(p, async (q) => {
      for (const f of puts)
        await oweCopy(q, p.orgId, keys.get(f.path)!, MIRROR_FOR, f.size);
    });
    const sent = await fly.shared.mirror(
      m,
      t(c),
      file.id,
      puts.map((f) => ({
        path: f.path,
        url: signed("PUT", keys.get(f.path)!, MIRROR_FOR, f.size)!,
      })),
    );
    const done = new Set(sent.done);
    await asPerson(p, async (q) => {
      const recorded: string[] = [];
      for (const f of puts) {
        if (!done.has(f.path)) continue;
        // Over the copy that was read, and never over a colleague's save
        // that landed meanwhile; an object not recorded stays owed.
        const landed = await setCopy(
          q,
          {
            fileId: file.id,
            path: f.path,
            key: keys.get(f.path)!,
            bytes: f.size,
            modified: new Date(f.modified),
            pending: false,
          },
          had.get(f.path)?.key ?? null,
        );
        if (landed) recorded.push(keys.get(f.path)!);
      }
      await copiesRecorded(q, recorded);
    });
    for (const f of sent.failed)
      console.error(`share ${file.id}: could not copy ${f.path}: ${f.error}`);
  }
}

// Every shared thing of one computer brought up to date: what the sweep
// does each hour, as its owner.
export async function refreshShares(p: Principal, c: Computer): Promise<void> {
  const { files } = await asPerson(p, (q) => sharedFilesOn(q, c.id));
  for (const file of files) {
    try {
      await refreshShared(p, c, file);
    } catch (err) {
      console.error(`share ${file.id}: ${(err as Error).message}`);
    }
  }
}

// The copy of one shared thing brought up to date after a colleague read
// it from the machine, as its owner, so the copy is never further behind
// than the last look.
export async function refreshAfterRead(o: Opened): Promise<void> {
  if (!o.live || !bucketed()) return;
  try {
    await refreshShared(await ownerPrincipal(o.live), o.live, o.file);
  } catch (err) {
    console.error(`share ${o.file.id}: ${(err as Error).message}`);
  }
}

// The owner of a computer, as the person to act as when the sweep or a
// colleague's read brings their copies up to date.
export async function ownerPrincipal(c: Computer): Promise<Principal> {
  const { rows } = await asOrg(c.orgId, (q) =>
    q.query<{ personId: string }>(
      `select person_id as "personId" from users where id = $1`,
      [c.userId],
    ),
  );
  if (!rows[0]) throw new Error("the computer's owner is gone");
  return {
    orgId: c.orgId,
    userId: c.userId,
    personId: rows[0].personId,
    role: "member",
  };
}
