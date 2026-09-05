// The computer's daemon: the person's home on the volume served as a
// filesystem, a shell in it as them over a WebSocket, and the ports on
// the machine reachable from a browser. We list, make, move and delete
// under it with the machine's secret, land files on it from a URL, and
// hand a browser a signed download, terminal or preview. Fly sets
// FLY_MACHINE_ID and routes to us; a request that reached the wrong
// machine is replayed to the right one. It also reports on itself to us
// on boot and every five minutes: how full the disk is, and what it has
// and needs.
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

// COMPUTER_SECRET is this machine's own, for the app's calls; LINK_KEY is
// this machine's own too, the key its links are signed with, so a shell
// with root here forges no link to anybody else's machine.
const { COMPUTER_SECRET, LINK_KEY, REPORT_URL, FLY_MACHINE_ID } = process.env;
if (!COMPUTER_SECRET || !LINK_KEY || !REPORT_URL || !FLY_MACHINE_ID) {
  console.error(
    "A computer needs COMPUTER_SECRET, LINK_KEY, REPORT_URL and FLY_MACHINE_ID.",
  );
  process.exit(1);
}
// On a machine the volume holds the whole operating system at OS_ROOT,
// copied there from the image on first boot; the person is an ordinary
// user in it, and their home is the disk served here and where every
// shell opens, as them. On a laptop there is no OS_ROOT: the directory
// is the disk and the shell is the laptop's.
const OS_ROOT = process.env.OS_ROOT ? path.resolve(process.env.OS_ROOT) : null;
const PERSON = { name: "me", uid: 1000, gid: 1000, home: "/home/me" };
const ROOT = path.resolve(
  process.env.DATA_DIR ?? (OS_ROOT ? path.join(OS_ROOT, PERSON.home) : "/data"),
);
const MOUNT =
  process.env.DISK_MOUNT ?? (OS_ROOT ? path.dirname(OS_ROOT) : ROOT);
// Where a reset sets the old system aside.
const OLD = OS_ROOT ? `${OS_ROOT}.old` : null;
const PORT = Number(process.env.PORT) || 8080;
const SHELL = process.env.SHELL_PATH ?? "/bin/bash";
// Why the disk cannot be served right now, or null.
let busy = OS_ROOT ? "Your computer is being set up; a minute." : null;
// Where a backup asks us for somewhere to put each part, and where a
// landing says how it went: beside the report.
const BACKUP_URL = REPORT_URL.replace(/\/report$/, "/backup");
const LANDED_URL = REPORT_URL.replace(/\/report$/, "/landed");
const PART = 16 * 1024 * 1024;
// How we speak to the app: as this machine, with its secret.
const AS_ME = {
  authorization: `Bearer ${COMPUTER_SECRET}`,
  "fly-machine-id": FLY_MACHINE_ID,
  "content-type": "application/json",
};

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
        // A file still landing is held whole, so its bytes so far are not
        // counted again; otherwise the link itself, never what it points at.
        else if (!landingTmps().has(p))
          used += (await fs.lstat(p).catch(() => ({ size: 0 }))).size;
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
// processes were killed for want of it since boot, the one-minute load
// over its cores, and how many terminals are open on it. A laptop's kernel
// speaks for the laptop, not the machine it stands in for, which says what
// it is told to.
let pretend = null;
async function need() {
  const out = {
    load: os.loadavg()[0] / os.availableParallelism(),
    terminals: [...sessions.values()].filter((s) => s.ws).length,
  };
  if (DISK_GB) {
    if (pretend) {
      out.memory = { total: 2 ** 30, available: pretend.free * 2 ** 30 };
      out.load = pretend.load;
      out.oom = pretend.oom;
    }
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
      headers: AS_ME,
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

const inRoot = (p) => p === ROOT || p.startsWith(ROOT + path.sep);
// A path that is not there yet is not a path; one that cannot be resolved
// at all is not one either.
const nowhere = (err) => {
  if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
  throw new Refused(400, "not a path");
};
// Where a path really is: the deepest part of it that exists, resolved,
// with the names that are not there yet joined back on. A link anywhere
// along the way must land under the root.
async function resolved(abs) {
  if (abs === ROOT) return ROOT;
  const there = await fs.realpath(abs).catch(nowhere);
  if (there) {
    if (!inRoot(there)) throw new Refused(400, "not a path");
    return there;
  }
  return path.join(await resolved(path.dirname(abs)), path.basename(abs));
}
// The same, with symlinks followed: the folder a path sits in is resolved
// before its own name is put back on, so neither a link made in the shell
// nor a leaf that is not there yet reaches outside the root.
async function real(raw) {
  const abs = under(raw);
  if (abs === ROOT) return ROOT;
  const there = path.join(
    await resolved(path.dirname(abs)),
    path.basename(abs),
  );
  const leaf = await fs.realpath(there).catch(nowhere);
  if (leaf && !inRoot(leaf)) throw new Refused(400, "not a path");
  return there;
}

const same = (a, b) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const sign = (s) =>
  createHmac("sha256", LINK_KEY).update(s).digest("base64url");

// A signed link names the machine, when it expires, and what it is for,
// under that machine's own key. Only the machine a link names can tell a
// real one from a forged one, so a link for another machine is replayed
// there unread and answered where it belongs. One past its expiry is
// refused where it lands and never replayed; a fresh forged one wakes the
// machine it names, as any request to that machine's hostname would, and
// buys nothing.
const expired = (expires) => !(Number(expires) >= Date.now());
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
  // A terminal link names the session it opens, so one link is one shell.
  const what =
    kind === "dl"
      ? (url.searchParams.get("path") ?? "")
      : kind === "p"
        ? port
        : (url.searchParams.get("session") ?? "");
  if ((req && !bound(req, machine)) || expired(expires))
    return { refused: true };
  if (machine !== FLY_MACHINE_ID) return { replay: machine };
  if (!same(sign(`${kind}|${machine}|${expires}|${what}`), sig))
    return { refused: true };
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
  if (!bound(req, machine) || expired(expires)) return null;
  if (machine !== FLY_MACHINE_ID) return { replay: machine };
  if (!same(sign(`cookie|${machine}|${expires}|${port}`), sig)) return null;
  return { port: Number(port) };
}

// Asks the app, as this machine, for the next step of a backup.
async function backupCall(step, body) {
  const res = await fetch(`${BACKUP_URL}/${step}`, {
    method: "POST",
    headers: AS_ME,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`backup ${step} answered ${res.status}`);
  return res.status === 204 ? {} : res.json();
}

// The whole home as one compressed archive, streamed to the bucket in
// parts; each part goes where the app says. A machine suspended midway
// carries on when it wakes, since each part is signed afresh.
async function backup() {
  const { id } = await backupCall("begin", {});
  const parts = [];
  const tar = spawn("tar", ["-C", ROOT, "-czf", "-", "."], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  tar.on("error", (err) => tar.stdout.destroy(err));
  let n = 0;
  let buffer = [];
  let held = 0;
  let bytes = 0;
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
      bytes += chunk.length;
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
    // An archive is whole only if tar said so. A home in use changes
    // under tar as it reads: it says 1 and hands over a whole archive
    // anyway, so 1 with bytes in it is a backup, and nothing else is.
    const whole = (code) =>
      code === 0 || (code === 1 && bytes > 0)
        ? Promise.resolve()
        : Promise.reject(new Error(`tar exited ${code}`));
    await new Promise((resolve, reject) => {
      if (tar.exitCode !== null)
        return whole(tar.exitCode).then(resolve, reject);
      tar.on("exit", (code) => whole(code).then(resolve, reject));
    });
    await backupCall("complete", { id, parts });
    return { id, parts: n };
  } catch (err) {
    tar.kill();
    await backupCall("abort", { id }).catch(() => {});
    throw err;
  }
}

// A backup runs on its own once asked for; asking while one runs joins
// the one running.
let backingUp = null;
function startBackup() {
  if (!backingUp) {
    backingUp = backup().finally(() => {
      backingUp = null;
    });
    backingUp.catch((err) => console.error(`backup failed: ${err.message}`));
  }
  return backingUp;
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
    c.on("error", reject);
    c.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)),
    );
  });
// What the daemon makes in the home is the person's, never root's.
const own = async (p, deep = false) => {
  if (!OS_ROOT) return;
  if (deep) await run("chown", ["-R", `${PERSON.uid}:${PERSON.gid}`, p]);
  else await fs.lchown(p, PERSON.uid, PERSON.gid);
};
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
    const done = new Promise((resolve, reject) => {
      tar.on("error", reject);
      tar.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)),
      );
    });
    await pipeline(Readable.fromWeb(res.body), tar.stdin);
    await done;
    // A link in an archive could point anywhere; none is put back.
    await run("find", [dir, "-type", "l", "-delete"]);
    await own(dir, true);
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
  // A browser that drops its end takes the connection upstream with it,
  // so nothing on the machine is left holding a request nobody wants.
  res.on("close", () => out.destroy());
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
    if (d.name === "lost+found" || SCRATCH.test(d.name)) continue;
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

// What the daemon makes for itself on the disk, which no listing shows.
const SCRATCH = /^\.(restoring-|landing-|landed|reset)/;

// A small record of the daemon's own, beside the operating system: whole
// or absent, never half-written, and nothing when it cannot be read.
async function recall(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.error(`${file}: ${err.message}`);
    return null;
  }
}
async function keep(file, value) {
  const tmp = `${file}.${randomBytes(4).toString("hex")}`;
  await fs.writeFile(tmp, JSON.stringify(value));
  await fs.rename(tmp, file);
}

// The files this daemon is landing or has landed, by the id the app gave
// each: where each goes and its hidden copy, then that it is in place,
// until the app has heard. A landing whose word was lost is still on
// record here, and nothing else on the disk is taken for it.
const LANDED = path.join(MOUNT, ".landed");
const landedIds = (await recall(LANDED)) ?? {};
// One change to the record at a time; a write that fails is said, and
// the record in memory stays right for the next.
let ledger = Promise.resolve();
const noteLanded = (id, entry) =>
  (ledger = ledger
    .then(async () => {
      if (entry) landedIds[id] = entry;
      else delete landedIds[id];
      await keep(LANDED, landedIds);
    })
    .catch((err) => console.error(`the landed record: ${err.message}`)));
// Whether the file an id names is in place: on record as landed, or
// linked there by a pull cut off before it could say so, which its
// hidden copy and the file being one and the same shows.
async function isLanded(id) {
  const entry = landedIds[id];
  if (!entry) return false;
  if (entry.landed) return true;
  const [copy, file] = await Promise.all([
    fs.stat(entry.tmp).catch(() => null),
    fs.stat(entry.target).catch(() => null),
  ]);
  if (!copy || !file || copy.ino !== file.ino) return false;
  await noteLanded(id, { ...entry, landed: true });
  await fs.rm(entry.tmp, { force: true });
  return true;
}
// Off the record, with its hidden copy if one is left.
async function forgetLanded(id) {
  const entry = landedIds[id];
  if (entry?.tmp) await fs.rm(entry.tmp, { force: true });
  await noteLanded(id, null);
}

// Fetches a URL onto the disk, whole or not at all: a hidden copy named
// for the id in the same folder, checked against the size promised, put
// on record, then linked into place, which refuses to replace whatever
// took the name meanwhile. A copy left by a pull of the same id cut off
// goes first.
async function pull(id, target, url, size, landing = { landed: false }) {
  if (await fs.stat(target).catch(() => null)) throw new Refused(409, "exists");
  const tmp = path.join(path.dirname(target), `.landing-${id}`);
  landing.tmp = tmp;
  await fs.rm(tmp, { force: true });
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
    await own(tmp);
    await noteLanded(id, { target, tmp });
    try {
      await fs.link(tmp, target);
    } catch (err) {
      if (err.code === "EEXIST") throw new Refused(409, "exists");
      throw err;
    }
    landing.landed = true;
    await noteLanded(id, { target, tmp, landed: true });
    await fs.rm(tmp, { force: true });
  } catch (err) {
    await forgetLanded(id);
    if (err.code === "ENOSPC") throw new Refused(507, "the disk is full");
    throw err;
  }
}

// A pull that carries on alone, goes on the record once the file is in
// place, and says to the app how it went by the id the app gave the
// file; a path already landing is joined, not pulled twice. A landing's
// whole size is held against the disk's room until the file is in place,
// so pulls accepted together cannot together overrun it; on a real disk
// the bytes written so far count twice until then, which errs safe.
const landings = new Map();
// The same landings by the id the app gave each, so an id owns the file
// it is putting in place and no second call can take its name or its
// hidden copy.
const landingIds = new Map();
// Why the disk cannot be emptied while something is arriving on it.
const LANDING_NOW =
  "A file is on its way onto the disk; reset once it is there.";
const held = () =>
  [...landings.values()].reduce((n, l) => n + (l.landed ? 0 : l.size), 0);
// The temp files of the landings under way, and no other file.
const landingTmps = () =>
  new Set([...landings.values()].map((l) => l.tmp).filter(Boolean));
// The id that started a landing is the only one that joins it: a second
// id for the same path, or the same id for a second path, would land one
// file with the other's bytes. The path and the id are claimed before
// anything is waited for, so no second pull passes the same checks
// meanwhile; a claim that cannot go ahead is let go of with its refusal.
async function land(id, target, url, size) {
  if (landings.has(target)) {
    if (landings.get(target).id === id) return;
    throw new Refused(409, "something else is landing there");
  }
  if (landingIds.has(id))
    throw new Refused(409, "that landing is under way elsewhere");
  const landing = { id, size, landed: false, tmp: null };
  landings.set(target, landing);
  landingIds.set(id, landing);
  const release = () => {
    landings.delete(target);
    landingIds.delete(id);
  };
  try {
    if (!(await fs.stat(path.dirname(target)).catch(() => null))?.isDirectory())
      throw new Refused(404, "no such folder");
    if (await fs.stat(target).catch(() => null))
      throw new Refused(409, "exists");
    const { used, total } = await disk();
    if (total && total - used < held())
      throw new Refused(507, "the disk is full");
  } catch (err) {
    release();
    throw err;
  }
  // The id is the landing's until the app has heard how it went: a pull
  // that took the id back while the last one was still being reported
  // would have its record cleared, and its hidden copy deleted, by the
  // word about the one before it.
  pull(id, target, url, size, landing)
    .then(
      async () => {
        if (await landed({ id, ok: true })) await forgetLanded(id);
      },
      (err) => landed({ id, ok: false, error: err.message }),
    )
    .catch((err) => console.error(`landing ${id}: ${err.message}`))
    .finally(release);
}

// Tells the app how a landing went, a few times if it must, and whether
// the app heard; a machine that cannot reach the app leaves it to the
// sweep, which asks what was landed.
async function landed(body) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(LANDED_URL, {
        method: "POST",
        headers: AS_ME,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status < 500) return res.ok;
      console.error(`landed answered ${res.status}`);
    } catch (err) {
      console.error(`landed failed: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
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
  // What a browser is told, in words.
  const say = (status, text) => {
    res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
    res.end(text);
  };
  const STALE =
    "This link has expired or is not one of ours. Open it again from your computer.";
  // A browser living at a previewed port sees that port, not us; only
  // signed links and the disk's own routes are kept back.
  const ours = /^\/(fs|dl|term|p)(\/|$)/.test(url.pathname);
  if (!ours) {
    const cookie = previewCookie(req);
    if (cookie?.replay) return replay(cookie.replay);
    if (cookie) return forward(req, res, cookie.port);
  }
  if (url.pathname === "/health") return json(200, { ok: true });

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
  // How a reset is going is answerable while it goes.
  if (url.pathname === "/fs/reset" && req.method === "GET")
    return json(200, { running: Boolean(resetting), last: lastReset });
  if (busy) return json(503, { error: busy });

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
  // A laptop's machine told what to say of its memory, load and kills
  // from now on — the share of memory free, the load over its cores, the
  // count killed — and to say it at once.
  if (url.pathname === "/fs/pressure" && req.method === "POST" && DISK_GB) {
    const { free = 0.03, load = 0.1, oom = 0 } = await readJson(req);
    pretend = { free, load, oom };
    await report();
    return json(200, { ok: true });
  }
  if (url.pathname === "/fs/backup" && req.method === "POST") {
    const running = startBackup();
    if (!url.searchParams.has("wait")) return json(202, { started: true });
    const done = await running.catch((err) => ({ error: err.message }));
    return json(done.error ? 500 : 200, done);
  }
  // A reset runs on its own once asked for: a backup of the home, then a
  // fresh operating system around it; the page asks how it is going, and
  // the last one's outcome is kept: done, refused with nothing changed,
  // or stopped partway.
  if (url.pathname === "/fs/reset" && req.method === "POST") {
    const { backedUp } = await readJson(req);
    if (landings.size || restoring) return json(409, { error: LANDING_NOW });
    if (!resetting)
      resetting = reset(backedUp === true)
        .then(() => resetEnded({ ok: true, at: Date.now() }))
        .catch((err) =>
          resetEnded({
            ok: false,
            at: Date.now(),
            ...(err instanceof Refused
              ? { refused: err.message }
              : { error: err.message }),
          }),
        )
        .finally(() => {
          resetting = null;
        });
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
      await own(abs);
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
      const made = await fs.mkdir(path.dirname(to), { recursive: true });
      if (made) await own(made, true);
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
  // Whether a file the app names was landed by this machine and never
  // heard of; and the app having heard, it goes off the record.
  if (url.pathname === "/fs/landed" && req.method === "GET")
    return json(200, {
      landed: await isLanded(url.searchParams.get("id") ?? ""),
    });
  if (url.pathname === "/fs/landed" && req.method === "DELETE") {
    await forgetLanded(url.searchParams.get("id") ?? "");
    return json(200, { ok: true });
  }
  // A file onto the disk from where it is staged: refused now if it
  // cannot land, else landed alone and reported when it has.
  if (url.pathname === "/fs/pull" && req.method === "POST") {
    const b = await readJson(req);
    const abs = await real(b.path);
    if (
      !/^[A-Za-z0-9-]{1,64}$/.test(b.id ?? "") ||
      typeof b.url !== "string" ||
      !(b.size >= 0)
    )
      return json(400, { error: "an id, a url and a size" });
    await land(b.id, abs, b.url, b.size);
    return json(202, { started: true });
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
shells.on("error", (err) => console.error(`terminals: ${err.message}`));
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
// environment of its own, not the daemon's. Nothing said to a shell that
// has exited, or to a socket that has closed, can bring the daemon down.
// A machine holds this many shells at once: at the cap, the one whose
// socket has been gone longest makes room, and only when every shell has
// a socket is a new one refused.
const sessions = new Map();
const SESSIONS = 8;
const quietly = (fn) => {
  try {
    fn();
  } catch (err) {
    console.error(`shell: ${err.message}`);
  }
};
function makeRoom() {
  let oldest = null;
  for (const [id, s] of sessions)
    if (!s.ws && (!oldest || s.left < oldest[1].left)) oldest = [id, s];
  if (!oldest) return false;
  sessions.delete(oldest[0]);
  clearTimeout(oldest[1].idle);
  quietly(() => oldest[1].shell.kill());
  return true;
}
const SCROLLBACK = 200_000;
function spawnShell() {
  // Inside the operating system on the volume, at home, as the person.
  return OS_ROOT
    ? pty.spawn(
        "/usr/sbin/chroot",
        [
          `--userspec=${PERSON.uid}:${PERSON.gid}`,
          OS_ROOT,
          "/usr/bin/env",
          "-C",
          PERSON.home,
          SHELL,
          "-l",
        ],
        {
          name: "xterm-256color",
          cols: 100,
          rows: 30,
          cwd: "/",
          env: {
            PATH: "/usr/local/bin:/usr/bin:/bin",
            HOME: PERSON.home,
            USER: PERSON.name,
            LOGNAME: PERSON.name,
            SHELL,
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
  // A socket that fails is closed, never thrown: a bad frame is one
  // browser's problem, not the machine's.
  ws.on("error", (err) => console.error(`terminal: ${err.message}`));
  ws.alive = true;
  ws.on("pong", () => {
    ws.alive = true;
  });
  let session = sessions.get(id);
  if (!session) {
    if (sessions.size >= SESSIONS && !makeRoom())
      return ws.close(1013, "This computer has all the shells it can hold.");
    let shell;
    try {
      shell = spawnShell();
    } catch (err) {
      console.error(`no shell: ${err.message}`);
      return ws.close(1011, "The shell could not start.");
    }
    session = { shell, ws: null, screen: "", idle: null, left: 0 };
    sessions.set(id, session);
    shell.onData((data) => {
      session.screen = (session.screen + data).slice(-SCROLLBACK);
      if (session.ws && session.ws.readyState === session.ws.OPEN)
        session.ws.send(data);
    });
    shell.onExit(() => {
      session.gone = true;
      if (sessions.get(id) === session) sessions.delete(id);
      quietly(() => session.ws?.close(1000, "The shell exited."));
    });
  }
  if (session.idle) clearTimeout(session.idle);
  session.idle = null;
  session.ws?.close(1000, "Picked up elsewhere.");
  session.ws = ws;
  if (session.screen) ws.send(session.screen);
  ws.on("message", (data, isBinary) => {
    if (session.gone) return;
    if (isBinary) return quietly(() => session.shell.write(data.toString()));
    try {
      const { resize } = JSON.parse(data.toString());
      if (resize) session.shell.resize(resize[0], resize[1]);
    } catch {}
  });
  ws.on("close", () => {
    if (session.ws !== ws) return;
    session.ws = null;
    session.left = Date.now();
    session.idle = setTimeout(() => {
      if (!session.ws) quietly(() => session.shell.kill());
    }, 30 * 60_000);
  });
}
// A socket that has stopped answering is closed: the shell it held is
// let go of at its own pace, and the machine reads as quiet again.
setInterval(() => {
  for (const ws of shells.clients)
    quietly(() => {
      if (ws.alive === false) return ws.terminate();
      ws.alive = false;
      ws.ping();
    });
}, 30_000).unref();

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
    if (busy) return refuse(503, "Not right now");
    return shells.handleUpgrade(req, socket, head, (ws) =>
      attach(ws, term.what),
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
  // Either end that goes takes the other with it.
  target.on("close", () => socket.destroy());
  socket.on("error", () => target.destroy());
  socket.on("close", () => target.destroy());
}

// The operating system on the volume, whole and entered, on every boot:
// a reset that was cut off is finished, the image's own root goes onto
// the volume once, the person's account is in it, and the kernel's views
// and the deployment's few files are bound in, so what runs in there is
// a whole machine.
async function settle() {
  if (!OS_ROOT) return;
  // A system set aside by a reset: its home comes over, the rest goes.
  const finishing = await fs.stat(OLD).catch(() => null);
  if (finishing) {
    const home = path.join(OLD, PERSON.home);
    if (await fs.stat(home).catch(() => null)) {
      await fs.rm(ROOT, { recursive: true, force: true });
      await fs.mkdir(path.dirname(ROOT), { recursive: true });
      await fs.rename(home, ROOT);
    }
    await run("rm", ["-rf", OLD]);
  }
  // The marker sits beside the operating system, out of the shell's own
  // root, and nothing a person put there is deleted by a boot.
  const done = path.join(MOUNT, ".os-ready");
  if (!(await fs.stat(done).catch(() => null))) {
    console.log("copying the operating system onto the volume");
    await fs.mkdir(OS_ROOT, { recursive: true });
    // One copy, straight: the image's root minus the kernel's views, the
    // volume itself and the daemon.
    for (const name of await fs.readdir("/")) {
      if (
        ["proc", "sys", "dev", "run", "tmp", "data", "computer"].includes(name)
      )
        continue;
      // Each entry is copied aside and moved into place, so a boot cut
      // off mid-copy leaves nothing half-there and the next one finishes
      // the job: what is in place is whole.
      const there = `${OS_ROOT}/${name}`;
      if (await fs.lstat(there).catch(() => null)) continue;
      const copying = `${there}.copying`;
      await run("rm", ["-rf", copying]);
      await run("cp", ["-a", `/${name}`, copying]);
      await fs.rename(copying, there);
    }
    for (const d of ["proc", "sys", "dev", "run", "tmp"])
      await fs.mkdir(path.join(OS_ROOT, d), { recursive: true });
    await fs.chmod(path.join(OS_ROOT, "tmp"), 0o1777);
    await fs.writeFile(done, new Date().toISOString());
  }
  await person();
  for (const d of ["proc", "sys", "dev"])
    await run("mount", ["--rbind", `/${d}`, path.join(OS_ROOT, d)]);
  // The deployment's own: its DNS and hosts, the sudo rule, the profile
  // and pip's setting, current from the image on every boot.
  for (const [file, mode] of [
    ["etc/resolv.conf", 0o644],
    ["etc/hosts", 0o644],
    ["etc/sudoers.d/me", 0o440],
    ["etc/profile.d/me.sh", 0o644],
    ["etc/pip.conf", 0o644],
  ]) {
    await fs.copyFile(`/${file}`, path.join(OS_ROOT, file));
    await fs.chmod(path.join(OS_ROOT, file), mode);
  }
  if (finishing) await resetEnded({ ok: true, at: Date.now() });
  // The image carries no package lists; the system's own are brought up
  // to date before the machine is served, so the first install finds its
  // package and never apt's lock. A minute at most: past that the
  // machine is served and the update finishes on its own.
  const began = Date.now();
  const updated = run("chroot", [OS_ROOT, "apt-get", "update", "-qq"]).then(
    () => console.log(`apt-get update took ${Date.now() - began} ms`),
    (err) => console.error(`apt-get update: ${err.message}`),
  );
  await Promise.race([updated, new Promise((r) => setTimeout(r, 60_000))]);
  busy = null;
  console.log("the operating system on the volume is up");
}

// Makes sure the person's account exists in the operating system: `me`,
// uid 1000, home at /home/me, with their files in it. A system that has
// the base image's node user at that id, or the files in root's home,
// is brought to that shape once.
async function person() {
  const passwd = await fs.readFile(path.join(OS_ROOT, "etc/passwd"), "utf8");
  if (!new RegExp(`^${PERSON.name}:`, "m").test(passwd)) {
    const inside = (...args) => run("chroot", [OS_ROOT, ...args]);
    const move = (await fs.stat(ROOT).catch(() => null)) ? [] : ["-m"];
    if (/^node:/m.test(passwd)) {
      await inside(
        "usermod",
        "-l",
        PERSON.name,
        "-d",
        PERSON.home,
        ...move,
        "node",
      );
      await inside("groupmod", "-n", PERSON.name, "node");
    } else
      await inside(
        "useradd",
        "-U",
        "-u",
        String(PERSON.uid),
        "-d",
        PERSON.home,
        ...move,
        "-s",
        "/bin/bash",
        PERSON.name,
      );
    await fs.mkdir(ROOT, { recursive: true });
    const root = path.join(OS_ROOT, "root");
    const untouched = async (name) =>
      fs
        .readFile(path.join(root, name))
        .then(async (a) => a.equals(await fs.readFile(`/root/${name}`)))
        .catch(() => false);
    for (const name of await fs.readdir(root).catch(() => [])) {
      if (await untouched(name)) continue;
      await fs.rm(path.join(ROOT, name), { recursive: true, force: true });
      await fs.rename(path.join(root, name), path.join(ROOT, name));
    }
    console.log("the person's files moved from root's home to theirs");
    await own(ROOT, true);
  }
  await fs.mkdir(ROOT, { recursive: true });
  await own(ROOT);
}

// A fresh operating system from the image around the home as it is: the
// home is backed up first and the reset waits for that, refusing if the
// backup did not finish, unless the app says one from the last hour
// stands; then every shell is closed, the kernel's views
// let go of, the old system set aside, and the boot's own settling makes
// the new one and brings the home over. Cut off anywhere, the next boot
// finishes it. A laptop has no system to reset.
let resetting = null;
// The last reset's outcome, kept beside the operating system so a boot
// that finished one cut off can say so.
const RESET_LOG = OS_ROOT ? path.join(MOUNT, ".reset") : null;
let lastReset = RESET_LOG ? await recall(RESET_LOG) : null;
async function resetEnded(outcome) {
  lastReset = outcome;
  if (RESET_LOG) await keep(RESET_LOG, outcome);
}
async function reset(backedUp) {
  if (!backedUp)
    await startBackup().catch((err) => {
      throw new Refused(
        409,
        `The backup before the reset failed (${err.message})`,
      );
    });
  if (!OS_ROOT)
    throw new Refused(
      409,
      "There is no system on this computer to reset: it has none of its own",
    );
  // The backup takes minutes, and a file can start landing in them: the
  // home is not taken out from under one.
  if (landings.size || restoring) throw new Refused(409, LANDING_NOW);
  busy = "Your computer's system is being reset; a minute.";
  try {
    for (const s of sessions.values()) quietly(() => s.shell.kill());
    for (const d of ["dev", "sys", "proc"])
      await run("umount", ["-l", "-R", path.join(OS_ROOT, d)]);
    await fs.rm(path.join(MOUNT, ".os-ready"), { force: true });
    await fs.rename(OS_ROOT, OLD);
  } catch (err) {
    busy = `The system could not be reset: ${err.message}. It is put right at the next boot.`;
    throw err;
  }
  // A system that will not settle within a few tries is a failed reset,
  // said as such; the next boot goes on trying.
  await settleUntilDone(5).catch((err) => {
    busy = `The system could not be reset: ${err.message}. It is put right at the next boot.`;
    throw err;
  });
}

// Tried until it works: a boot that cannot set the operating system up
// says so and tries again in a minute, rather than dying and being
// restarted into the same failure.
async function settleUntilDone(tries = Infinity) {
  for (let n = 1; ; n++) {
    try {
      return await settle();
    } catch (err) {
      console.error(
        `the operating system could not be set up: ${err.message}; again in a minute`,
      );
      if (n >= tries) throw err;
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }
}

// The daemon's death is the machine's: every shell, server and job on it
// goes with it. Nothing a client says, and nothing a spawned process
// does, is worth that, so what escapes a handler is said and survived.
process.on("uncaughtException", (err) =>
  console.error(`uncaught: ${err?.stack ?? err}`),
);
process.on("unhandledRejection", (err) =>
  console.error(`unhandled: ${err?.stack ?? err}`),
);

// A root that cannot be made, or a port that cannot be listened on, is a
// machine that cannot serve: said now, and died of, so Fly starts it over.
server.on("error", (err) => {
  console.error(`listen: ${err.message}`);
  process.exit(1);
});
if (!OS_ROOT) await fs.mkdir(ROOT, { recursive: true });
server.listen(PORT, "0.0.0.0", () =>
  console.log(`serving ${ROOT} on ${PORT} as ${FLY_MACHINE_ID}`),
);
settleUntilDone();
// A backup this machine had on its way died with the process that was
// sending it; the app is told, so another can be taken.
backupCall("abort", {}).catch((err) =>
  console.error(`backups left open: ${err.message}`),
);
await report();
setInterval(report, 5 * 60 * 1000).unref();
