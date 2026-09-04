// The computer's daemon: the volume at DATA_DIR served as a filesystem,
// a shell on it over a WebSocket, and the ports on the machine reachable
// from a browser. We list, make, move and delete under it with the
// machine's secret, put files on it from a URL, and hand a browser a
// signed download, terminal or preview. Fly sets FLY_MACHINE_ID and
// routes to us; a request that reached the wrong machine is replayed to
// the right one. It also reports on itself to us on boot and every five
// minutes: how full the disk is.
import { execFile, spawn } from "node:child_process";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import { WebSocketServer } from "ws";

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
const SHELL = process.env.SHELL_PATH ?? "/bin/bash";
// Where a backup asks us for somewhere to put each part: beside the report.
const BACKUP_URL = REPORT_URL.replace(/\/report$/, "/backup");
const PART = 64 * 1024 * 1024;

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

// A signed link names the machine, when it expires, and what it is for.
// One for another machine is replayed there; only the right machine holds
// the secret that checks it.
function signed(url, kind) {
  const m = url.pathname.match(
    /^\/(dl|term|p)\/([^/]+)\/(\d+)\/([^/]+)(?:\/(\d+))?$/,
  );
  if (!m || m[1] !== kind) return null;
  const [, , machine, expires, sig, port] = m;
  // A link past its time wakes nobody.
  if (Number(expires) < Date.now()) return { refused: true };
  if (machine !== FLY_MACHINE_ID) return { replay: machine };
  const what =
    kind === "dl"
      ? (url.searchParams.get("path") ?? "")
      : kind === "p"
        ? port
        : "term";
  if (Number(expires) < Date.now() || !same(sign(`${expires}|${what}`), sig))
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
function previewCookie(req) {
  const m = /(?:^|;\s*)mp=([^;]+)/.exec(req.headers.cookie ?? "");
  if (!m) return null;
  const [machine, expires, port, sig] = m[1].split(".");
  if (!machine || !expires || !port || !sig) return null;
  if (machine !== FLY_MACHINE_ID) return { replay: machine };
  if (Number(expires) < Date.now() || !same(sign(`${expires}|${port}`), sig))
    return null;
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
      ...(REPORT_BYPASS ? { "x-vercel-protection-bypass": REPORT_BYPASS } : {}),
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
    const tar = spawn("tar", ["-C", dir, "-xzf", "-"], {
      stdio: ["pipe", "ignore", "inherit"],
    });
    const done = new Promise((resolve, reject) =>
      tar.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)),
      ),
    );
    await pipeline(Readable.fromWeb(res.body), tar.stdin);
    await done;
    await exclusive(async () => {
      const have = new Set(await fs.readdir(ROOT));
      if (visible([...have]).length)
        throw new Refused(409, "the disk is not empty");
      // A dotfile the disk already has is kept; the archive's copy is not
      // written over it.
      for (const name of await fs.readdir(dir))
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
      res.writeHead(answer.statusCode, answer.headers);
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

  // A browser's download, by a signed link.
  const dl = signed(url, "dl");
  if (dl) {
    if (dl.replay) return replay(dl.replay);
    if (dl.refused) return json(403, { error: "no" });
    const abs = under(dl.what);
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

  // A browser's preview of a port: the signed link sets the cookie and
  // sends the browser to the root, and everything with the cookie that is
  // not ours goes to that port.
  const pv = signed(url, "p");
  if (pv) {
    if (pv.replay) return replay(pv.replay);
    if (pv.refused) return json(403, { error: "no" });
    const [, , , expires, sig] = url.pathname.split("/");
    res.writeHead(302, {
      "set-cookie": `mp=${FLY_MACHINE_ID}.${expires}.${pv.port}.${sig}; Path=/; SameSite=Lax; HttpOnly`,
      location: "/",
    });
    return res.end();
  }
  if (req.headers.authorization !== `Bearer ${COMPUTER_SECRET}`)
    return json(401, { error: "no" });

  if (url.pathname === "/fs/ports" && req.method === "GET")
    return json(200, { ports: await listening() });
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
  if (url.pathname === "/fs/restore" && req.method === "POST") {
    const b = await readJson(req);
    if (typeof b.url !== "string") return json(400, { error: "a url" });
    await restore(b.url);
    return json(200, { ok: true, disk: await disk() });
  }

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
shells.on("connection", (ws) => {
  let shell;
  try {
    shell = pty.spawn(SHELL, ["-l"], {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: ROOT,
      env: { ...process.env, HOME: ROOT, TERM: "xterm-256color" },
    });
  } catch (err) {
    console.error(`no shell: ${err.message}`);
    return ws.close(1011, "The shell could not start.");
  }
  shell.onData((data) => ws.readyState === ws.OPEN && ws.send(data));
  shell.onExit(() => ws.close());
  ws.on("message", (data, isBinary) => {
    if (isBinary) return shell.write(data.toString());
    try {
      const { resize } = JSON.parse(data.toString());
      if (resize) shell.resize(resize[0], resize[1]);
    } catch {}
  });
  ws.on("close", () => shell.kill());
});

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
  const term = signed(url, "term");
  if (term) {
    if (term.replay) return replay(term.replay);
    if (term.refused) return refuse(403, "Forbidden");
    if (!pty) return refuse(501, "No terminal on this machine");
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

await fs.mkdir(ROOT, { recursive: true });
server.listen(PORT, "0.0.0.0", () =>
  console.log(`serving ${ROOT} on ${PORT} as ${FLY_MACHINE_ID}`),
);
await report();
setInterval(report, 5 * 60 * 1000).unref();
