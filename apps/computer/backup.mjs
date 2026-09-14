// A backup of the person's home: archived on the disk, outside their
// Linux, then uploaded to the address our server signed for it, and the
// archive let go. The bucket takes nothing of unknown length, so the
// archive is a file, made only when the disk has room for it; otherwise
// the answer says so and our server grows the disk. One at a time; what
// came of the last one is kept on the disk for our server to read at its
// next ask. A backup comes back the other way: fetched from an address
// our server signed for it and unpacked into a folder of its own in the
// home, never over what is there. Nothing here calls home.
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const HOME = "/data/home";
const ARCHIVE = "/data/.backup.tgz";
const STATE = "/data/.backup.json";
const COMING = "/data/.restore.tgz";
const RESTORE_STATE = "/data/.restore.json";
// Room the archive is given beyond the home's own size.
const SLACK = 256 * 1024 * 1024;

let running = false;

function write(state) {
  fs.writeFileSync(STATE, JSON.stringify(state));
}

// What came of the last backup, or nothing yet.
function last() {
  try {
    return JSON.parse(fs.readFileSync(STATE, "utf8"));
  } catch {
    return null;
  }
}

// A backup the last boot cut off is over, and says so.
const cut = last();
if (cut && !cut.finishedAt)
  write({
    ...cut,
    finishedAt: new Date().toISOString(),
    error: "cut off by a restart",
  });
fs.rmSync(ARCHIVE, { force: true });

// Starts a backup to the address given, under the key our server chose,
// and answers at once; false when one is already running.
function start({ url, key }) {
  if (running) return false;
  running = true;
  const startedAt = new Date().toISOString();
  write({ key, startedAt, finishedAt: null, bytes: null, error: null });
  void (async () => {
    try {
      const { stdout } = await run("du", ["-sx", "--block-size=1", HOME], {
        maxBuffer: 1 << 20,
      });
      const home = Number(stdout.split("\t")[0]);
      const st = fs.statfsSync("/data");
      const free = st.bavail * st.bsize;
      if (free < home + SLACK)
        throw new Error(
          `no room: the home is ${home} bytes and the disk has ${free} free`,
        );
      await run("tar", ["-C", HOME, "-czf", ARCHIVE, "."], {
        maxBuffer: 1 << 20,
      });
      const bytes = fs.statSync(ARCHIVE).size;
      await run("curl", [
        "--fail",
        "--silent",
        "--show-error",
        "--max-time",
        "3600",
        "-X",
        "PUT",
        "-H",
        "content-type: application/gzip",
        "--upload-file",
        ARCHIVE,
        url,
      ]);
      write({
        key,
        startedAt,
        finishedAt: new Date().toISOString(),
        bytes,
        error: null,
      });
    } catch (err) {
      write({
        key,
        startedAt,
        finishedAt: new Date().toISOString(),
        bytes: null,
        error: String(err.stderr || err.message).slice(0, 300),
      });
    } finally {
      fs.rmSync(ARCHIVE, { force: true });
      running = false;
    }
  })();
  return true;
}

// --- A backup coming back ----------------------------------------------

// Where a restore stands, or nothing yet. The same shape a backup has,
// with the step it is on.
function lastRestore() {
  try {
    return JSON.parse(fs.readFileSync(RESTORE_STATE, "utf8"));
  } catch {
    return null;
  }
}

function wrote(state) {
  fs.writeFileSync(RESTORE_STATE, JSON.stringify(state));
}

// A restore the last boot cut off is over, and says so.
const stopped = lastRestore();
if (stopped && !stopped.finishedAt)
  wrote({
    ...stopped,
    finishedAt: new Date().toISOString(),
    error: "cut off by a restart",
  });
fs.rmSync(COMING, { force: true });

let restoring = false;

// Makes the folder a backup is unpacked into: its own day, in the home,
// and a number after it where that day is already there. The folder is
// made as its name is taken, so nothing is ever unpacked over what is in
// the home and only what this restore made is ever taken away.
function folder(into) {
  const plain = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(into ?? "") ? into : null;
  const base = `restored-${plain ?? new Date().toISOString().slice(0, 10)}`;
  for (let n = 0; ; n++) {
    const name = n === 0 ? base : `${base}-${n}`;
    try {
      fs.mkdirSync(`${HOME}/${name}`);
    } catch (err) {
      if (err.code === "EEXIST") continue;
      throw err;
    }
    fs.chownSync(`${HOME}/${name}`, 1000, 1000);
    return name;
  }
}

// Fetches the archive at the address given and unpacks it into a folder of
// its own in the home, as the person. Answers at once with the folder it
// will land in; false when one is already running.
function startRestore({ url, key, into }) {
  if (restoring) return false;
  const name = folder(into);
  restoring = true;
  const startedAt = new Date().toISOString();
  wrote({
    key,
    name,
    startedAt,
    finishedAt: null,
    step: "fetching",
    bytes: null,
    error: null,
  });
  void (async () => {
    const at = `${HOME}/${name}`;
    try {
      await run(
        "curl",
        [
          "--fail",
          "--silent",
          "--show-error",
          "--max-time",
          "3600",
          "-o",
          COMING,
          url,
        ],
        { maxBuffer: 1 << 20 },
      );
      const bytes = fs.statSync(COMING).size;
      // The same slack rule a backup uses, the other way round: an archive
      // is roughly its own size again once it is unpacked, and the disk
      // must hold both with room to spare.
      const st = fs.statfsSync("/data");
      const free = st.bavail * st.bsize;
      if (free < bytes * 3 + SLACK)
        throw new Error(
          `no room: the backup is ${bytes} bytes and the disk has ${free} free`,
        );
      // Every member lands inside the folder it was asked for: a name
      // that is absolute or climbs out of it is refused before anything
      // is written. A symlink member is harmless, since tar never writes
      // through one.
      const { stdout: members } = await run("tar", ["-tzf", COMING], {
        maxBuffer: 1 << 24,
      });
      const out = members
        .split("\n")
        .map((n) => n.trim())
        .filter(Boolean)
        .find(
          (n) =>
            n.startsWith("/") || n.split("/").some((part) => part === ".."),
        );
      if (out) throw new Error(`the backup holds a name outside it: ${out}`);
      wrote({ ...lastRestore(), step: "unpacking", bytes });
      await run("tar", ["-C", at, "--no-same-owner", "-xzf", COMING], {
        maxBuffer: 1 << 20,
      });
      await run("chown", ["-R", "1000:1000", at], { maxBuffer: 1 << 20 });
      wrote({
        ...lastRestore(),
        step: "done",
        finishedAt: new Date().toISOString(),
        error: null,
      });
    } catch (err) {
      // The folder this restore made is half unpacked, no use to anybody,
      // and taken away; nothing else is touched.
      fs.rmSync(at, { recursive: true, force: true });
      wrote({
        ...lastRestore(),
        step: "failed",
        finishedAt: new Date().toISOString(),
        error: String(err.stderr || err.message).slice(0, 300),
      });
    } finally {
      fs.rmSync(COMING, { force: true });
      restoring = false;
    }
  })();
  return name;
}

export const backup = {
  start,
  last,
  restore: startRestore,
  restored: lastRestore,
};
