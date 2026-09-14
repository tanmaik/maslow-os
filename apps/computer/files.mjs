// The person's home through the door: what is in a folder, a file read
// whole or in part, a small picture of a file, a file written, and an
// upload that arrives in pieces at an offset and is put together on the
// disk, never held in memory. Every path is confined to the home,
// whatever it says.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";

import ffmpeg from "@ffmpeg-installer/ffmpeg";
import sharp from "sharp";

const run = promisify(execFile);

// Where the home is from outside the person's Linux, and whose it is.
const HOME = process.env.HOME_DIR ?? "/data/home";
const OWNER = 1000;

// Where pictures of files are kept once made: on the machine, not the
// disk, so they cost the person nothing and are made again after a
// restart.
const PREVIEWS = "/tmp/maslow-previews";
// A picture is at most this wide or tall.
const PREVIEW_PX = 1280;

const PICTURES = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "avif",
  "heic",
  "tif",
  "tiff",
  "bmp",
]);
const VIDEOS = new Set(["mp4", "m4v", "mov", "webm", "mkv", "avi"]);
// Documents a word processor, a spreadsheet or a slide deck made. They
// are shown as their first page, through a PDF.
const DOCUMENTS = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "rtf",
]);
// LibreOffice, ours, under /opt/maslow: it turns a document into a PDF.
const OFFICE = "/opt/maslow/office/usr/lib/libreoffice/program/soffice";
const OFFICE_LIBS = [
  "/opt/maslow/office/usr/lib/libreoffice/program",
  "/opt/maslow/office/usr/lib/x86_64-linux-gnu",
  "/opt/maslow/office/usr/lib",
].join(":");
const ending = (at) => path.extname(at).slice(1).toLowerCase();

// The place a path names inside the home, or null when it would leave it:
// no way up, nothing absolute, and the nearest folder that exists, followed
// through any link, is still the home or under it.
export function inside(rel) {
  if (typeof rel !== "string" || rel.includes("\0")) return null;
  const at = path.resolve(HOME, rel);
  if (at !== HOME && !at.startsWith(`${HOME}/`)) return null;
  let probe = at;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  const real = fs.realpathSync(probe);
  if (real !== HOME && !real.startsWith(`${HOME}/`)) return null;
  return at;
}

// Where the person's Linux keeps their home, which is the door's home
// bound in under another name.
const THEIRS = "/home/me";

// What a path named from inside the person's Linux is called in the home,
// or null when it is not in their home at all: what a program on the
// machine hands the door is `/home/me/…`, and Files speaks in names under
// the home.
export function within(abs) {
  if (typeof abs !== "string" || abs.includes("\0")) return null;
  const at = path.resolve(abs);
  const under = (root) =>
    at === root
      ? ""
      : at.startsWith(`${root}/`)
        ? at.slice(root.length + 1)
        : null;
  const rel = under(THEIRS) ?? under(HOME);
  return rel === null || inside(rel) === null ? null : rel;
}

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const say = (res, status, text) => {
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(text);
};

// What kind of thing an entry is, in one word.
const kindOf = (d) =>
  d.isDirectory()
    ? "dir"
    : d.isFile()
      ? "file"
      : d.isSymbolicLink()
        ? "link"
        : "other";

// The folder's entries, folders first, then by name.
async function list(res, at) {
  let entries;
  try {
    entries = await fsp.readdir(at, { withFileTypes: true });
  } catch (err) {
    return say(res, err.code === "ENOENT" ? 404 : 400, "No such folder.");
  }
  const out = [];
  for (const d of entries) {
    const s = await fsp.lstat(path.join(at, d.name)).catch(() => null);
    if (!s) continue;
    out.push({
      name: d.name,
      kind: kindOf(d),
      size: s.size,
      modified: s.mtime.toISOString(),
    });
  }
  out.sort((a, b) =>
    a.kind === b.kind
      ? a.name.localeCompare(b.name)
      : a.kind === "dir"
        ? -1
        : b.kind === "dir"
          ? 1
          : a.name.localeCompare(b.name),
  );
  json(res, 200, out);
}

// The file's bytes as they are, with their length, so a browser can save
// or show it and a phone can stop early.
// A file's bytes, whole, or the part a Range asks for so a video can be
// played from the middle.
async function read(req, res, at) {
  let s;
  try {
    s = await fsp.stat(at);
  } catch {
    return say(res, 404, "No such file.");
  }
  if (!s.isFile()) return say(res, 400, "That is not a file.");
  const head = {
    "content-type": "application/octet-stream",
    "accept-ranges": "bytes",
    "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(at))}`,
  };
  if (s.size === 0) {
    res.writeHead(200, { ...head, "content-length": 0 });
    return res.end();
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  let from = 0;
  let to = s.size - 1;
  if (range && s.size > 0) {
    if (range[1] === "" && range[2] === "")
      return say(res, 416, "Which bytes?");
    if (range[1] === "") from = Math.max(0, s.size - Number(range[2]));
    else {
      from = Number(range[1]);
      if (range[2] !== "") to = Math.min(to, Number(range[2]));
    }
    if (from > to || from >= s.size) {
      res.writeHead(416, { "content-range": `bytes */${s.size}` });
      return res.end();
    }
    res.writeHead(206, {
      ...head,
      "content-range": `bytes ${from}-${to}/${s.size}`,
      "content-length": to - from + 1,
    });
  } else res.writeHead(200, { ...head, "content-length": s.size });
  const stream = fs.createReadStream(at, { start: from, end: to });
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

// A small picture of a file, as a JPEG: a photo scaled down and turned the
// way its camera held it, the frame a second into a video, the first page
// of a PDF. Made once per version of the file and kept on the machine.
// Anything else has no picture.
async function preview(res, at) {
  let s;
  try {
    s = await fsp.stat(at);
  } catch {
    return say(res, 404, "No such file.");
  }
  if (!s.isFile()) return say(res, 400, "That is not a file.");
  const kind = ending(at);
  const how = PICTURES.has(kind)
    ? "picture"
    : VIDEOS.has(kind)
      ? "video"
      : kind === "pdf"
        ? "pdf"
        : DOCUMENTS.has(kind)
          ? "document"
          : null;
  if (!how) return say(res, 404, "No picture of that.");
  const key = createHash("sha1")
    .update(`${at}|${s.mtimeMs}|${s.size}`)
    .digest("hex");
  const kept = path.join(PREVIEWS, `${key}.jpg`);
  if (!fs.existsSync(kept)) {
    await fsp.mkdir(PREVIEWS, { recursive: true });
    // The half-made picture carries the ending it will have: ffmpeg reads
    // the format from it, and pdftoppm adds it to the stem itself.
    const making = `${kept}.making.jpg`;
    try {
      if (how === "picture") {
        await sharp(at, { failOn: "none" })
          .rotate()
          .resize(PREVIEW_PX, PREVIEW_PX, {
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({ quality: 82 })
          .toFile(making);
      } else if (how === "video") {
        await run(
          ffmpeg.path,
          [
            "-y",
            "-loglevel",
            "error",
            "-ss",
            "1",
            "-i",
            at,
            "-frames:v",
            "1",
            "-vf",
            `scale='min(${PREVIEW_PX},iw)':-2`,
            "-q:v",
            "3",
            making,
          ],
          { timeout: 30_000 },
        );
      } else {
        // A document becomes a PDF of its own first, in a folder that
        // dies with the picture; LibreOffice needs somewhere of its own
        // to keep its profile, and that is ours too.
        let pdf = at;
        if (how === "document") {
          const room = `${making}.office`;
          await fsp.mkdir(room, { recursive: true });
          await run(
            OFFICE,
            [
              "--headless",
              "--norestore",
              `-env:UserInstallation=file://${room}/profile`,
              "--convert-to",
              "pdf",
              "--outdir",
              room,
              at,
            ],
            {
              timeout: 120_000,
              env: {
                ...process.env,
                HOME: room,
                LD_LIBRARY_PATH: OFFICE_LIBS,
              },
            },
          );
          pdf = path.join(room, `${path.basename(at, path.extname(at))}.pdf`);
        }
        await run(
          "pdftoppm",
          [
            "-jpeg",
            "-r",
            "110",
            "-f",
            "1",
            "-l",
            "1",
            "-singlefile",
            "-scale-to",
            String(PREVIEW_PX),
            pdf,
            making.replace(/\.jpg$/, ""),
          ],
          { timeout: 30_000 },
        );
        await fsp.rm(`${making}.office`, { recursive: true, force: true });
      }
      await fsp.rename(making, kept);
    } catch (err) {
      await fsp.rm(making, { force: true });
      await fsp.rm(`${making}.office`, { recursive: true, force: true });
      return say(res, 500, `Could not picture it: ${err.message}`);
    }
  }
  res.writeHead(200, {
    "content-type": "image/jpeg",
    "content-length": (await fsp.stat(kept)).size,
    "cache-control": "private, max-age=3600",
  });
  const stream = fs.createReadStream(kept);
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

// Makes the folder a file goes in, as the person.
async function folderFor(at) {
  const dir = path.dirname(at);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.chown(dir, OWNER, OWNER).catch(() => {});
}

// A file made fresh beside its final place, exclusively and never through
// a link left there, since the door writes as root and a link could point
// it anywhere.
async function fresh(tmp, mode) {
  await fsp.rm(tmp, { force: true });
  const flags =
    fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    fs.constants.O_NOFOLLOW;
  return fsp.open(tmp, flags, mode);
}

// Writes a whole file: to a file beside it first, then into place, so a
// write cut short leaves the old file whole. A file that was there keeps
// its mode, so an editable script stays executable.
async function write(req, res, at) {
  try {
    await folderFor(at);
    const was = await fsp.lstat(at).catch(() => null);
    const mode = was?.isFile() ? was.mode & 0o7777 : 0o644;
    const tmp = `${at}.writing`;
    const fd = await fresh(tmp, mode);
    await pipeline(req, fd.createWriteStream());
    await fsp.chown(tmp, OWNER, OWNER).catch(() => {});
    await fsp.rename(tmp, at);
    json(res, 200, { size: (await fsp.stat(at)).size });
  } catch (err) {
    say(res, 500, `Could not write: ${err.code ?? err.message}`);
  }
}

// An upload in flight lives in a folder of ours beside the home on the
// same disk, where nothing of the person's can reach or replace it: the
// part so far, named for where it will go, and a note beside it saying
// which file it is a part of, the length and last change the browser
// reported.
const UPLOADS = path.join(path.dirname(HOME), "uploads");
const partOf = (at) =>
  path.join(UPLOADS, createHash("sha1").update(at).digest("hex"));
const noteOf = (at) => `${partOf(at)}.json`;
const whichOf = (url) =>
  JSON.stringify({
    total: Number(url.searchParams.get("total")),
    modified: url.searchParams.get("modified") ?? "",
  });

// A part that is a plain file, of the file the browser is uploading now;
// anything else is thrown away so nothing is stitched onto it.
async function partFor(at, which) {
  await fsp.mkdir(UPLOADS, { recursive: true, mode: 0o700 });
  const part = partOf(at);
  const s = await fsp.lstat(part).catch(() => null);
  const note = await fsp.readFile(noteOf(at), "utf8").catch(() => null);
  if (s?.isFile() && note === which) return s.size;
  await fsp.rm(part, { force: true });
  await fsp.rm(noteOf(at), { force: true });
  return 0;
}

// How far an upload of this file has got, so a client that lost its
// connection carries on from there rather than from nothing.
async function have(res, at, url) {
  try {
    json(res, 200, { have: await partFor(at, whichOf(url)) });
  } catch (err) {
    say(res, 500, `Could not look: ${err.code ?? err.message}`);
  }
}

// One piece of an upload, written at its offset into the file being
// assembled. A piece that would leave a gap is refused with how far the
// upload has got. When the whole length has arrived the file is put in
// place and the answer says so.
async function upload(req, res, at, url) {
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const total = Number(url.searchParams.get("total"));
  if (
    !Number.isInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(total) ||
    total < 0
  )
    return say(res, 400, "An upload says its offset and its total length.");
  const part = partOf(at);
  try {
    await folderFor(at);
    const which = whichOf(url);
    const had = await partFor(at, which);
    if (offset > had) return json(res, 409, { have: had });
    if (had === 0) {
      await (await fresh(part, 0o644)).close();
      await fsp.writeFile(noteOf(at), which, { mode: 0o600 });
    }
    const fd = await fsp.open(
      part,
      fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW,
    );
    await pipeline(req, fd.createWriteStream({ start: offset }));
    const size = (await fsp.stat(part)).size;
    if (size < total) return json(res, 202, { have: size });
    if (size > total) await fsp.truncate(part, total);
    await fsp.chown(part, OWNER, OWNER).catch(() => {});
    await fsp.rename(part, at);
    await fsp.rm(noteOf(at), { force: true });
    json(res, 201, { size: total });
  } catch (err) {
    say(res, 500, `Could not take that: ${err.code ?? err.message}`);
  }
}

// Answers one ask about the home. The path is the query's `path`, relative
// to the home; the door has already checked the ticket.
export async function serve(req, res, url) {
  const at = inside(url.searchParams.get("path") ?? "");
  if (!at) return say(res, 403, "That is not in your home.");
  const what = url.pathname.slice("/maslow/files".length);
  if (what === "" && req.method === "GET") return list(res, at);
  if (what === "/read" && req.method === "GET") return read(req, res, at);
  if (what === "/preview" && req.method === "GET") return preview(res, at);
  if (what === "/write" && req.method === "PUT") return write(req, res, at);
  if (what === "/upload" && req.method === "GET") return have(res, at, url);
  if (what === "/upload" && req.method === "PUT")
    return upload(req, res, at, url);
  say(res, 404, "Nothing of the files is there.");
}
