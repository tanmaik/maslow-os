// Seeds ours into a file of the person's and keeps it current: an entry
// the person has not touched follows the image, one they changed or
// removed is theirs. Two seeds: the MCP servers Claude Code knows, the
// browser and the brain; and how it asks before it acts, which starts in
// auto. Two halves: as root, the record of every set of defaults the
// image ever gave, kept beside the disk's root out of their Linux, and
// whether each was written; as the person, the file itself, so nothing
// they put in their home can reach past it. Nothing here stops the boot.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SEEDS = {
  mcp: {
    file: ".claude.json",
    ours: "/opt/maslow/etc/mcp.json",
    memo: "/data/.mcp-seeded.json",
    at: "mcpServers",
  },
  settings: {
    file: ".claude/settings.json",
    ours: "/opt/maslow/etc/settings.json",
    memo: "/data/.settings-seeded.json",
    at: "permissions",
  },
};

const [, self, home, name, role] = process.argv;
const seed = SEEDS[name];
const file = path.join(home, seed.file);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// What a default names but only the machine knows, filled in before it is
// given: what is written is what is used, since nothing reads it later.
const filled = (v) =>
  typeof v === "string"
    ? v.replace(/\$\{(\w+)\}/g, (whole, name) => process.env[name] ?? whole)
    : v;

if (role === "as-me") theirs();
else give();

// Root's half. The record says a set was given before it is, so a boot
// cut off between the two still knows the value as ours next time; and
// says it was written only once it was, so a key never written is not
// taken for one the person removed.
function give() {
  const ours = JSON.parse(fs.readFileSync(seed.ours, "utf8"), (_, v) =>
    filled(v),
  );
  // The brain is reached only where our server gave the machine its
  // address; a laptop's app is out of a machine's reach.
  if (name === "mcp" && !process.env.BRAIN_URL) delete ours.brain;
  // A record in any other shape is no record.
  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(seed.memo, "utf8"));
    if (!Array.isArray(history)) history = [];
    history = history.filter((h) => object(h?.defaults));
  } catch {}
  const save = () => fs.writeFileSync(seed.memo, JSON.stringify(history));
  if (!same(history.at(-1)?.defaults, ours)) {
    history = [...history, { defaults: ours, written: false }].slice(-20);
    save();
  }
  const me = spawnSync(process.execPath, [self, home, name, "as-me"], {
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

// The person's half: their file brought up to the newest defaults, except
// where they changed or removed one. Leaves it alone, and says so, when
// it is not a plain file holding an object.
function theirs() {
  const history = JSON.parse(fs.readFileSync(0, "utf8"));
  const ours = history.at(-1).defaults;
  const leave = (why) => {
    console.log(`${name}: ${why}; left alone`);
    process.exit(2);
  };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch (err) {
    leave(err.message);
  }
  // Opened without following a link and without waiting on a pipe, and
  // read only if it is a plain file.
  let whole = {};
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
      whole = JSON.parse(fs.readFileSync(fd, "utf8"));
    } catch {
      leave("it could not be read");
    }
    fs.closeSync(fd);
    if (!object(whole)) leave("it does not hold an object");
  }
  // The entries ours sit among: the whole file, or one key of it.
  const mine = seed.at ? (whole[seed.at] ?? {}) : whole;
  if (!object(mine)) leave(`${seed.at} does not hold an object`);

  const given = (key) => history.some((h) => h.written && key in h.defaults);
  const ever = (key, value) =>
    history.some((h) => same(h.defaults[key], value));
  const next = { ...mine };
  for (const [key, value] of Object.entries(ours)) {
    // Untouched: never written to them, or still one of the values we
    // gave. Removed by them, or changed by them, is theirs.
    const untouched = key in mine ? ever(key, mine[key]) : !given(key);
    if (untouched) next[key] = value;
  }
  // A default we stopped shipping goes too, unless they changed it.
  for (const key of new Set(history.flatMap((h) => Object.keys(h.defaults))))
    if (!(key in ours) && key in mine && ever(key, mine[key])) delete next[key];

  if (same(next, mine)) return;
  const out = seed.at ? { ...whole, [seed.at]: next } : next;
  const tmp = `${file}.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(out, null, 2) + "\n", { flag: "wx" });
  fs.renameSync(tmp, file);
}
