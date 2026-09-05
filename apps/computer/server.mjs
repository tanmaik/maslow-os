// The computer's daemon: the volume at DATA_DIR served as a filesystem,
// a shell on it over a WebSocket, and the ports on the machine reachable
// from a browser. We list, make, move and delete under it with the
// machine's secret, put files on it from a URL, and hand a browser a
// signed download, terminal or preview. Fly sets FLY_MACHINE_ID and
// routes to us; a request that reached the wrong machine is replayed to
// the right one. It also reports on itself to us on boot and every five
// minutes: how full the disk is, and what it has and needs.
import { execFile, spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { WebSocketServer } from "ws";

// COMPUTER_SECRET is this machine's own, for the app's calls; LINK_SECRET
// is the deployment's, so any machine can tell a real link from a forged
// one before it wakes the machine the link names.
const { COMPUTER_SECRET, LINK_SECRET, REPORT_URL, FLY_MACHINE_ID } =
  process.env;
if (!COMPUTER_SECRET || !LINK_SECRET || !REPORT_URL || !FLY_MACHINE_ID) {
  console.error(
    "A computer needs COMPUTER_SECRET, LINK_SECRET, REPORT_URL and FLY_MACHINE_ID.",
  );
  process.exit(1);
}
// On a machine the volume holds the whole operating system at OS_ROOT,
// copied there from the image on first boot; the person's files are
// root's home inside it, and every shell runs inside it. On a laptop
// there is no OS_ROOT: the directory is the disk and the shell is the
// laptop's.
const OS_ROOT = process.env.OS_ROOT ? path.resolve(process.env.OS_ROOT) : null;
const ROOT = path.resolve(
  process.env.DATA_DIR ?? (OS_ROOT ? path.join(OS_ROOT, "root") : "/data"),
);
const MOUNT =
  process.env.DISK_MOUNT ?? (OS_ROOT ? path.dirname(OS_ROOT) : ROOT);
const PORT = Number(process.env.PORT) || 8080;
const SHELL = process.env.SHELL_PATH ?? "/bin/bash";
let ready = !OS_ROOT;
// Where a backup asks us for somewhere to put each part: beside the report.
const BACKUP_URL = REPORT_URL.replace(/\/report$/, "/backup");
const PART = 16 * 1024 * 1024;

// The disk's fullness. A laptop's directory stands in for a volume of
// DISK_GB, measured as what it holds.
const DISK_GB = process.env.DISK_GB;
async function disk() {
  if (DISK_GB) {
    let used = 0;
    const walk = async (dir) => {
      for (const e of await fs
        .readdir(dir, { withFileTypes: true })
        .catch(() => [])) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        // The link itself, never what it points at.
        else used += (await fs.lstat(p).catch(() => ({ size: 0 }))).size;
      }
    };
    await walk(ROOT);
    return { used, total: Number(DISK_GB) * 1e9 };
  }
  const s = await fs.statfs(MOUNT).catch(() => null);
  return s
    ? { used: (s.blocks - s.bfree) * s.bsize, total: s.blocks * s.bsize }
    : { used: 0, total: 0 };
}

// What the machine has and needs, each where the kernel says it, left out
// where it does not: memory in bytes and how much is available, how many
// processes were killed for want of it since boot, and the one-minute
// load over its cores. A laptop's kernel speaks for the laptop, not the
// machine it stands in for, which says memory is nearly gone once told to.
let pressed = false;
async function need() {
  const out = { load: os.loadavg()[0] / os.availableParallelism() };
  if (DISK_GB) {
    if (pressed) out.memory = { total: 2 ** 30, available: 2 ** 25 };
    return out;
  }
  const meminfo = await fs.readFile("/proc/meminfo", "utf8").catch(() => "");
  const kb = (key) =>
    Number(new RegExp(`^${key}:\\s+(\\d+)`, "m").exec(meminfo)?.[1]) * 1024;
  if (meminfo)
    out.memory = { total: kb("MemTotal"), available: kb("MemAvailable") };
  for (const file of ["/proc/vmstat", "/sys/fs/cgroup/memory.events"]) {
    const m = /^oom_kill (\d+)/m.exec(
      await fs.readFile(file, "utf8").catch(() => ""),
    );
    if (m) {
      out.oom = Number(m[1]);
      break;
    }
  }
  return out;
}

async function report() {
  try {
    const res = await fetch(REPORT_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${COMPUTER_SECRET}`,
        "fly-machine-id": FLY_MACHINE_ID,
        "content-type": "application/json",
      },
      body: JSON.stringify({ disk: await disk(), ...(await need()) }),
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

// The same, with symlinks followed: what the path really is must still be
// under the root, or a link made in the shell would reach outside.
async function real(raw) {
  const abs = under(raw);
  const there = await fs.realpath(abs).catch((err) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (there && there !== ROOT && !there.startsWith(ROOT + path.sep))
    throw new Refused(400, "not a path");
  return abs;
}

const same = (a, b) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const sign = (s) =>
  createHmac("sha256", LINK_SECRET).update(s).digest("base64url");

// A signed link names the machine, when it expires, and what it is for,
// all under the deployment's key, so any machine checks it before a word
// is said to the machine it names; only then is a link for another
// machine replayed there. A stale or forged link wakes nobody.
// The machine a request's hostname names, when the deployment gives each
// machine an origin of its own: <machine>.<domain>. Where there is such a
// domain, a browser is only ever answered on a machine's own origin: a
// link or cookie arriving on the app's shared hostname, or naming another
// machine than the origin does, is refused.
const MACHINE_DOMAIN = process.env.MACHINE_DOMAIN || null;
function hostMachine(req) {
  const host = (req.headers.host ?? "").toLowerCase();
  if (!MACHINE_DOMAIN) return null;
  const m = new RegExp(
    `^([a-z0-9]+)\\.${MACHINE_DOMAIN.replaceAll(".", "\\.")}(?::\\d+)?$`,
  ).exec(host);
  return m ? m[1] : "";
}
// Whether a browser's request for a machine belongs on this origin.
const bound = (req, machine) => {
  const origin = hostMachine(req);
  return origin === null || origin === machine;
};

function signed(url, kind, req) {
  const m = url.pathname.match(
    /^\/(dl|term|p)\/([^/]+)\/(\d+)\/([^/]+)(?:\/(\d+))?$/,
  );
  if (!m || m[1] !== kind) return null;
  const [, , machine, expires, sig, port] = m;
  const what =
    kind === "dl"
      ? (url.searchParams.get("path") ?? "")
      : kind === "p"
        ? port
        : "term";
  if (
    Number(expires) < Date.now() ||
    !same(sign(`${kind}|${machine}|${expires}|${what}`), sig)
  )
    return { refused: true };
  if (req && !bound(req, machine)) return { refused: true };
  if (machine !== FLY_MACHINE_ID) return { replay: machine };
  // Ourselves and Fly's own way in are not previews.
  if (kind === "p" && (Number(port) === PORT || Number(port) === 22))
    return { refused: true };
  return { what, port: Number(port) };
}

// The ports something on this machine is listening on, ours left out.
async function listening() {
  const ports = new Set();
  if (process.platform === "linux") {
    for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
      const text = await fs.readFile(file, "utf8").catch(() => "");
      for (const line of text.split("\n").slice(1)) {
        const [, local, , st] = line.trim().split(/\s+/);
        if (st === "0A" && local) ports.add(parseInt(local.split(":")[1], 16));
      }
    }
  } else {
    const { stdout } = await promisify(execFile)("lsof", [
      "-iTCP",
      "-sTCP:LISTEN",
      "-P",
      "-n",
      "-Fn",
    ]).catch(() => ({ stdout: "" }));
    for (const m of stdout.matchAll(/^n.*:(\d+)$/gm)) ports.add(Number(m[1]));
  }
  // Ours, and Fly's own way in.
  ports.delete(PORT);
  ports.delete(22);
  return [...ports].filter((p) => p > 0 && p < 65536).sort((a, b) => a - b);
}

// A previewed app on one of those ports, as the cookie a signed preview
// link set names it: the browser then lives at the root for that port.
// The cookie is a signed link of its own, good for a day, checked before
// anything is done for it.
function previewCookie(req) {
  const m = /(?:^|;\s*)mp=([^;]+)/.exec(req.headers.cookie ?? "");
  if (!m) return null;
  const [machine, expires, port, sig] = m[1].split(".");
  if (!machine || !expires || !port || !sig) return null;
  if (!bound(req, machine)) return null;
  if (
    Number(expires) < Date.now() ||
    !same(sign(`cookie|${machine}|${expires}|${port}`), sig)
  )
    return null;
  if (machine !== FLY_MACHINE_ID) return { replay: machine };
  return { port: Number(port) };
}

// Asks the app, as this machine, for the next step of a backup.
async function backupCall(step, body) {
  const res = await fetch(`${BACKUP_URL}/${step}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${COMPUTER_SECRET}`,
      "fly-machine-id": FLY_MACHINE_ID,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`backup ${step} answered ${res.status}`);
  return res.status === 204 ? {} : res.json();
}

// The whole disk as one compressed archive, streamed to the bucket in
// parts; each part goes where the app says. A machine suspended midway
// carries on when it wakes, since each part is signed afresh.
let backingUp = null;
async function backup() {
  const { id } = await backupCall("begin", {});
  const parts = [];
  const tar = spawn("tar", ["-C", ROOT, "-czf", "-", "."], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  let n = 0;
  let buffer = [];
  let held = 0;
  const send = async (chunks) => {
    const body = Buffer.concat(chunks);
    const { url } = await backupCall("part", { id, partNumber: ++n });
    // A part that stalls is a failed backup, not a stuck one.
    const put = await fetch(url, {
      method: "PUT",
      body,
      signal: AbortSignal.timeout(600_000),
    });
    if (!put.ok) throw new Error(`part ${n} answered ${put.status}`);
    parts.push({ partNumber: n, etag: put.headers.get("etag") ?? "" });
  };
  try {
    for await (let chunk of tar.stdout) {
      // Parts are cut at exactly PART bytes; the store takes no more.
      while (held + chunk.length >= PART) {
        const take = chunk.subarray(0, PART - held);
        buffer.push(take);
        await send(buffer);
        buffer = [];
        held = 0;
        chunk = chunk.subarray(take.length);
      }
      if (chunk.length) {
        buffer.push(chunk);
        held += chunk.length;
      }
    }
    if (held > 0 || n === 0) await send(buffer);
    // An archive is whole only if tar said so.
    await new Promise((resolve, reject) => {
      if (tar.exitCode !== null)
        return tar.exitCode === 0
          ? resolve()
          : reject(new Error(`tar exited ${tar.exitCode}`));
      tar.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)),
      );
    });
    await backupCall("complete", { id, parts });
    return { id, parts: n };
  } catch (err) {
    tar.kill();
    await backupCall("abort", { id }).catch(() => {});
    throw err;
  }
}

// The disk from an archive, onto an empty disk only: nothing is written
// over what is there. A shell's own dotfiles do not make a disk full, and
// one the archive also has stays as it is. The archive unpacks into a folder of
// its own first and moves into place in one step under the tree's lock,
// with the disk checked again at that moment; an archive that will not
// unpack leaves nothing behind.
const visible = (names) =>
  names.filter((x) => !x.startsWith(".") && x !== "lost+found");
const run = (cmd, args) =>
  new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { stdio: ["ignore", "inherit", "inherit"] });
    c.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
let restoring = null;
let lastRestore = null;
async function restore(url) {
  if (visible(await fs.readdir(ROOT)).length)
    throw new Refused(409, "the disk is not empty");
  const stage = `.restoring-${randomBytes(6).toString("hex")}`;
  const dir = path.join(ROOT, stage);
  await fs.mkdir(dir);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6 * 3600_000) });
    if (!res.ok || !res.body)
      throw new Refused(502, `the archive answered ${res.status}`);
    const tar = spawn("tar", ["-C", dir, "-xzf", "-", "--no-same-owner"], {
      stdio: ["pipe", "ignore", "inherit"],
    });
    const done = new Promise((resolve, reject) =>
      tar.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)),
      ),
    );
    await pipeline(Readable.fromWeb(res.body), tar.stdin);
    await done;
    // A link in an archive could point anywhere; none is put back.
    await run("find", [dir, "-type", "l", "-delete"]);
    await exclusive(async () => {
      const have = new Set(await fs.readdir(ROOT));
      if (visible([...have]).length)
        throw new Refused(409, "the disk is not empty");
      // A dotfile the disk already has is kept; the archive's copy is not
      // written over it.
      const names = await fs.readdir(dir);
      console.log(`restore: ${names.length} entries put back`);
      for (const name of names)
        if (!have.has(name))
          await fs.rename(path.join(dir, name), path.join(ROOT, name));
    });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function forward(req, res, port) {
  const out = httpRequest(
    {
      host: "127.0.0.1",
      port,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `localhost:${port}` },
    },
    (answer) => {
      // The previewed app cannot speak for the hostname: its cookies and
      // replays stay on its side.
      const headers = { ...answer.headers };
      delete headers["set-cookie"];
      delete headers["fly-replay"];
      res.writeHead(answer.statusCode, headers);
      answer.pipe(res);
    },
  );
  out.on("error", (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`Nothing answers on port ${port}: ${err.message}`);
    } else res.destroy();
  });
  req.pipe(out);
}

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
    if (d.name === "lost+found" || d.name.startsWith(".restoring-")) continue;
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
  const replay = (machine) => {
    res.writeHead(200, { "fly-replay": `instance=${machine}` });
    res.end();
  };
  // A browser living at a previewed port sees that port, not us; only
  // signed links and the disk's own routes are kept back.
  const ours = /^\/(fs|dl|term|p)(\/|$)/.test(url.pathname);
  if (!ours) {
    const cookie = previewCookie(req);
    if (cookie?.replay) return replay(cookie.replay);
    if (cookie) return forward(req, res, cookie.port);
  }
  if (url.pathname === "/health") return json(200, { ok: true });

  // What a browser is told, in words.
  const say = (status, text) => {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    res.end(text);
  };
  const STALE =
    "This link has expired or is not one of ours. Open it again from your computer.";

  // A browser's download, by a signed link; a range of it, for a download
  // that picks up where it stopped.
  const dl = signed(url, "dl", req);
  if (dl) {
    if (dl.replay) return replay(dl.replay);
    if (dl.refused) return say(403, STALE);
    const abs = await real(dl.what);
    const s = await fs.stat(abs).catch(() => null);
    if (!s?.isFile()) return say(404, "There is no such file on your disk.");
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    let start = 0;
    let end = s.size - 1;
    if (range && (range[1] || range[2])) {
      start = range[1]
        ? Number(range[1])
        : Math.max(0, s.size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(Number(range[2]), s.size - 1) : end;
      if (!(start <= end && start < s.size)) {
        res.writeHead(416, { "content-range": `bytes */${s.size}` });
        return res.end();
      }
    }
    const fh = await fs.open(abs, "r");
    res.writeHead(range ? 206 : 200, {
      "content-type": "application/octet-stream",
      "content-length": end - start + 1,
      "accept-ranges": "bytes",
      ...(range ? { "content-range": `bytes ${start}-${end}/${s.size}` } : {}),
      "content-disposition": disposition(path.basename(abs)),
      "x-content-type-options": "nosniff",
    });
    return pipeline(fh.createReadStream({ start, end }), res).catch(() => {});
  }

  // A browser's preview of a port: the signed link sets the cookie and
  // sends the browser to the root, and everything with the cookie that is
  // not ours goes to that port.
  const pv = signed(url, "p", req);
  if (pv) {
    if (pv.replay) return replay(pv.replay);
    if (pv.refused) return say(403, STALE);
    const day = Date.now() + 86400_000;
    const cookieSig = sign(`cookie|${FLY_MACHINE_ID}|${day}|${pv.port}`);
    const secure =
      req.headers["x-forwarded-proto"] === "https" ? "; Secure" : "";
    res.writeHead(302, {
      "set-cookie": `mp=${FLY_MACHINE_ID}.${day}.${pv.port}.${cookieSig}; Path=/; SameSite=Lax; HttpOnly${secure}`,
      location: "/",
    });
    return res.end();
  }
  if (!same(req.headers.authorization ?? "", `Bearer ${COMPUTER_SECRET}`))
    return json(401, { error: "no" });
  if (!ready)
    return json(503, { error: "Your computer is being set up; a minute." });

  // What is on the disk, biggest first: every folder and file under the
  // root by what it holds, a couple of levels down, and where the
  // operating system lives, what it and its installs take.
  if (url.pathname === "/fs/du" && req.method === "GET") {
    const sizes = new Map();
    let budget = 200_000;
    const walk = async (dir) => {
      let total = 0;
      for (const e of await fs
        .readdir(dir, { withFileTypes: true })
        .catch(() => [])) {
        if (budget-- <= 0)
          throw new Refused(413, "The disk holds more than can be sized here.");
        const p = path.join(dir, e.name);
        if (e.isSymbolicLink()) continue;
        if (e.isDirectory()) total += await walk(p);
        else total += (await fs.lstat(p).catch(() => ({ size: 0 }))).size;
      }
      const rel = path.relative(ROOT, dir);
      if (
        rel.split(path.sep).filter(Boolean).length <= 2 &&
        !rel.startsWith("..")
      )
        sizes.set("/" + rel.split(path.sep).join("/"), total);
      return total;
    };
    const home = await walk(ROOT);
    // The biggest files, wherever they are, up to two levels down.
    const files = [];
    const findFiles = async (dir, depth) => {
      for (const e of await fs
        .readdir(dir, { withFileTypes: true })
        .catch(() => [])) {
        const p = path.join(dir, e.name);
        if (e.isFile())
          files.push({
            path: "/" + path.relative(ROOT, p).split(path.sep).join("/"),
            size: (await fs.lstat(p).catch(() => ({ size: 0 }))).size,
          });
        else if (e.isDirectory() && depth < 3) await findFiles(p, depth + 1);
      }
    };
    await findFiles(ROOT, 0);
    let os = 0;
    if (OS_ROOT) {
      const walkOs = async (dir) => {
        let total = 0;
        for (const e of await fs
          .readdir(dir, { withFileTypes: true })
          .catch(() => [])) {
          const p = path.join(dir, e.name);
          if (
            p === ROOT ||
            e.isSymbolicLink() ||
            (["proc", "sys", "dev", "run", "tmp"].includes(e.name) &&
              dir === OS_ROOT)
          )
            continue;
          if (e.isDirectory()) total += await walkOs(p);
          else total += (await fs.lstat(p).catch(() => ({ size: 0 }))).size;
        }
        return total;
      };
      os = await walkOs(OS_ROOT);
    }
    return json(200, {
      home,
      os,
      folders: [...sizes.entries()]
        .filter(([p]) => p !== "/")
        .map(([path, size]) => ({ path, size }))
        .sort((a, b) => b.size - a.size)
        .slice(0, 20),
      files: files.sort((a, b) => b.size - a.size).slice(0, 20),
      disk: await disk(),
    });
  }
  if (url.pathname === "/fs/ports" && req.method === "GET")
    return json(200, { ports: await listening() });
  // A laptop's machine told to be short of memory from now on, and to say
  // so at once.
  if (url.pathname === "/fs/pressure" && req.method === "POST" && DISK_GB) {
    pressed = true;
    await report();
    return json(200, { ok: true });
  }
  // A backup runs on its own once asked for; asking again while one runs
  // is answered with the one running.
  if (url.pathname === "/fs/backup" && req.method === "POST") {
    if (!backingUp) {
      backingUp = backup().finally(() => {
        backingUp = null;
      });
      backingUp.catch((err) => console.error(`backup failed: ${err.message}`));
    }
    const wait = url.searchParams.has("wait");
    if (wait) {
      const done = await backingUp.catch((err) => ({ error: err.message }));
      return json(done.error ? 500 : 200, done);
    }
    return json(202, { started: true });
  }
  // A restore runs on its own once asked for; the page asks how it is
  // going. Asking again while one runs is answered with the one running.
  if (url.pathname === "/fs/restore" && req.method === "POST") {
    const b = await readJson(req);
    if (typeof b.url !== "string") return json(400, { error: "a url" });
    if (!restoring) {
      if (visible(await fs.readdir(ROOT)).length)
        return json(409, { error: "the disk is not empty" });
      restoring = restore(b.url)
        .then(() => {
          lastRestore = { ok: true, at: Date.now() };
        })
        .catch((err) => {
          lastRestore = { ok: false, error: err.message, at: Date.now() };
        })
        .finally(() => {
          restoring = null;
        });
    }
    return json(202, { started: true });
  }
  if (url.pathname === "/fs/restore" && req.method === "GET")
    return json(200, { running: Boolean(restoring), last: lastRestore });

  if (url.pathname === "/fs" && req.method === "GET") {
    const abs = await real(url.searchParams.get("path"));
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
    const abs = await real(url.searchParams.get("path"));
    const s = await fs.stat(abs).catch(() => null);
    if (!s) return json(404, { error: "nothing there" });
    return json(200, {
      kind: s.isDirectory() ? "folder" : "file",
      size: s.size,
    });
  }
  if (url.pathname === "/fs/folder" && req.method === "POST") {
    const abs = await real((await readJson(req)).path);
    return exclusive(async () => {
      const s = await fs.stat(abs).catch(() => null);
      if (s && !s.isDirectory()) return json(409, { error: "a file is there" });
      if (!(await fs.stat(path.dirname(abs)).catch(() => null))?.isDirectory())
        return json(404, { error: "no such folder" });
      await fs.mkdir(abs).catch((err) => {
        if (err.code !== "EEXIST") throw err;
      });
      return json(200, { ok: true });
    });
  }
  if (url.pathname === "/fs/move" && req.method === "POST") {
    const b = await readJson(req);
    const from = await real(b.from);
    const to = await real(b.to);
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
    const abs = await real(url.searchParams.get("path"));
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
    const abs = await real(b.path);
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
// A shell on the disk over a WebSocket, by a signed link: bytes in are
// keys, bytes out are the screen, and a text frame is a resize. The pty
// is native code, built into the image; a machine without it says so.
const shells = new WebSocketServer({ noServer: true });
let pty = null;
try {
  pty = (await import("node-pty")).default;
  // The prebuilt helper arrives from the registry without its execute
  // bit; the compiled one has it.
  const helper = path.join(
    path.dirname(new URL(import.meta.resolve("node-pty")).pathname),
    "..",
    "prebuilds",
    `${process.platform}-${process.arch}`,
    "spawn-helper",
  );
  await fs.chmod(helper, 0o755).catch(() => {});
} catch {
  console.error("no pty on this machine: the terminal is off");
}
// A shell is a session: it lives on when its socket drops, keeps the last
// of its screen, and a socket for the same session picks it up. One left
// alone for half an hour is closed. The local shell gets a small
// environment of its own, not the daemon's.
const sessions = new Map();
const SCROLLBACK = 200_000;
function spawnShell() {
  // Inside the operating system on the volume, at home, as root.
  return OS_ROOT
    ? pty.spawn(
        "/usr/sbin/chroot",
        [OS_ROOT, "/usr/bin/env", "-C", "/root", "HOME=/root", SHELL, "-l"],
        {
          name: "xterm-256color",
          cols: 100,
          rows: 30,
          cwd: "/",
          env: {
            PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            TERM: "xterm-256color",
            LANG: "C.UTF-8",
          },
        },
      )
    : pty.spawn(SHELL, ["-l"], {
        name: "xterm-256color",
        cols: 100,
        rows: 30,
        cwd: ROOT,
        env: {
          PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
          HOME: ROOT,
          TERM: "xterm-256color",
          LANG: process.env.LANG ?? "C.UTF-8",
        },
      });
}
function attach(ws, id) {
  let session = sessions.get(id);
  if (!session) {
    let shell;
    try {
      shell = spawnShell();
    } catch (err) {
      console.error(`no shell: ${err.message}`);
      return ws.close(1011, "The shell could not start.");
    }
    session = { shell, ws: null, screen: "", idle: null };
    sessions.set(id, session);
    shell.onData((data) => {
      session.screen = (session.screen + data).slice(-SCROLLBACK);
      if (session.ws?.readyState === session.ws?.OPEN) session.ws.send(data);
    });
    shell.onExit(() => {
      sessions.delete(id);
      session.ws?.close(1000, "The shell exited.");
    });
  }
  if (session.idle) clearTimeout(session.idle);
  session.idle = null;
  session.ws?.close(1000, "Picked up elsewhere.");
  session.ws = ws;
  if (session.screen) ws.send(session.screen);
  ws.on("message", (data, isBinary) => {
    if (isBinary) return session.shell.write(data.toString());
    try {
      const { resize } = JSON.parse(data.toString());
      if (resize) session.shell.resize(resize[0], resize[1]);
    } catch {}
  });
  ws.on("close", () => {
    if (session.ws !== ws) return;
    session.ws = null;
    session.idle = setTimeout(() => {
      if (!session.ws) session.shell.kill();
    }, 30 * 60_000);
  });
}
shells.on("connection", (ws, req) =>
  attach(
    ws,
    new URL(req.url, "http://computer").searchParams.get("session") ||
      "default",
  ),
);

server.on("upgrade", (req, socket, head) => {
  try {
    upgrade(req, socket, head);
  } catch (err) {
    console.error(`upgrade: ${err.message}`);
    socket.destroy();
  }
});

function upgrade(req, socket, head) {
  const url = new URL(req.url, "http://computer");
  const refuse = (status, text) => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nconnection: close\r\n\r\n`);
    socket.destroy();
  };
  const replay = (machine) => {
    socket.write(
      `HTTP/1.1 200 OK\r\nfly-replay: instance=${machine}\r\ncontent-length: 0\r\nconnection: close\r\n\r\n`,
    );
    socket.destroy();
  };
  const term = signed(url, "term", req);
  if (term) {
    if (term.replay) return replay(term.replay);
    if (term.refused) return refuse(403, "Forbidden");
    if (!pty) return refuse(501, "No terminal on this machine");
    if (!ready) return refuse(503, "Being set up");
    return shells.handleUpgrade(req, socket, head, (ws) =>
      shells.emit("connection", ws, req),
    );
  }
  // A previewed app's own sockets, live reload and the like.
  const cookie = previewCookie(req);
  if (cookie?.replay) return replay(cookie.replay);
  if (!cookie) return refuse(404, "Not Found");
  const target = connect(cookie.port, "127.0.0.1", () => {
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${k === "host" ? `localhost:${cookie.port}` : v}`)
      .join("\r\n");
    target.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    if (head.length) target.write(head);
    socket.pipe(target).pipe(socket);
  });
  target.on("error", () => refuse(502, "Bad Gateway"));
}

// First boot: the image's own root goes onto the volume, once; every
// boot: the kernel's views are bound inside it and its DNS is ours, so
// what runs in there is a whole machine.
async function settle() {
  if (!OS_ROOT) return;
  // The marker sits beside the operating system, out of the shell's own
  // root, and a copy that was cut off is finished, never wiped: nothing a
  // person put there is deleted by a boot.
  const done = path.join(path.dirname(OS_ROOT), ".os-ready");
  if (!(await fs.stat(done).catch(() => null))) {
    console.log("first boot: copying the operating system onto the volume");
    await fs.mkdir(OS_ROOT, { recursive: true });
    // One copy, straight: the image's root minus the kernel's views, the
    // volume itself and the daemon.
    for (const name of await fs.readdir("/")) {
      if (
        ["proc", "sys", "dev", "run", "tmp", "data", "computer"].includes(name)
      )
        continue;
      if (await fs.stat(`${OS_ROOT}/${name}`).catch(() => null)) continue;
      await run("cp", ["-a", `/${name}`, `${OS_ROOT}/${name}`]);
    }
    for (const d of ["proc", "sys", "dev", "run", "tmp"])
      await fs.mkdir(path.join(OS_ROOT, d), { recursive: true });
    await fs.chmod(path.join(OS_ROOT, "tmp"), 0o1777);
    await fs.writeFile(done, new Date().toISOString());
  }
  for (const d of ["proc", "sys", "dev"])
    await run("mount", ["--rbind", `/${d}`, path.join(OS_ROOT, d)]);
  await fs.copyFile("/etc/resolv.conf", path.join(OS_ROOT, "etc/resolv.conf"));
  await fs.mkdir(ROOT, { recursive: true });
  ready = true;
  console.log("the operating system on the volume is up");
}

// A root that cannot be made is a machine that cannot serve: said now.
await fs.mkdir(ROOT, { recursive: true });
server.listen(PORT, "0.0.0.0", () =>
  console.log(`serving ${ROOT} on ${PORT} as ${FLY_MACHINE_ID}`),
);
// Tried until it works: a boot that cannot set the operating system up
// says so and tries again in a minute, rather than dying and being
// restarted into the same failure.
(async () => {
  for (;;) {
    try {
      await settle();
      return;
    } catch (err) {
      console.error(
        `the operating system could not be set up: ${err.message}; again in a minute`,
      );
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
})();
await report();
setInterval(report, 5 * 60 * 1000).unref();
