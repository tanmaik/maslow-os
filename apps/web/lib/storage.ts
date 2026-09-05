import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { deployment } from "./deployment.ts";
import { s3 } from "./s3.ts";

// Where uploaded images live. One contract; production uses an S3-compatible
// store, development uses a directory.
export type Storage = {
  put(bytes: Uint8Array, ext: string): Promise<string>;
  // Already gone is fine.
  delete(key: string): Promise<void>;
  url(key: string): string;
};

const MAX_BYTES = 2 * 1024 * 1024;

// Thrown for anything the person can fix by choosing a different file, or
// that this deployment cannot do at all. Every other failure is a real error.
export class Rejected extends Error {}

// The image type from its first bytes. The browser's declared type is never
// trusted, and SVG is never accepted: it is a script container.
export function sniff(bytes: Uint8Array): "png" | "jpg" | "webp" | null {
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

// Reads a small raster image out of a form, or throws Rejected saying why.
export async function imageOrThrow(
  file: FormDataEntryValue | null,
): Promise<{ bytes: Uint8Array; ext: "png" | "jpg" | "webp" }> {
  if (deployment.storage.kind === "none") {
    throw new Rejected("Images need object storage, which is not set up yet.");
  }
  if (!(file instanceof File) || file.size === 0)
    throw new Rejected("Choose an image file.");
  if (file.size > MAX_BYTES) throw new Rejected("Images are limited to 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = sniff(bytes);
  if (!ext) throw new Rejected("PNG, JPEG or WebP only.");
  return { bytes, ext };
}

// A key of its own for every object put, so deleting one never takes
// another owner's copy of the same bytes with it.
const key = (ext: string) => `${randomBytes(16).toString("hex")}.${ext}`;

// A directory under .local, served by /uploads/[key].
const local = (dir: string): Storage => ({
  async put(bytes, ext) {
    const k = key(ext);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, k), bytes);
    return k;
  },
  delete: (k) => fs.rm(path.join(dir, k), { force: true }),
  url: (k) => `/uploads/${k}`,
});

const none: Storage = {
  put: async () => {
    throw new Rejected("Images need object storage, which is not set up yet.");
  },
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
  async delete(k) {
    const r = await s3(cfg, "DELETE", cfg.prefix + k);
    if (!r.ok && r.status !== 404)
      throw new Error(
        `storage delete → ${r.status}: ${(await r.text()).slice(0, 200)}`,
      );
  },
  url: (k) => `/uploads/${k}`,
});

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
      return await fs.readFile(path.join(st.dir, k));
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
      throw new Rejected("Images are limited to 2 MB.");
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
