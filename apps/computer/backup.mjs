// A backup of the person's home: archived on the disk, outside their
// Linux, then uploaded to the address our server signed for it, and the
// archive let go. The bucket takes nothing of unknown length, so the
// archive is a file, made only when the disk has room for it; otherwise
// the answer says so and our server grows the disk. One at a time; what
// came of the last one is kept on the disk for our server to read at its
// next ask. Nothing here calls home.
import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const HOME = "/data/home";
const ARCHIVE = "/data/.backup.tgz";
const STATE = "/data/.backup.json";
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

export const backup = { start, last };
