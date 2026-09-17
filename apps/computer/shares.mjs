// What the person shared from their home, by id: a file or a folder marked
// on the disk with an extended attribute so a move or a rename keeps it,
// and followed by the door. Each is listed, read, written and copied by
// its id and a path under it; every path is confined to the thing shared,
// and no link inside it is ever followed out.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  HOME,
  OWNER,
  inside,
  json,
  list,
  pdf,
  preview,
  read,
  say,
  write,
} from "./files.mjs";

const run = promisify(execFile);

// The mark a shared thing wears on the disk, and where the door keeps
// which id sits at which path, outside the person's Linux.
const XATTR = "user.maslow.id";
const INDEX = path.join(path.dirname(HOME), ".shares.json");

// How long a shared thing may be out of its place before it is gone: a
// program that saves by remaking the file has the new one in place within
// this, and nothing a person does by hand is that quick.
const SETTLE = 2_000;

// How many entries a search of the home for a moved thing looks at, and
// how long it takes, before giving up.
const FIND_CAP = 300_000;
const FIND_MS = 20_000;

// A walk of a shared folder stops here, so a copy of it never runs away.
const MOST_FILES = 10_000;

// The index: id → { path, kind, ino, gone? }, with paths relative to the
// home and the inode the mark was last put on.
let shares = indexWas();
// The index as the door left it: none yet is empty; one that cannot be
// read is said loudly and set aside under another name, never read as
// empty in silence, so what it held can be looked at.
function indexWas() {
  if (!fs.existsSync(INDEX)) return {};
  try {
    const i = JSON.parse(fs.readFileSync(INDEX, "utf8"));
    if (i && typeof i === "object") return i;
    throw new Error("not an index");
  } catch (err) {
    console.error(`shares: ${INDEX} could not be read: ${err.message}`);
    fs.renameSync(INDEX, `${INDEX}.unread-${Date.now()}`);
    return {};
  }
}
// The index written whole, beside and then into place; a write that
// fails fails the ask that changed it, so the door never carries on with
// an index the disk does not have.
const indexIs = () => {
  const tmp = `${INDEX}.writing`;
  fs.writeFileSync(tmp, JSON.stringify(shares));
  fs.renameSync(tmp, INDEX);
};

// The id a file wears, or null.
async function markOf(at) {
  const { stdout } = await run("python3", [
    "-c",
    `import os,sys
try: print(os.getxattr(sys.argv[1], sys.argv[2], follow_symlinks=False).decode())
except OSError: pass`,
    at,
    XATTR,
  ]);
  return stdout.trim() || null;
}
// Marks a file with an id, and says so when it could not: the file is
// still the thing, known by its inode, and the mark is put back at the
// next look.
export const marked = (at, id) =>
  mark(at, id).catch((err) =>
    console.error(`shares: could not mark ${at} as ${id}: ${err.message}`),
  );
// Marks a file with an id.
export const mark = (at, id) =>
  run("python3", [
    "-c",
    "import os,sys; os.setxattr(sys.argv[1], sys.argv[2], sys.argv[3].encode(), follow_symlinks=False)",
    at,
    XATTR,
    id,
  ]);

// Where in the home the thing with this inode now is; null when the
// whole home was walked and it is nowhere; undefined when the walk could
// not finish, which says nothing. The inode is the thing itself, never a
// copy of it, which wears the mark too but is another file; a file of
// that inode wearing another id is passed over.
async function findMarked(id, ino) {
  try {
    const { stdout } = await run(
      "python3",
      [
        "-c",
        `import os,sys
root, want, cap, ino = sys.argv[1], sys.argv[3].encode(), int(sys.argv[4]), int(sys.argv[5])
n = 0
for d, dirs, files in os.walk(root):
  for name in dirs + files:
    n += 1
    if n > cap: print("?"); sys.exit(0)
    p = os.path.join(d, name)
    try:
      if os.lstat(p).st_ino != ino: continue
      try: worn = os.getxattr(p, sys.argv[2], follow_symlinks=False)
      except OSError: worn = None
      if worn is None or worn == want:
        print(os.path.relpath(p, root)); sys.exit(0)
    except OSError: pass`,
        HOME,
        XATTR,
        id,
        String(FIND_CAP),
        String(ino),
      ],
      { timeout: FIND_MS },
    );
    const said = stdout.trim();
    if (said === "?") console.error(`shares: the search for ${id} hit its cap`);
    return said === "?" ? undefined : said || null;
  } catch (err) {
    console.error(`shares: the search for ${id} failed: ${err.message}`);
    return undefined;
  }
}

// What kind of thing a shared one is; a link or anything else is not
// shared at all.
const kindOf = (s) => (s.isDirectory() ? "dir" : s.isFile() ? "file" : null);

// The id at a path in the home, if it is shared, for a listing to say so.
export const idAt = (rel) =>
  Object.keys(shares).find(
    (id) => shares[id].path === rel && !shares[id].gone,
  ) ?? null;

// What carries a shared file's mark onto the file a write makes in its
// place, for the door's own writes; null where the path is not a shared
// file.
export const carrier = (rel) => {
  const id = idAt(rel);
  return id ? (tmp) => marked(tmp, id) : null;
};

// The door watches the folder each shared thing stands in, so it sees the
// thing go and come as it happens: gone and back within a moment is a
// program saving it, and the new file is marked and followed; gone for
// longer is looked for where it went, and found nowhere, it is gone for
// good. One watcher per folder, however many shared things are in it.
const watchers = new Map();
// The wait after a thing was seen missing, before it is called moved or
// gone.
const settling = new Map();

function watching(rel) {
  const dir = path.dirname(rel);
  if (watchers.has(dir)) return;
  let w;
  try {
    w = fs.watch(path.join(HOME, dir), (_, name) => {
      if (!name) return;
      const at = dir === "." ? name : `${dir}/${name}`;
      for (const id of Object.keys(shares))
        if (shares[id].path === at && !shares[id].gone)
          moved(id).catch((err) =>
            console.error(`shares: ${id}: ${err.message}`),
          );
    });
  } catch (err) {
    console.error(`shares: cannot watch ${dir}: ${err.message}`);
    return;
  }
  w.on("error", (err) => {
    console.error(`shares: the watch on ${dir} ended: ${err.message}`);
    watchers.delete(dir);
  });
  watchers.set(dir, w);
}
function unwatched(rel) {
  const dir = path.dirname(rel);
  if (
    Object.values(shares).some((e) => path.dirname(e.path) === dir && !e.gone)
  )
    return;
  watchers.get(dir)?.close();
  watchers.delete(dir);
}

// What stands at a shared thing's place, if it is a file or folder of
// the home: reached through a link out of the home, it is not the thing.
async function standing(e) {
  const at = path.join(HOME, e.path);
  const s = await fsp.lstat(at).catch(() => null);
  if (!s || kindOf(s) !== e.kind) return null;
  const real = await fsp.realpath(at).catch(() => null);
  const home = await fsp.realpath(HOME).catch(() => HOME);
  return real && real.startsWith(`${home}/`) ? s : null;
}

// Something happened at a shared thing's place. Still there and the same
// inode: a change, nothing to do. There with a fresh inode: a save by
// remaking it, marked again. Not there: a moment's wait, then the search.
async function moved(id) {
  const e = shares[id];
  if (!e || e.gone) return;
  const at = path.join(HOME, e.path);
  const s = await standing(e);
  if (s) {
    clearTimeout(settling.get(id));
    settling.delete(id);
    if (s.ino !== e.ino) {
      await marked(at, id);
      e.ino = s.ino;
      indexIs();
    }
    return;
  }
  if (settling.has(id)) return;
  settling.set(
    id,
    setTimeout(() => {
      settling.delete(id);
      settled(id).catch((err) =>
        console.error(`shares: ${id}: ${err.message}`),
      );
    }, SETTLE),
  );
}

// A shared thing missing from its place for a moment: followed to where
// its inode went, or gone.
async function settled(id) {
  const e = shares[id];
  if (!e || e.gone) return;
  if (await standing(e)) return moved(id);
  const found = await findMarked(id, e.ino);
  const was = e.path;
  if (found) {
    e.path = found;
    indexIs();
    watching(found);
    unwatched(was);
    return;
  }
  // A walk that could not finish proves nothing: the thing stays as it
  // was, missing for now, and the next look tries again.
  if (found === undefined) return;
  e.gone = true;
  indexIs();
  unwatched(was);
}

// Marks a thing in the home with the id given and keeps where it is. A
// path already shared keeps its id, whatever was asked. Answers the id,
// the name and the kind.
async function share(req, res, url, id) {
  const at = inside(url.searchParams.get("path") ?? "");
  if (!at || at === HOME) return say(res, 403, "That is not in your home.");
  if (typeof id !== "string" || !/^[0-9a-z]{4,32}$/.test(id))
    return say(res, 400, "A share names its id.");
  const s = await fsp.lstat(at).catch(() => null);
  const kind = s && kindOf(s);
  if (!kind) return say(res, 400, "Only a file or a folder is shared.");
  const rel = path.relative(HOME, at);
  const name = path.basename(at);
  const had = idAt(rel);
  if (had) return json(res, 200, { id: had, name, kind, had: true });
  // A shared thing moved and shared again from where it is now keeps its
  // id: the mark it wears is one the door knows.
  const worn = await markOf(at).catch(() => null);
  if (
    worn &&
    shares[worn] &&
    !shares[worn].gone &&
    shares[worn].ino === s.ino
  ) {
    const was = shares[worn].path;
    shares[worn] = { path: rel, kind, ino: s.ino };
    indexIs();
    watching(rel);
    unwatched(was);
    return json(res, 200, { id: worn, name, kind, had: true });
  }
  try {
    await mark(at, id);
  } catch (err) {
    return say(res, 500, `Could not mark it: ${err.message}`);
  }
  shares[id] = { path: rel, kind, ino: s.ino };
  indexIs();
  watching(rel);
  json(res, 200, { id, name, kind, had: false });
}

// Forgets an id: the share ended. The mark stays and means nothing.
function forget(res, id) {
  const was = shares[id]?.path;
  delete shares[id];
  indexIs();
  if (was) unwatched(was);
  say(res, 200, "forgotten");
}

// Where a shared thing is now, or that it is gone. The watcher keeps the
// index right as things happen; a look while a save is mid-way waits the
// moment out, and one after the door was away looks for the thing
// itself, so nothing is called gone that only moved.
async function where(id) {
  const e = shares[id];
  if (!e) return null;
  if (e.gone) return { gone: true };
  const at = () => path.join(HOME, e.path);
  const there = () => standing(e);
  let s = await there();
  if (!s) {
    await new Promise((r) => setTimeout(r, SETTLE));
    s = await there();
    if (!s) {
      clearTimeout(settling.get(id));
      settling.delete(id);
      await settled(id);
      if (e.gone) return { gone: true };
      s = await there();
      if (!s) return { missing: true };
    }
  }
  if (s.ino !== e.ino) {
    await marked(at(), id);
    e.ino = s.ino;
    indexIs();
  }
  return { at: at(), rel: e.path, kind: e.kind, stat: s };
}

// Every shared thing watched from the start, so the door coming back
// sees what happens next.
for (const e of Object.values(shares)) if (!e.gone) watching(e.path);

// A path under a shared thing, confined to it: nothing above it, and the
// nearest folder that exists, followed through any link, still under it.
function under(root, sub) {
  if (typeof sub !== "string" || sub.includes("\0")) return null;
  const at = path.resolve(root, sub);
  if (at !== root && !at.startsWith(`${root}/`)) return null;
  let probe = at;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  const top = fs.realpathSync(root);
  if (real !== top && !real.startsWith(`${top}/`)) return null;
  return at;
}

// What a shared thing is now, or one file under it: its name, kind, size
// and last change; or that the thing is missing for now, or gone.
async function stat(res, id, sub) {
  const here = await where(id);
  if (!here) return say(res, 404, "Nothing is shared by that id.");
  if (!here.at) return json(res, 200, here);
  let { at, kind, stat: s } = here;
  if (sub) {
    at = under(here.at, sub);
    if (!at) return say(res, 403, "That is not under what was shared.");
    s = await fsp.lstat(at).catch(() => null);
    kind = s && kindOf(s);
    if (!kind) return say(res, 404, "Nothing is there.");
  }
  json(res, 200, {
    name: path.basename(at),
    kind,
    size: s.size,
    modified: s.mtime.toISOString(),
  });
}

// Every file under a shared thing, by its path there, with its size and
// last change: what a copy of it holds. A file is one entry at "". Links
// are left out, and a folder past the cap is answered as far as it got,
// saying so.
async function files(res, id) {
  const here = await where(id);
  if (!here) return say(res, 404, "Nothing is shared by that id.");
  if (!here.at) return json(res, 200, here);
  const out = [];
  let more = false;
  const walk = async (abs, rel) => {
    if (more) return;
    let entries;
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch (err) {
      console.error(`shares: cannot read ${abs} for ${id}: ${err.message}`);
      return;
    }
    for (const d of entries) {
      if (out.length >= MOST_FILES) {
        more = true;
        return;
      }
      const sub = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) await walk(path.join(abs, d.name), sub);
      else if (d.isFile()) {
        const s = await fsp.lstat(path.join(abs, d.name)).catch(() => null);
        if (s)
          out.push({
            path: sub,
            size: s.size,
            modified: s.mtime.toISOString(),
          });
      }
    }
  };
  if (here.kind === "dir") await walk(here.at, "");
  else
    out.push({
      path: "",
      size: here.stat.size,
      modified: here.stat.mtime.toISOString(),
    });
  json(res, 200, { files: out, more });
}

// Where a file being taken lands first: a folder of ours beside the home
// on the same disk, where nothing of the person's can put a link, and
// from there into place in one move.
const TAKING = path.join(path.dirname(HOME), "taking");

// Fetches one file of a copy onto the disk, from an address signed for
// it: a colleague's save, taken as the owner's file, and dated when the
// copy says it changed, so the disk and the copy agree. Fetched outside
// the home and moved into place, so nothing lands half-written and
// nothing in the home can steer the write.
async function take(req, res, at, ask) {
  if (typeof ask?.url !== "string" || !/^https:\/\//.test(ask.url))
    return say(res, 400, "A take names the address.");
  await fsp.mkdir(TAKING, { recursive: true, mode: 0o700 });
  const tmp = path.join(TAKING, createHash("sha1").update(at).digest("hex"));
  try {
    await fsp.rm(tmp, { force: true });
    await fsp.mkdir(path.dirname(at), { recursive: true });
    await run(
      "curl",
      [
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "3600",
        "-o",
        tmp,
        ask.url,
      ],
      { maxBuffer: 1 << 20 },
    );
    await fsp.chown(tmp, OWNER, OWNER).catch(() => {});
    // Into place over a file, never through a link left there, keeping
    // the mode it had so a script stays a script. A file saved since the
    // copy was made is newer than the copy, and the copy is refused: the
    // last save is the file.
    const was = await fsp.lstat(at).catch(() => null);
    if (was && !was.isFile()) throw new Error("something else is there");
    const dated = new Date(ask.modified ?? NaN);
    if (was && !Number.isNaN(dated.getTime()) && was.mtime > dated) {
      await fsp.rm(tmp, { force: true });
      return json(res, 409, { modified: was.mtime.toISOString() });
    }
    await fsp.chmod(tmp, was ? was.mode & 0o7777 : 0o644);
    // A shared file taken whole keeps its mark on the file put in its
    // place.
    const carry = carrier(path.relative(HOME, at));
    if (carry) await carry(tmp);
    if (!Number.isNaN(dated.getTime())) await fsp.utimes(tmp, dated, dated);
    await fsp.rename(tmp, at);
    const s = await fsp.stat(at);
    json(res, 200, { size: s.size, modified: s.mtime.toISOString() });
  } catch (err) {
    await fsp.rm(tmp, { force: true });
    say(res, 500, `Could not take it: ${err.message}`);
  }
}

// Sends files of a shared thing to addresses signed for them, a few at a
// time, and answers which landed and which did not.
async function mirror(res, root, ask) {
  if (!Array.isArray(ask?.puts))
    return say(res, 400, "A mirror names what to send where.");
  const done = [];
  const failed = [];
  const queue = [...ask.puts];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const at = under(root, p.path ?? "");
      if (!at || typeof p.url !== "string") {
        failed.push({ path: p.path, error: "not under it" });
        continue;
      }
      try {
        await run(
          "curl",
          [
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            "3600",
            "-X",
            "PUT",
            "--upload-file",
            at,
            p.url,
          ],
          { maxBuffer: 1 << 20 },
        );
        done.push(p.path);
      } catch (err) {
        failed.push({ path: p.path, error: err.message });
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  json(res, 200, { done, failed });
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const bodyOf = (req) =>
  new Promise((resolve) => {
    let text = "";
    req.on("data", (c) => (text += c));
    req.on("end", () => resolve(text));
  });

// Answers one ask about a shared thing. The path after /maslow/files/shared
// is the id and what to do with it; `path` in the query is under the
// thing. What fails on the way, an index that could not be kept above
// all, is said in the answer and never swallowed.
export async function serve(req, res, url) {
  try {
    await answer(req, res, url);
  } catch (err) {
    console.error(`shares: ${url.pathname}: ${err.message}`);
    if (!res.headersSent) say(res, 500, `Could not do that: ${err.message}`);
    else res.destroy();
  }
}

async function answer(req, res, url) {
  const [, id = "", what = ""] =
    /^\/maslow\/files\/shared(?:\/([^/]+))?(\/.*)?$/.exec(url.pathname) ?? [];
  if (!id && req.method === "POST") {
    const ask = parse(await bodyOf(req));
    return share(req, res, url, ask?.id);
  }
  if (id && what === "" && req.method === "DELETE") return forget(res, id);
  if (id && what === "" && req.method === "GET")
    return stat(res, id, url.searchParams.get("path"));
  if (id && what === "/files" && req.method === "GET") return files(res, id);
  const here = await where(id);
  if (!here) return say(res, 404, "Nothing is shared by that id.");
  if (here.gone) return say(res, 410, "That is gone.");
  if (!here.at) return say(res, 404, "That is not on the disk right now.");
  if (what === "/mirror" && req.method === "POST")
    return mirror(res, here.at, parse(await bodyOf(req)));
  const at = under(here.at, url.searchParams.get("path") ?? "");
  if (!at) return say(res, 403, "That is not under what was shared.");
  if (what === "/list" && req.method === "GET") return list(res, at);
  if (what === "/read" && req.method === "GET") return read(req, res, at);
  if (what === "/preview" && req.method === "GET") return preview(res, at);
  if (what === "/pdf" && req.method === "GET") return pdf(res, at);
  if (what === "/write" && req.method === "PUT")
    return write(
      req,
      res,
      at,
      false,
      url.searchParams.get("opened"),
      carrier(path.relative(HOME, at)),
    );
  if (what === "/take" && req.method === "POST")
    return take(req, res, at, parse(await bodyOf(req)));
  say(res, 404, "Nothing of the shared files is there.");
}
