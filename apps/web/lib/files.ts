import type { Principal } from "@placeholder/db/auth";
import {
  computerOfIn,
  computersAllowedIn,
  computersIn,
  leaseIn,
  principalIn,
  release,
} from "@placeholder/db/computers";
import {
  beginFile,
  claimJoin,
  claimStale,
  fileOf,
  filesOf,
  forgetFile,
  forgetFileIn,
  landingFile,
  landingIn,
  lostFile,
  readyFile,
  rejectFile,
  stagedAgain,
  stagedFile,
  stagedIn,
  staleUploads,
  unclaimJoin,
  unclaimStale,
  whole,
  type StoredFile,
} from "@placeholder/db/files";
import {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";

import type { Machine } from "./backups.ts";
import { growFor, growHeld } from "./computer.ts";
import { deployment } from "./deployment.ts";
import { callIn, disk, DiskError, site, type Pull } from "./disk.ts";
import { MAX_DISK_GB } from "./fly.ts";
import {
  beginMultipart,
  completeMultipart,
  presign,
  remove,
  s3,
} from "./s3.ts";

// A file goes from the browser to the store in parts, then from the store
// onto the person's disk, so it can be as large as the disk allows and
// never passes through us. The store is the bucket, or a directory on a
// real machine; the file is staged there only until it has landed.
export const PART_SIZE =
  Number(process.env.FILES_PART_SIZE) || 64 * 1024 * 1024;
const MAX_FILE = MAX_DISK_GB * 1e9;

export class FileRejected extends Error {}

type Part = { partNumber: number; etag: string };

const objectKey = (p: Principal, id: string) =>
  `${deployment.storage.kind === "s3" ? deployment.storage.prefix : ""}orgs/${p.orgId}/members/${p.userId}/files/${id}`;

// Where local parts live, and the token that lets a browser write one or
// the machine read the whole.
const localDir = () =>
  deployment.storage.kind === "local"
    ? path.join(deployment.storage.dir, "..", "files")
    : null;
// Without a secret of the deployment's own, tokens are signed with one
// made for this process: good until it restarts, guessable by nobody.
const processSecret = randomBytes(32).toString("base64url");
const localSecret = () => process.env.FILES_LOCAL_SECRET ?? processSecret;
const sign = (s: string) =>
  createHmac("sha256", localSecret()).update(s).digest("base64url");
export function localToken(
  key: string,
  part: number,
  expires: number,
  file: string,
) {
  const claim = `${key}|${part}|${expires}|${file}`;
  return `${Buffer.from(claim).toString("base64url")}.${sign(claim)}`;
}
export function localClaim(token: string) {
  const [claim64, sig] = token.split(".");
  if (!claim64 || !sig) return null;
  const claim = Buffer.from(claim64, "base64url").toString();
  const expect = sign(claim);
  if (
    expect.length !== sig.length ||
    !timingSafeEqual(Buffer.from(expect), Buffer.from(sig))
  )
    return null;
  const [key, part, expires, orgId, userId, id] = claim.split("|");
  if (Number(expires) < Date.now()) return null;
  return {
    key: key!,
    part: Number(part),
    orgId: orgId!,
    userId: userId!,
    id: id!,
  };
}
export const localPartPath = (key: string, part: number) =>
  path.join(localDir()!, key.replaceAll("/", "_") + `.part${part}`);
export const localFilePath = (key: string) =>
  path.join(localDir()!, key.replaceAll("/", "_"));

export const joined = (folder: string, name: string) =>
  folder === "/" ? `/${name}` : `${folder}/${name}`;

// Opens an upload: a row, and for the bucket a multipart upload id. The
// folder must be on the disk, and the name free.
export async function begin(
  p: Principal,
  f: { name: string; size: number; contentType: string; path: string },
): Promise<{ id: string; partSize: number; parts: number }> {
  if (deployment.storage.kind === "none")
    throw new FileRejected("Files need object storage, which is not set up.");
  if (!(f.size >= 0) || f.size > MAX_FILE)
    throw new FileRejected("A file is limited to 500 GB.");
  if (cleanName(f.name) !== f.name)
    throw new FileRejected(
      f.name.length > 255
        ? "A name is at most 255 characters."
        : "That is not a name a file can have.",
    );
  const there = await disk.stat(p, f.path);
  if (there?.kind !== "folder")
    throw new FileRejected("That folder does not exist.");
  if (await disk.stat(p, joined(f.path, f.name)))
    throw new FileRejected(`Something named ${f.name} is already there.`);
  const id = randomUUID();
  const key = objectKey(p, id);
  const uploadId =
    deployment.storage.kind === "s3"
      ? await beginMultipart(deployment.storage, key, f.contentType)
      : null;
  // What is declared counts against the cap at once.
  if (!(await beginFile(p, { id, key, uploadId, ...f }, MAX_FILE))) {
    if (deployment.storage.kind === "s3" && uploadId)
      await remove(deployment.storage, key, uploadId);
    // What is declared counts against the cap; uploads still arriving are
    // named, since abandoning one is the way out.
    const { declared, files } = await filesOf(p);
    const arriving = files.filter((x) => x.state !== "ready").length;
    throw new FileRejected(
      arriving
        ? `Your disk would pass 500 GB: ${arriving} upload${arriving === 1 ? " is" : "s are"} still arriving (${(declared / 1e9).toFixed(1)} GB declared). Abandon one from its folder to make room.`
        : "Your disk is full at 500 GB.",
    );
  }
  return {
    id,
    partSize: PART_SIZE,
    parts: Math.max(1, Math.ceil(f.size / PART_SIZE)),
  };
}

// Where the browser sends one part. Bucket: a presigned PUT. Local: our own
// PUT route with a signed token.
export async function partUrl(
  p: Principal,
  id: string,
  partNumber: number,
): Promise<string | null> {
  const f = await fileOf(p, id);
  // Only the parts the declared size calls for.
  if (
    !f ||
    f.state !== "uploading" ||
    partNumber > Math.max(1, Math.ceil(f.size / PART_SIZE))
  )
    return null;
  if (deployment.storage.kind === "s3")
    return presign(deployment.storage, "PUT", f.key, {
      partNumber: String(partNumber),
      uploadId: f.uploadId!,
    });
  return `/files/local/${localToken(f.key, partNumber, Date.now() + 3600_000, `${p.orgId}|${p.userId}|${f.id}`)}`;
}

// Where the machine fetches the staged whole from: a presigned GET, or our
// own route with a token good for a day.
function stagedUrl(p: Principal, f: StoredFile): string {
  if (deployment.storage.kind === "s3")
    return presign(deployment.storage, "GET", f.key, {}, 86400);
  return `${site()}/files/local/${localToken(f.key, 0, Date.now() + 86400_000, `${p.orgId}|${p.userId}|${f.id}`)}`;
}

// Closes the upload with the parts the browser sent, checks the size the
// store confirms, then has the machine land the file on the disk; it
// carries on alone and says when the file is there, and the staged copy
// goes then. A file that cannot land is refused, not kept.
export async function complete(
  p: Principal,
  id: string,
  parts: Part[],
): Promise<StoredFile | null> {
  const f = await fileOf(p, id);
  if (!f || f.state !== "uploading") return null;
  // Parts numbered 1 to n, each once; what they add up to is checked
  // against the declared size below.
  const n = parts.length;
  const numbers = new Set(parts.map((x) => x.partNumber));
  if (
    n < 1 ||
    n > 10000 ||
    numbers.size !== n ||
    [...numbers].some((x) => !(x >= 1 && x <= n))
  )
    throw new FileRejected("Parts must be numbered 1 to n, each once.");
  if (!(await claimJoin(p, id))) return null;
  let size: number;
  try {
    if (deployment.storage.kind === "s3") {
      size = await completeMultipart(
        deployment.storage,
        f.key,
        f.uploadId!,
        parts,
      );
    } else {
      const tmp = `${localFilePath(f.key)}.joining`;
      const out = await fs.open(tmp, "w");
      try {
        size = 0;
        for (const x of parts.sort((a, b) => a.partNumber - b.partNumber)) {
          const bytes = await fs.readFile(localPartPath(f.key, x.partNumber));
          await out.write(bytes);
          size += bytes.length;
        }
      } catch (err) {
        await out.close();
        await fs.rm(tmp, { force: true });
        throw err;
      }
      await out.close();
      await fs.rename(tmp, localFilePath(f.key));
      for (const x of parts)
        await fs.rm(localPartPath(f.key, x.partNumber), { force: true });
    }
  } catch (err) {
    await unclaimJoin(p, id);
    throw err;
  }
  // What arrived must be what was declared, or the quota means nothing; and
  // a row deleted while joining does not come back to life.
  const staged = { key: f.key, state: "ready", uploadId: null };
  if (size !== f.size || !(await readyFile(p, id, size))) {
    // The bytes go before the row hides, so a refusal leaves it findable.
    await dropBytes(staged);
    await rejectFile(p, id);
    if (size !== f.size)
      throw new FileRejected(
        `${size} bytes arrived for a file declared as ${f.size}.`,
      );
    return null;
  }
  // Onto the disk; a disk that is full is grown one step and asked once
  // more.
  await landingFile(p.orgId, p.userId, id);
  const pull: Pull = {
    id,
    path: joined(f.path, f.name),
    url: stagedUrl(p, { ...f, size }),
    size,
  };
  try {
    try {
      await disk.pull(p, pull);
    } catch (err) {
      if (!(err instanceof DiskError && err.status === 507)) throw err;
      if (!(await growFor(p, size))) throw err;
      await disk.pull(p, pull);
    }
  } catch (err) {
    await dropBytes(staged);
    await rejectFile(p, id);
    if (err instanceof DiskError)
      throw new FileRejected(
        `${f.name} could not land on your disk: ${err.message}`,
      );
    throw err;
  }
  return { ...f, state: "landing", size };
}

// How a landing went, from the machine that did it. On the disk: the
// staged copy goes and the row closes; a copy that will not go leaves the
// row open, so the sweep tries again and finds the file there. Not on the
// disk: the file is staged again, for the sweep.
// True once the row is closed.
export async function landedOn(
  m: Machine,
  id: string,
  outcome: { ok: boolean; error?: string },
): Promise<boolean> {
  const f = await landingIn(m.orgId, m.userId, id);
  if (!f) return false;
  if (!outcome.ok) {
    console.error(`landing ${id}: ${outcome.error}`);
    // A source that answered 404 is asked about once more, here: bytes the
    // store no longer has are lost, and nothing is tried again. A store
    // that cannot say leaves the file staged, for the sweep.
    let gone = false;
    if (/answered 404$/.test(outcome.error ?? ""))
      gone = await stored(f.key).then(
        (there) => !there,
        (err) => {
          console.error(`landing ${id}: ${(err as Error).message}`);
          return false;
        },
      );
    if (gone)
      await lostFile(m.orgId, m.userId, id, "the store no longer has it");
    else await stagedAgain(m.orgId, m.userId, id, outcome.error ?? "no reason");
    return false;
  }
  try {
    await dropBytes({ key: f.key, state: "ready", uploadId: null });
  } catch (err) {
    console.error(`staged copy stays: ${(err as Error).message}`);
    return false;
  }
  await forgetFileIn(m.orgId, m.userId, id);
  return true;
}

// Files the store holds whole that are not yet off it, seen to by the
// sweep: a landing interrupted midway, or whose word never reached us,
// is not lost. The machine is asked whether it landed the file, by id —
// nothing on the disk is taken for it by name — and if so the file is
// closed here and the machine told; if not it is asked for again, the
// disk grown for it as for any upload, and a name taken by something
// else stepped past. Per org.
export async function landStaged(orgId: string, now: Date): Promise<void> {
  const stragglers = await stagedIn(orgId, new Date(now.getTime() - 120_000));
  if (stragglers.length === 0) return;
  if (!(await computersAllowedIn(orgId))) return;
  const computers = new Map(
    (await computersIn(orgId)).map((c) => [c.userId, c]),
  );
  for (const f of stragglers) {
    const known = computers.get(f.userId);
    if (!known) continue;
    // Reaching a machine starts it, so nothing is reached that should not
    // be running: not an org whose computers are off, not a computer its
    // person powered off, not a membership that has ended. Each is read on
    // the row as it is under the lease, so a change committing while the
    // sweep walks is never overtaken. Busy is the next sweep's business.
    const held = await leaseIn(orgId, known.id);
    if (!held) continue;
    const p = { orgId, userId: f.userId } as Principal;
    try {
      const c = await computerOfIn(orgId, known.id);
      if (!c?.machineId || c.offAt) continue;
      if (!(await computersAllowedIn(orgId))) continue;
      if (!(await principalIn(orgId, c.userId))) continue;
      const { landed } = await callIn<{ landed: boolean }>(
        orgId,
        c,
        "GET",
        `/fs/landed?id=${f.id}`,
      );
      if (landed) {
        // The machine's record of it goes only once the row is closed.
        await landingFile(orgId, f.userId, f.id);
        if (await landedOn({ ...c, orgId }, f.id, { ok: true }))
          await callIn(orgId, c, "DELETE", `/fs/landed?id=${f.id}`);
        continue;
      }
      let name = f.name;
      for (let n = 2; n < 12; n++) {
        const taken = await callIn(
          orgId,
          c,
          "GET",
          `/fs/stat?path=${encodeURIComponent(joined(f.path, name))}`,
        ).then(
          () => true,
          (err) => {
            if (err instanceof DiskError && err.status === 404) return false;
            throw err;
          },
        );
        if (taken) {
          name = f.name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
          continue;
        }
        await landingFile(orgId, f.userId, f.id);
        const pull = () =>
          callIn(orgId, c, "POST", "/fs/pull", {
            id: f.id,
            path: joined(f.path, name),
            url: stagedUrl(p, f),
            size: f.size,
          } satisfies Pull);
        try {
          await pull();
        } catch (err) {
          if (!(err instanceof DiskError && err.status === 507)) throw err;
          if (!c.volumeId) throw err;
          if (!(await growHeld(orgId, c.id, f.size))) throw err;
          await pull();
        }
        break;
      }
    } catch (err) {
      console.error(`landing ${f.id}: ${(err as Error).message}`);
    } finally {
      await release(orgId, known.id, held);
    }
  }
}

// The staged whole, streamed, for the machine fetching it from the local
// store; a file can be far larger than memory.
export async function localStagedStream(claim: {
  orgId: string;
  userId: string;
  id: string;
}) {
  const f = await stagedFile(claim.orgId, claim.userId, claim.id);
  if (!f) return null;
  // Opened before answering, so a file gone meanwhile is a 404 and not a
  // download that breaks off.
  let handle;
  try {
    handle = await fs.open(localFilePath(f.key), "r");
  } catch {
    return null;
  }
  const { size } = await handle.stat();
  return {
    size,
    body: Readable.toWeb(
      handle.createReadStream(),
    ) as ReadableStream<Uint8Array>,
  };
}

// Lets go of a file's bytes in the store: the object, or the upload in
// progress. Already gone is fine; any other refusal is an error, so a row
// is never marked gone while its bytes remain.
export async function dropBytes(f: {
  key: string;
  state: string;
  uploadId: string | null;
}): Promise<void> {
  if (deployment.storage.kind === "s3") {
    await remove(
      deployment.storage,
      f.key,
      f.state === "uploading" || f.state === "joining" ? f.uploadId : null,
    );
  } else if (deployment.storage.kind === "local") {
    await fs.rm(localFilePath(f.key), { force: true });
    const dir = localDir()!;
    const stem = path.basename(localFilePath(f.key));
    for (const name of await fs.readdir(dir).catch(() => [] as string[]))
      if (name.startsWith(`${stem}.part`))
        await fs.rm(path.join(dir, name), { force: true });
  }
}

// Whether the store still holds the bytes behind a key.
// Only the store saying "not found" is an absence; any other trouble is
// thrown, so nothing is given up on while the store is merely unwell.
async function stored(key: string): Promise<boolean> {
  const st = deployment.storage;
  if (st.kind === "s3") {
    const res = await s3(st, "HEAD", key);
    if (res.ok) return true;
    if (res.status === 404) return false;
    throw new Error(`storage head → ${res.status}`);
  }
  if (st.kind === "local")
    return fs.stat(localFilePath(key)).then(
      () => true,
      (err) => {
        if ((err as { code?: string }).code === "ENOENT") return false;
        throw err;
      },
    );
  return false;
}

// Abandons an upload not yet whole, or one the store lost: the bytes go,
// the row stays marked for the meter. One whole and on its way to the
// disk is left to land.
export async function abandon(p: Principal, id: string): Promise<boolean> {
  const f = await fileOf(p, id);
  if (!f || whole(f)) return false;
  await dropBytes(f);
  await forgetFile(p, id);
  return true;
}

// Uploads nobody finished within two hours are let go of, per org, by the
// sweep: their parts cost until then, and their declared size holds room.
export async function expireUploads(orgId: string, now: Date): Promise<void> {
  const stale = await staleUploads(
    orgId,
    new Date(now.getTime() - 2 * 3600_000),
  );
  for (const f of stale)
    if (await claimStale(orgId, f.userId, f.id)) {
      try {
        await dropBytes(f);
      } catch (err) {
        // The bytes are still there, so the row is too: next sweep.
        await unclaimStale(orgId, f.userId, f.id);
        throw err;
      }
    }
}

export { filesOf, whole };

// A path as the disk spells it: "/" or "/a/b", no empty or dotted
// segments, nothing a shell would mind. Null when it is not one.
export function cleanPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split("/").filter((x) => x !== "");
  if (
    parts.some(
      (x) => x === "." || x === ".." || /[\x00-\x1f]/.test(x) || x.length > 255,
    )
  )
    return null;
  if (parts.length > 32) return null;
  return parts.length ? `/${parts.join("/")}` : "/";
}

// A file or folder name: no slashes, nothing hidden, not too long.
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (
    !name ||
    name.length > 255 ||
    name.startsWith(".") ||
    /[\/\x00-\x1f]/.test(name)
  )
    return null;
  return name;
}

export const parentOf = (path: string) =>
  path === "/" ? "/" : path.slice(0, path.lastIndexOf("/")) || "/";
