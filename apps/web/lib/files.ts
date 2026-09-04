import type { Principal } from "@placeholder/db/auth";
import {
  beginFile,
  claimJoin,
  createFolder,
  deleteFolder,
  filesUnder,
  folderExists,
  forgetFileUnder,
  listing,
  moveFile,
  moveFolder,
  renameFile,
  claimStale,
  fileOf,
  filesOf,
  forgetFile,
  readyFile,
  rejectFile,
  staleUploads,
  unclaimJoin,
  unclaimStale,
  unforgetFile,
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

import { growFor } from "./computer.ts";
import { MAX_DISK_GB } from "./fly.ts";
import { deployment } from "./deployment.ts";
import { presign, s3 } from "./s3.ts";

// Files go from the browser straight to the store in parts, so a file can
// be as large as the filesystem allows and never passes through us. The
// store is the bucket, or a directory on a real machine.
export const PART_SIZE =
  Number(process.env.FILES_PART_SIZE) || 64 * 1024 * 1024;
export const MAX_FILE = MAX_DISK_GB * 1e9;

export class FileRejected extends Error {}

// A download's filename, any script, as RFC 6266 spells it.
export const disposition = (name: string) =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

type Part = { partNumber: number; etag: string };

const objectKey = (p: Principal, id: string) =>
  `${deployment.storage.kind === "s3" ? deployment.storage.prefix : ""}orgs/${p.orgId}/members/${p.userId}/files/${id}`;

// Where local parts live, and the token that lets a browser write one.
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

// Opens an upload: a row, and for the bucket a multipart upload id.
export async function begin(
  p: Principal,
  f: { name: string; size: number; contentType: string; path: string },
): Promise<{ id: string; partSize: number; parts: number }> {
  if (deployment.storage.kind === "none")
    throw new FileRejected("Files need object storage, which is not set up.");
  if (!(f.size >= 0) || f.size > MAX_FILE)
    throw new FileRejected("A file is limited to 500 GB.");
  // What is declared counts against the cap at once; the filesystem grows
  // only for bytes that have arrived.
  if (!(await folderExists(p, f.path)))
    throw new FileRejected("That folder does not exist.");
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
  if (!(await beginFile(p, { id, key, uploadId, ...f }, MAX_FILE))) {
    if (deployment.storage.kind === "s3" && uploadId)
      await s3(deployment.storage, "DELETE", key, undefined, undefined, {
        uploadId,
      });
    throw new FileRejected("Your filesystem is full at 500 GB.");
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

// Closes the upload with the parts the browser sent, and records the size
// the store confirms.
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
  if (size !== f.size || !(await readyFile(p, id, size))) {
    // The bytes go before the row hides, so a refusal leaves it findable.
    await dropBytes({ key: f.key, state: "ready", uploadId: null });
    await rejectFile(p, id);
    if (size !== f.size)
      throw new FileRejected(
        `${size} bytes arrived for a file declared as ${f.size}.`,
      );
    return null;
  }
  await growFor(p, (await filesOf(p)).bytes);
  return { ...f, state: "ready", size };
}

// Where the browser fetches the file: a presigned GET for the bucket, our
// own route locally.
export async function downloadUrl(
  p: Principal,
  id: string,
): Promise<string | null> {
  const f = await fileOf(p, id);
  if (!f || f.state !== "ready") return null;
  if (deployment.storage.kind === "s3")
    return presign(deployment.storage, "GET", f.key, {
      "response-content-disposition": disposition(f.name),
    });
  return null;
}

// The file itself, streamed, for the local store; a file can be far larger
// than memory.
export async function localStream(p: Principal, id: string) {
  const f = await fileOf(p, id);
  if (!f || f.state !== "ready") return null;
  // Opened before answering, so a file deleted meanwhile is a 404 and not
  // a download that breaks off.
  let handle;
  try {
    handle = await fs.open(localFilePath(f.key), "r");
  } catch {
    return null;
  }
  return {
    file: f,
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

// Deletes the bytes; the row stays, marked, for the meter.
export async function remove(p: Principal, id: string): Promise<boolean> {
  const f = await fileOf(p, id);
  if (!f) return false;
  await dropBytes(f);
  await forgetFile(p, id);
  return true;
}

// Uploads nobody finished within a day are let go of, per org, by the
// sweep: their parts cost until then.
export async function expireUploads(orgId: string, now: Date): Promise<void> {
  const stale = await staleUploads(
    orgId,
    new Date(now.getTime() - 24 * 3600_000),
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

// A path as the filesystem spells it: "/" or "/a/b", no empty or dotted
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
    /[\/\x00-\x1f]/.test(name) ||
    name === "." ||
    name === ".."
  )
    return null;
  return name;
}

export const parentOf = (path: string) =>
  path === "/" ? "/" : path.slice(0, path.lastIndexOf("/")) || "/";

export async function newFolder(p: Principal, path: string): Promise<void> {
  await createFolder(p, path);
}

// A folder goes with everything in it: each file's bytes, then the rows.
export async function removeFolder(
  p: Principal,
  path: string,
): Promise<boolean> {
  // Each file is marked gone only if it is still under the folder, so one
  // moved out meanwhile survives; then its bytes go, or the mark comes back.
  for (const f of await filesUnder(p, path)) {
    if (!(await forgetFileUnder(p, f.id, path))) continue;
    try {
      await dropBytes(f);
    } catch (err) {
      await unforgetFile(p, f.id);
      throw err;
    }
  }
  return deleteFolder(p, path);
}

export { folderExists, listing, moveFile, moveFolder, renameFile };
