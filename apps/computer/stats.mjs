// What the machine says of itself when our server asks: CPU over the
// last moment, memory, the bytes the person's Linux and home take, the
// disk's size, and the ports listening inside with what listens. Read
// from the kernel, outside the person's Linux, which shares its view.
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { readdir, readFile, readlink, statfs } from "node:fs/promises";

const OS = "/data/os";
const HOME = "/data/home";
const OURS = new Set([22, 8080, 8082]);

// CPU: the share of ticks not idle between two readings, two seconds apart.
let cpu = 0;
let last = null;
function ticks() {
  const [, ...n] = fs
    .readFileSync("/proc/stat", "utf8")
    .split("\n")[0]
    .trim()
    .split(/\s+/);
  const all = n.reduce((a, b) => a + Number(b), 0);
  return { all, idle: Number(n[3]) + Number(n[4]) };
}
setInterval(() => {
  const now = ticks();
  if (last && now.all > last.all)
    cpu = Math.round((1 - (now.idle - last.idle) / (now.all - last.all)) * 100);
  last = now;
}, 2000).unref();

function memory() {
  const kb = {};
  for (const line of fs.readFileSync("/proc/meminfo", "utf8").split("\n")) {
    const [k, v] = line.split(":");
    if (v) kb[k] = Number(v.trim().split(" ")[0]) * 1024;
  }
  return { used: kb.MemTotal - kb.MemAvailable, total: kb.MemTotal };
}

// The bytes the person holds, measured behind the door every minute so an
// ask never waits on a walk of the disk. One file system only, so the
// kernel's views and ours, bound into their Linux, are not counted, and
// home is counted once, not again where it is bound inside.
// Unknown until the first walk finishes; what the disk holds, not what
// files claim, so a sparse file counts for the space it takes.
let used = null;
// One walk at a time, and one that has not finished in fifty seconds is
// given up on, so a huge home never piles walks on top of each other.
let walking = null;
function measure() {
  if (walking) return;
  walking = execFile(
    "du",
    ["-sx", "--block-size=1", `--exclude=${OS}/home`, OS, HOME],
    { timeout: 50_000 },
    (err, out) => {
      walking = null;
      // A walk that failed says nothing; the last whole count stands.
      if (err) return;
      used = out
        .split("\n")
        .map((l) => Number(l.split("\t")[0]) || 0)
        .reduce((a, b) => a + b, 0);
    },
  );
}
measure();
setInterval(measure, 60_000).unref();

// The face a thing serving on a port wears, for the dock to draw: its own
// favicon, as an address that carries the picture with it. Kept against the
// process serving there, and asked for again where it did not answer, since
// a server still starting up has no face to give yet. Nothing waits on it.
const FACE_TYPES =
  /^image\/(png|jpe?g|gif|webp|svg\+xml|x-icon|vnd\.microsoft\.icon)$/;
const BIGGEST_FACE = 16 * 1024;
const BIGGEST_PAGE = 64 * 1024;
const ASK_AGAIN = 60_000;
const faces = new Map();

// One read of an address on the port, given this long and this much and
// no more; what came, with its type, or nothing.
function read(port, path, most, then) {
  const req = http.get({ host: "127.0.0.1", port, path }, (res) => {
    const type = (res.headers["content-type"] ?? "").split(";")[0].trim();
    if (res.statusCode !== 200) {
      req.destroy();
      return then(null);
    }
    const bits = [];
    let held = 0;
    res.on("data", (d) => {
      held += d.length;
      if (held > most) return req.destroy();
      bits.push(d);
    });
    res.on("end", () => then({ type, body: Buffer.concat(bits) }));
  });
  req.on("error", () => then(null));
  // A port that answers slowly, or a byte at a time, is given this long
  // and no longer.
  setTimeout(() => req.destroy(), 2000).unref();
}

// Where a page says its icon is: the first link that calls itself an
// icon, made whole against the port's root.
function iconOf(html, port) {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel=["']?[^"'>]*\bicon\b/i.test(tag)) continue;
    const href = /\bhref=["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href) continue;
    try {
      const url = new URL(href, `http://127.0.0.1:${port}/`);
      if (url.hostname === "127.0.0.1" || url.hostname === "localhost")
        return url.pathname + url.search;
    } catch {}
  }
  return null;
}

function ask(port, key) {
  faces.set(key, { face: null, at: Date.now() });
  const done = (face) => faces.set(key, { face, at: Date.now() });
  const take = (got) => {
    if (!got || !FACE_TYPES.test(got.type) || !got.body.length) return false;
    done(`data:${got.type};base64,${got.body.toString("base64")}`);
    return true;
  };
  read(port, "/favicon.ico", BIGGEST_FACE, (got) => {
    if (take(got)) return;
    // The page itself may say where its face is.
    read(port, "/", BIGGEST_PAGE, (page) => {
      if (!page || !/^text\/html$/.test(page.type)) return;
      const path = iconOf(page.body.toString("utf8"), port);
      if (path && path !== "/favicon.ico")
        read(port, path, BIGGEST_FACE, (icon) => void take(icon));
    });
  });
}

// The face known for the process serving there, asked for when it is new
// or when the last ask came back with nothing. Answers at once.
function face(port, pid) {
  const key = `${port}:${pid}`;
  const had = faces.get(key);
  if (!had || (!had.face && Date.now() - had.at > ASK_AGAIN)) ask(port, key);
  return faces.get(key)?.face ?? undefined;
}

// Listening TCP ports, with the name of what listens: socket inode to pid
// through every process's open files, pid to its name. Every read waits
// its turn rather than holding the door, and the walk stops once every
// listener is named.
async function ports() {
  const listening = new Map();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const line of text.split("\n").slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 10 || f[3] !== "0A") continue;
      const port = parseInt(f[1].split(":").pop(), 16);
      if (!OURS.has(port)) listening.set(f[9], port);
    }
  }
  const out = [];
  const pids = (await readdir("/proc")).filter((d) => /^\d+$/.test(d));
  for (const pid of pids) {
    if (!listening.size) break;
    let fds;
    try {
      fds = await readdir(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let link;
      try {
        link = await readlink(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const m = /^socket:\[(\d+)\]$/.exec(link);
      if (!m || !listening.has(m[1])) continue;
      const port = listening.get(m[1]);
      listening.delete(m[1]);
      // Ours and Claude Code's own listeners are not a port the person
      // opened; they are left off the list.
      const cmd = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(
        () => "",
      );
      if (/\/opt\/maslow\//.test(cmd)) continue;
      const name = await readFile(`/proc/${pid}/comm`, "utf8").catch(() => "");
      if (name.trim() === "claude") continue;
      // What started it, not merely what it is: a dev server and a database
      // are both `node` and only the command tells them apart. The
      // arguments arrive separated by nothing, as the kernel keeps them.
      const ran = cmd.replace(/\0+$/, "").split("\0").join(" ").slice(0, 120);
      out.push({ port, pid, name: name.trim(), ran });
    }
  }
  // What is no longer serving keeps no face here.
  const here = new Set(out.map((o) => `${o.port}:${o.pid}`));
  for (const key of faces.keys()) if (!here.has(key)) faces.delete(key);
  return out
    .map(({ pid, ...o }) => ({ ...o, face: face(o.port, pid) }))
    .sort((a, b) => a.port - b.port);
}

// Whose credentials Claude Code runs on here: managed while the machine
// holds a key of ours and the person has not chosen their own; own
// otherwise; none when the machine holds no key at all.
async function auth() {
  if (!process.env.MODEL_KEY) return "none";
  const choice = await readFile(`${HOME}/.config/maslow/auth`, "utf8").catch(
    () => "managed",
  );
  return choice.trim() === "own" ? "own" : "managed";
}

export async function stats() {
  const disk = await statfs("/data").catch(() => null);
  return {
    auth: await auth(),
    cpu,
    memory: memory(),
    used,
    disk: disk ? disk.blocks * disk.bsize : null,
    // What the whole disk still has room for, the person's and ours alike.
    free: disk ? disk.bavail * disk.bsize : null,
    ports: await ports(),
  };
}
