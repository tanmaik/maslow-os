import type { Principal } from "@placeholder/db/auth";
import { computersIn } from "@placeholder/db/computers";
import {
  beginFile,
  claimJoin,
  claimStale,
  fileOf,
  filesOf,
  forgetFile,
  forgetFileIn,
  readyFile,
  rejectFile,
  stagedFile,
  stagedIn,
  staleUploads,
  unclaimJoin,
  unclaimStale,
  uploadingFile,
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

import { growFor, growIn } from "./computer.ts";
import { deployment } from "./deployment.ts";
import { callIn, disk, DiskError } from "./disk.ts";
import { MAX_DISK_GB } from "./fly.ts";
import { presign, s3 } from "./s3.ts";

// A file goes from the browser to the store in parts, then from the store
// onto the person's disk, so it can be as large as the disk allows and
// never passes through us. The store is the bucket, or a directory on a
// real machine; the file is staged there only until it has landed.
export const PART_SIZE =
  Number(process.env.FILES_PART_SIZE) || 64 * 1024 * 1024;
export const MAX_FILE = MAX_DISK_GB * 1e9;

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
  let uploadId: string | null = null;
  if (deployment.storage.kind === "s3") {
    const r = await s3(
      deployment.storage,
      "POST",
      key,
      undefined,
      f.contentType,
      {
        uploads: "",
      },
    );
    if (!r.ok)
      throw new Error(`multipart begin → ${r.status}: ${await r.text()}`);
    uploadId =
      (await r.text()).match(/<UploadId>([^<]+)<\/UploadId>/)?.[1] ?? null;
    if (!uploadId) throw new Error("multipart begin: no upload id");
  }
  // What is declared counts against the cap at once.
  if (!(await beginFile(p, { id, key, uploadId, ...f }, MAX_FILE))) {
    if (deployment.storage.kind === "s3" && uploadId)
      await s3(deployment.storage, "DELETE", key, undefined, undefined, {
        uploadId,
      });
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
  const site = new URL(
    deployment.computers.kind === "fly" ? deployment.computers.report : "/",
  ).origin;
  return `${site}/files/local/${localToken(f.key, 0, Date.now() + 86400_000, `${p.orgId}|${p.userId}|${f.id}`)}`;
}

// Closes the upload with the parts the browser sent, checks the size the
// store confirms, then lands the file on the disk and lets the staged copy
// go. A file that will not land is refused, not kept.
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
      const xml = `<CompleteMultipartUpload>${parts
        .sort((a, b) => a.partNumber - b.partNumber)
        .map(
          (x) =>
            `<Part><PartNumber>${x.partNumber}</PartNumber><ETag>${x.etag}</ETag></Part>`,
        )
        .join("")}</CompleteMultipartUpload>`;
      const r = await s3(
        deployment.storage,
        "POST",
        f.key,
        new TextEncoder().encode(xml),
        "application/xml",
        { uploadId: f.uploadId! },
      );
      if (!r.ok)
        throw new Error(`multipart complete → ${r.status}: ${await r.text()}`);
      if (/<Error>/.test(await r.text()))
        throw new Error("multipart complete: the store answered with an error");
      const head = await s3(deployment.storage, "HEAD", f.key);
      const length = head.headers.get("content-length");
      if (!head.ok || length === null)
        throw new Error(
          `multipart complete: the object cannot be read back (${head.status})`,
        );
      size = Number(length);
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
  // Onto the disk; a disk that is full is grown one step and tried once
  // more.
  try {
    try {
      await disk.pull(
        p,
        joined(f.path, f.name),
        stagedUrl(p, { ...f, size }),
        size,
      );
    } catch (err) {
      if (!(err instanceof DiskError && err.status === 507)) throw err;
      if (!(await growFor(p))) throw err;
      await disk.pull(
        p,
        joined(f.path, f.name),
        stagedUrl(p, { ...f, size }),
        size,
      );
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
  await landed(p, f, staged);
  return { ...f, state: "ready", size };
}

// Once on the disk, the staged copy is let go of and then the row closed.
// A copy that will not go leaves the row open, so the sweep tries again;
// the file is on the disk already, and a second landing finds it there.
async function landed(
  p: Principal,
  f: { id: string },
  staged: { key: string; state: string; uploadId: string | null },
) {
  try {
    await dropBytes(staged);
  } catch (err) {
    console.error(`staged copy stays: ${(err as Error).message}`);
    return;
  }
  await forgetFile(p, f.id);
}

// Files the store holds whole that never reached a disk, landed by the
// sweep: a landing interrupted midway is not lost. The disk is grown for
// them as for any upload; a name taken by something else is stepped
// past, and one taken by this very file is a landing already done. Per
// org.
export async function landStaged(orgId: string, now: Date): Promise<void> {
  const stragglers = await stagedIn(orgId, new Date(now.getTime() - 120_000));
  if (stragglers.length === 0) return;
  const computers = new Map(
    (await computersIn(orgId)).map((c) => [c.userId, c]),
  );
  for (const f of stragglers) {
    const c = computers.get(f.userId);
    if (!c?.machineId) continue;
    const p = { orgId, userId: f.userId } as Principal;
    try {
      let name = f.name;
      for (let n = 2; n < 12; n++) {
        const there = await callIn<{ kind: string; size: number }>(
          orgId,
          c,
          "GET",
          `/fs/stat?path=${encodeURIComponent(joined(f.path, name))}`,
        ).catch((err) => {
          if (err instanceof DiskError && err.status === 404) return null;
          throw err;
        });
        if (!there) {
          const pull = () =>
            callIn(orgId, c, "POST", "/fs/pull", {
              path: joined(f.path, name),
              url: stagedUrl(p, f),
              size: f.size,
            });
          try {
            await pull();
          } catch (err) {
            if (!(err instanceof DiskError && err.status === 507)) throw err;
            if (!(await growIn(orgId, c))) throw err;
            await pull();
          }
          break;
        }
        if (there.kind === "file" && there.size === f.size) break;
        name = f.name.replace(/(\.[^.]*)?$/, ` (${n})$1`);
      }
    } catch (err) {
      console.error(`landing ${f.id}: ${(err as Error).message}`);
      continue;
    }
    try {
      await dropBytes({ key: f.key, state: "ready", uploadId: null });
    } catch (err) {
      // The row stays open, so the copy is tried again next sweep.
      console.error(`staged copy stays: ${(err as Error).message}`);
      continue;
    }
    await forgetFileIn(orgId, f.userId, f.id);
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
    const r =
      (f.state === "uploading" || f.state === "joining") && f.uploadId
        ? await s3(deployment.storage, "DELETE", f.key, undefined, undefined, {
            uploadId: f.uploadId,
          })
        : await s3(deployment.storage, "DELETE", f.key);
    if (!r.ok && r.status !== 404)
      throw new Error(
        `storage delete → ${r.status}: ${(await r.text()).slice(0, 200)}`,
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

// Abandons an upload not yet whole: the bytes go, the row stays marked for
// the meter. One already whole is on its way to the disk and is left to
// land.
export async function abandon(p: Principal, id: string): Promise<boolean> {
  const f = await fileOf(p, id);
  if (!f || f.state === "ready") return false;
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

export { filesOf };

// Whether an upload a local part token names still exists and is still
// uploading, so a token cannot bring back parts of a file that is gone.
export function stillUploading(claim: {
  orgId: string;
  userId: string;
  id: string;
}) {
  return uploadingFile(claim.orgId, claim.userId, claim.id);
}

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
