// The computer's daemon: the volume at DATA_DIR served as a filesystem.
// We list, make, move and delete under it with the machine's secret, put
// files on it from a URL, and hand a browser a signed download. Fly sets
// FLY_MACHINE_ID and routes to us; a download that reached the wrong
// machine is replayed to the right one. It also reports on itself to us
// on boot and every five minutes: how full the disk is.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const { COMPUTER_SECRET, REPORT_URL, FLY_MACHINE_ID, REPORT_BYPASS } =
  process.env;
if (!COMPUTER_SECRET || !REPORT_URL || !FLY_MACHINE_ID) {
  console.error(
    "A computer needs COMPUTER_SECRET, REPORT_URL and FLY_MACHINE_ID.",
  );
  process.exit(1);
}
const ROOT = path.resolve(process.env.DATA_DIR ?? "/data");
const PORT = Number(process.env.PORT) || 8080;

async function disk() {
  const s = await fs.statfs(ROOT).catch(() => null);
  return s
    ? { used: (s.blocks - s.bfree) * s.bsize, total: s.blocks * s.bsize }
    : { used: 0, total: 0 };
}

async function report() {
  try {
    const res = await fetch(REPORT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${COMPUTER_SECRET}`,
        "fly-machine-id": FLY_MACHINE_ID,
        "content-type": "application/json",
        // A preview sits behind Vercel's protection; this lets a report in.
        ...(REPORT_BYPASS
          ? { "x-vercel-protection-bypass": REPORT_BYPASS }
          : {}),
      },
      body: JSON.stringify({ disk: await disk() }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) console.error(`report answered ${res.status}`);
  } catch (err) {
    console.error(`report failed: ${err.message}`);
  }
}

class Refused extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// A path under the root, or a refusal: nothing escapes the volume, and
// nothing hidden or unspeakable is made on it.
function under(raw) {
  if (typeof raw !== "string") throw new Refused(400, "no path");
  const parts = raw.split("/").filter((x) => x !== "");
  if (
    parts.length > 32 ||
    parts.some(
      (x) => x === "." || x === ".." || /[\x00-\x1f]/.test(x) || x.length > 255,
    )
  )
    throw new Refused(400, "not a path");
  const abs = path.resolve(ROOT, ...parts);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep))
    throw new Refused(400, "not a path");
  return abs;
}

const same = (a, b) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const sign = (s) =>
  createHmac("sha256", COMPUTER_SECRET).update(s).digest("base64url");

// A download's filename, any script, as RFC 6266 spells it.
const disposition = (name) =>
  `attachment; filename="${name.replace(/[^\x20-\x7e]|["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1e6) throw new Refused(413, "too large");
    chunks.push(chunk);
  }
  return size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

// Changes to the tree happen one at a time, so two moves or a move and a
// delete cannot pass each other's checks.
let turn = Promise.resolve();
function exclusive(fn) {
  const mine = turn.then(fn, fn);
  turn = mine.catch(() => {});
  return mine;
}

async function list(dir) {
  // A folder deleted between the look and the listing is an empty one.
  const names = await fs.readdir(dir, { withFileTypes: true }).catch((err) => {
    if (err.code === "ENOENT") return [];
    throw err;
  });
  const entries = [];
  for (const d of names) {
    if (d.name.startsWith(".") || d.name === "lost+found") continue;
    const s = await fs.stat(path.join(dir, d.name)).catch(() => null);
    if (!s) continue;
    entries.push({
      name: d.name,
      kind: s.isDirectory() ? "folder" : "file",
      size: s.isDirectory() ? 0 : s.size,
      modified: s.mtime.toISOString(),
    });
  }
  entries.sort(
    (a, b) =>
      (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1) ||
      a.name.localeCompare(b.name),
  );
  return entries;
}

// Fetches a URL onto the disk, whole or not at all: a temporary name in
// the same folder, checked against the size promised, then renamed into
// place.
async function pull(target, url, size) {
  if (await fs.stat(target).catch(() => null)) throw new Refused(409, "exists");
  const tmp = `${target}.${randomBytes(6).toString("hex")}.landing`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6 * 3600_000) });
  if (!res.ok || !res.body)
    throw new Refused(502, `the source answered ${res.status}`);
  let got = 0;
  try {
    await pipeline(
      Readable.fromWeb(res.body),
      async function* (source) {
        for await (const chunk of source) {
          got += chunk.length;
          if (got > size) throw new Refused(400, "more than promised");
          yield chunk;
        }
      },
      createWriteStream(tmp),
    );
    if (got !== size) throw new Refused(400, `${got} of ${size} bytes`);
    // Into place only if nothing took the name meanwhile: a link refuses
    // to replace, where a rename would.
    try {
      await fs.link(tmp, target);
    } catch (err) {
      if (err.code === "EEXIST") throw new Refused(409, "exists");
      throw err;
    }
    await fs.rm(tmp, { force: true });
  } catch (err) {
    await fs.rm(tmp, { force: true });
    if (err.code === "ENOSPC") throw new Refused(507, "the disk is full");
    throw err;
  }
}

async function handle(req, res) {
  const url = new URL(req.url, "http://computer");
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/health") return json(200, { ok: true });

  // A browser's download: the link names the machine, and one that landed
  // elsewhere is replayed to it. Only the right machine can check the
  // signature, since only it holds the secret.
  const dl = url.pathname.match(/^\/dl\/([^/]+)\/(\d+)\/([^/]+)$/);
  if (dl) {
    const [, machine, expires, sig] = dl;
    if (machine !== FLY_MACHINE_ID) {
      res.writeHead(200, { "fly-replay": `instance=${machine}` });
      return res.end();
    }
    const rel = url.searchParams.get("path") ?? "";
    if (Number(expires) < Date.now() || !same(sign(`${expires}|${rel}`), sig))
      return json(403, { error: "no" });
    const abs = under(rel);
    const s = await fs.stat(abs).catch(() => null);
    if (!s?.isFile()) return json(404, { error: "no such file" });
    const fh = await fs.open(abs, "r");
    res.writeHead(200, {
      "content-type": "application/octet-stream",
      "content-length": s.size,
      "content-disposition": disposition(path.basename(abs)),
      "x-content-type-options": "nosniff",
    });
    return pipeline(fh.createReadStream(), res).catch(() => {});
  }

  if (req.headers.authorization !== `Bearer ${COMPUTER_SECRET}`)
    return json(401, { error: "no" });

  if (url.pathname === "/fs" && req.method === "GET") {
    const abs = under(url.searchParams.get("path"));
    const s = await fs.stat(abs).catch(() => null);
    if (!s?.isDirectory()) return json(404, { error: "no such folder" });
    return json(200, { entries: await list(abs), disk: await disk() });
  }
  if (url.pathname === "/fs/tree" && req.method === "GET") {
    // Folders only, a few levels down, bounded: the sidebar of the disk.
    let left = 2000;
    const walk = async (dir, rel, depth) => {
      const node = { name: path.basename(dir) || "", path: rel, folders: [] };
      if (depth === 0 || left <= 0) return node;
      for (const e of await list(dir))
        if (e.kind === "folder" && left-- > 0)
          node.folders.push(
            await walk(
              path.join(dir, e.name),
              `${rel === "/" ? "" : rel}/${e.name}`,
              depth - 1,
            ),
          );
      return node;
    };
    return json(200, { tree: await walk(ROOT, "/", 4) });
  }
  if (url.pathname === "/fs/stat" && req.method === "GET") {
    const abs = under(url.searchParams.get("path"));
    const s = await fs.stat(abs).catch(() => null);
    if (!s) return json(404, { error: "nothing there" });
    return json(200, {
      kind: s.isDirectory() ? "folder" : "file",
      size: s.size,
    });
  }
  if (url.pathname === "/fs/folder" && req.method === "POST") {
    const abs = under((await readJson(req)).path);
    return exclusive(async () => {
      const s = await fs.stat(abs).catch(() => null);
      if (s && !s.isDirectory()) return json(409, { error: "a file is there" });
      await fs.mkdir(abs, { recursive: true });
      return json(200, { ok: true });
    });
  }
  if (url.pathname === "/fs/move" && req.method === "POST") {
    const b = await readJson(req);
    const from = under(b.from);
    const to = under(b.to);
    if (from === ROOT || to === ROOT || to.startsWith(from + path.sep))
      return json(400, { error: "not there" });
    return exclusive(async () => {
      if (!(await fs.stat(from).catch(() => null)))
        return json(404, { error: "nothing there" });
      if (await fs.stat(to).catch(() => null))
        return json(409, { error: "something is there already" });
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      return json(200, { ok: true });
    });
  }
  if (url.pathname === "/fs" && req.method === "DELETE") {
    const abs = under(url.searchParams.get("path"));
    if (abs === ROOT) return json(400, { error: "not the root" });
    return exclusive(async () => {
      if (!(await fs.stat(abs).catch(() => null)))
        return json(404, { error: "nothing there" });
      await fs.rm(abs, { recursive: true, force: true });
      return json(200, { ok: true });
    });
  }
  if (url.pathname === "/fs/pull" && req.method === "POST") {
    const b = await readJson(req);
    const abs = under(b.path);
    if (typeof b.url !== "string" || !(b.size >= 0))
      return json(400, { error: "a url and a size" });
    if (!(await fs.stat(path.dirname(abs)).catch(() => null))?.isDirectory())
      return json(404, { error: "no such folder" });
    await pull(abs, b.url, b.size);
    return json(200, { ok: true, disk: await disk() });
  }
  json(404, { error: "no such route" });
}

const server = createServer((req, res) =>
  handle(req, res).catch((err) => {
    const status = err instanceof Refused ? err.status : 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    } else res.destroy();
  }),
);
await fs.mkdir(ROOT, { recursive: true });
server.listen(PORT, "0.0.0.0", () =>
  console.log(`serving ${ROOT} on ${PORT} as ${FLY_MACHINE_ID}`),
);
await report();
setInterval(report, 5 * 60 * 1000).unref();
