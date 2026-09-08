// Seeds our VS Code defaults into the person's settings and keeps them
// current: a setting the person has not touched follows the image, one
// they changed or removed is theirs. Two halves: as root, the record of
// every set of defaults the image ever gave, kept beside the disk's root
// out of their Linux, and whether each was written; as the person, the
// settings themselves, so nothing they put in their home can reach past
// it. Nothing here stops the boot.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [, self, home, role] = process.argv;
const file = path.join(home, ".local/share/code-server/User/settings.json");
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

if (role === "as-me") seed();
else give();

// Root's half. The record says a set was given before it is, so a boot
// cut off between the two still knows the value as ours next time; and
// says it was written only once it was, so a key never written is not
// taken for one the person removed.
function give() {
  const memo = "/data/.settings-seeded.json";
  const ours = JSON.parse(
    fs.readFileSync("/opt/maslow/etc/settings.json", "utf8"),
  );
  // A record in any other shape is no record.
  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(memo, "utf8"));
    if (!Array.isArray(history)) history = [];
    history = history.filter((h) => object(h?.defaults));
  } catch {}
  const save = () => fs.writeFileSync(memo, JSON.stringify(history));
  if (!same(history.at(-1)?.defaults, ours)) {
    history = [...history, { defaults: ours, written: false }].slice(-20);
    save();
  }
  const me = spawnSync(process.execPath, [self, home, "as-me"], {
    uid: 1000,
    gid: 1000,
    input: JSON.stringify(history),
    stdio: ["pipe", "inherit", "inherit"],
    timeout: 8_000,
  });
  if (me.status !== 0) process.exit(me.status ?? 1);
  if (!history.at(-1).written) {
    history.at(-1).written = true;
    save();
  }
}

// The person's half: their settings brought up to the newest defaults,
// except where they changed or removed one. Leaves them alone, and says
// so, when their file is not a plain file of settings.
function seed() {
  const history = JSON.parse(fs.readFileSync(0, "utf8"));
  const ours = history.at(-1).defaults;
  const leave = (why) => {
    console.log(`settings: ${why}; left alone`);
    process.exit(2);
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch (err) {
    leave(err.message);
  }
  // Theirs, opened without following a link and without waiting on a
  // pipe, and read only if it is a plain file.
  let theirs = {};
  let fd = null;
  try {
    const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
    fd = fs.openSync(file, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (err) {
    if (err.code !== "ENOENT") leave(err.message);
  }
  if (fd !== null) {
    if (!fs.fstatSync(fd).isFile()) leave(`${file} is not a plain file`);
    try {
      theirs = JSON.parse(fs.readFileSync(fd, "utf8"));
    } catch {
      leave("theirs could not be read");
    }
    fs.closeSync(fd);
    if (!object(theirs)) leave("theirs is not a settings object");
  }

  const given = (key) => history.some((h) => h.written && key in h.defaults);
  const ever = (key, value) =>
    history.some((h) => same(h.defaults[key], value));
  const next = { ...theirs };
  for (const [key, value] of Object.entries(ours)) {
    // Untouched: never written to them, or still one of the values we
    // gave. Removed by them, or changed by them, is theirs.
    const untouched = key in theirs ? ever(key, theirs[key]) : !given(key);
    if (untouched) next[key] = value;
  }
  // A default we stopped shipping goes too, unless they changed it.
  for (const key of new Set(history.flatMap((h) => Object.keys(h.defaults))))
    if (!(key in ours) && key in theirs && ever(key, theirs[key]))
      delete next[key];

  if (same(next, theirs)) return;
  const tmp = `${file}.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", { flag: "wx" });
  fs.renameSync(tmp, file);
}
