import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { deployment } from "./deployment.ts";
import { presign, remove, s3 } from "./s3.ts";

// Where uploaded images live. One contract; production uses an S3-compatible
// store, development uses a directory.
export type Storage = {
  put(bytes: Uint8Array, ext: string): Promise<string>;
  // Where the browser puts one object itself, for a picture too big to
  // pass through a function: the key it will land on, and an address good
  // for exactly those bytes and a few minutes. Null where the store signs
  // nothing and the bytes must come through us.
  putUrl(ext: string, bytes: number): { key: string; url: string } | null;
  // Already gone is fine.
  delete(key: string): Promise<void>;
  url(key: string): string;
};

// How long an address the browser puts to is good for.
export const PUT_FOR = 300;

const MAX_BYTES = 2 * 1024 * 1024;

// A size in whole megabytes, for what a person is told.
const mb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

// Thrown for anything the person can fix by choosing a different file, or
// that this deployment cannot do at all. Every other failure is a real error.
export class Rejected extends Error {}

// The image type from its first bytes. The browser's declared type is never
// trusted, and SVG is never accepted: it is a script container.
function sniff(bytes: Uint8Array): "png" | "jpg" | "webp" | null {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "webp";
  return null;
}

type Picture = { bytes: Uint8Array; ext: "png" | "jpg" | "webp" };

// The raster image these bytes are, or Rejected saying why they are not
// one. A picture the browser shrinks is held to two megabytes; a
// wallpaper, kept at the resolution it was made at, says its own limit.
export function pictureOrThrow(bytes: Uint8Array, limit = MAX_BYTES): Picture {
  if (bytes.length > limit)
    throw new Rejected(`Images are limited to ${mb(limit)}.`);
  const ext = sniff(bytes);
  if (!ext) throw new Rejected("PNG, JPEG or WebP only.");
  return { bytes, ext };
}

// The same, read out of a form.
export async function imageOrThrow(
  file: FormDataEntryValue | null,
  limit = MAX_BYTES,
): Promise<Picture> {
  if (deployment.storage.kind === "none") {
    throw new Rejected("Images need object storage, which is not set up yet.");
  }
  if (!(file instanceof File) || file.size === 0)
    throw new Rejected("Choose an image file.");
  if (file.size > limit)
    throw new Rejected(`Images are limited to ${mb(limit)}.`);
  return pictureOrThrow(new Uint8Array(await file.arrayBuffer()), limit);
}

// A key of its own for every object put, so deleting one never takes
// another owner's copy of the same bytes with it.
const key = (ext: string) => `${randomBytes(16).toString("hex")}.${ext}`;

// A directory under .local, served by /uploads/[key].
const local = (dir: string): Storage => ({
  async put(bytes, ext) {
    const k = key(ext);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(/*turbopackIgnore: true*/ dir, k), bytes);
    return k;
  },
  // A directory signs nothing, so a picture kept here comes through us.
  putUrl: () => null,
  delete: (k) =>
    fs.rm(path.join(/*turbopackIgnore: true*/ dir, k), { force: true }),
  url: (k) => `/uploads/${k}`,
});

const none: Storage = {
  put: async () => {
    throw new Rejected("Images need object storage, which is not set up yet.");
  },
  putUrl: () => null,
  delete: async () => {},
  url: (k) => `/uploads/${k}`,
};

// Objects are private in the bucket; /uploads/[key] fetches them signed and
// serves them with our headers, the same way local storage does.
const bucket = (
  cfg: Extract<typeof deployment.storage, { kind: "s3" }>,
): Storage => ({
  async put(bytes, ext) {
    const k = key(ext);
    const r = await s3(
      cfg,
      "PUT",
      cfg.prefix + k,
      bytes,
      `image/${ext === "jpg" ? "jpeg" : ext}`,
    );
    if (!r.ok)
      throw new Error(
        `storage put → ${r.status}: ${(await r.text()).slice(0, 200)}`,
      );
    return k;
  },
  putUrl: (ext, bytes) => {
    const k = key(ext);
    return { key: k, url: presign(cfg, "PUT", cfg.prefix + k, PUT_FOR, bytes) };
  },
  delete: (k) => remove(cfg, cfg.prefix + k),
  url: (k) => `/uploads/${k}`,
});

// Where a bucket signs addresses for the browser and the machines: one
// object read or written straight from either, for so many seconds, and
// for exactly so many bytes when a size is given. Null where there is no
// bucket, and what would go through an address comes through us or not at
// all.
export function signed(
  method: "PUT" | "GET",
  key: string,
  seconds: number,
  bytes?: number,
  contentType?: string,
): string | null {
  const st = deployment.storage;
  if (st.kind !== "s3") return null;
  return presign(st, method, st.prefix + key, seconds, bytes, contentType);
}

// Whether anything is ever kept in a bucket here.
export const bucketed = () => deployment.storage.kind === "s3";

// Bytes put into the bucket under a key by us, for what is small enough to
// pass through: a text file a colleague saved.
export async function putBytes(
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  const st = deployment.storage;
  if (st.kind !== "s3") throw new Error("There is no bucket here.");
  const r = await s3(st, "PUT", st.prefix + key, bytes, contentType);
  if (!r.ok)
    throw new Error(
      `storage put → ${r.status}: ${(await r.text()).slice(0, 200)}`,
    );
}

// How many bytes an object in the bucket holds, or null when there is no
// such object.
export async function bytesOf(key: string): Promise<number | null> {
  const st = deployment.storage;
  if (st.kind !== "s3") return null;
  const r = await s3(st, "HEAD", st.prefix + key);
  if (!r.ok) return null;
  return Number(r.headers.get("content-length") ?? 0);
}

// Forgets a key's object, wherever it is kept; already gone is fine.
export async function deleteKey(key: string): Promise<void> {
  const st = deployment.storage;
  if (st.kind === "s3") return remove(st, st.prefix + key);
  if (st.kind === "local")
    await fs.rm(path.join(/*turbopackIgnore: true*/ st.dir, key), {
      force: true,
    });
}

export const storage: Storage =
  deployment.storage.kind === "s3"
    ? bucket(deployment.storage)
    : deployment.storage.kind === "local"
      ? local(deployment.storage.dir)
      : none;

// The bytes behind a key, or null when there are none.
export async function read(k: string): Promise<Uint8Array | null> {
  const st = deployment.storage;
  if (st.kind === "s3") {
    const r = await s3(st, "GET", st.prefix + k);
    return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
  }
  if (st.kind === "local") {
    try {
      return await fs.readFile(path.join(/*turbopackIgnore: true*/ st.dir, k));
    } catch {
      return null;
    }
  }
  return null;
}

// Reads a request body into memory, refusing once it passes the limit, so a
// client cannot lie about its length or omit it.
export async function bounded(
  request: Request,
  limit: number,
): Promise<Request> {
  const reader = request.body?.getReader();
  if (!reader) return request;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel();
      throw new Rejected(`That is larger than ${mb(limit)}.`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) body.set(c, (at += c.length) - c.length);
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body,
  });
}
