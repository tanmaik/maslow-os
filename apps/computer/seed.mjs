// Three jobs at boot, none of which stops it. Ours: the configuration
// of our own session, ~/.maslow/claude, written whole from the image,
// with the note that tells it what this computer is. Theirs, given: the
// two servers ours knows, the computer's and the brain, seeded into the
// person's own ~/.claude.json and kept current there, except where they
// changed or removed one, since what they build in their own terminal
// reaches the same computer and the same brain. Theirs, taken back: the
// mode, the skill link and the model earlier images put into their files,
// once, where they never changed them; nothing else of ours goes there.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// The servers given into the person's own Claude Code, and the record of
// every set of defaults ever given, kept beside the disk's root, out of
// their Linux.
const SERVERS = {
  file: ".claude.json",
  ours: "/opt/maslow/etc/mcp.json",
  memo: "/data/.mcp-seeded.json",
  at: "mcpServers",
};

// What earlier images gave into the person's files and is taken back.
const GIVEN = [
  {
    file: ".claude/settings.json",
    memo: "/data/.settings-seeded.json",
    at: "permissions",
  },
];

const [, self, home, name] = process.argv;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// What a default names but only the machine knows, filled in before it is
// given: what is written is what is used, since nothing reads it later.
const filled = (v) =>
  typeof v === "string"
    ? v.replace(/\$\{(\w+)\}/g, (whole, name) => process.env[name] ?? whole)
    : v;

if (name === "ours") ours();
else if (name === "servers") give();
else if (name === "as-me") mine(JSON.parse(fs.readFileSync(0, "utf8")));
else if (name === "theirs") theirs();
else takeBack(JSON.parse(fs.readFileSync(0, "utf8")));

// The configuration of our own session, ~/.maslow/claude: the same MCP
// servers and the same way of asking as the person's, written whole every
// boot since nobody edits it by hand, the BoardUI skill linked in, and,
// once, the conversations the door had open before ours had a directory,
// so the Agent's chats still open; the person's own conversations are
// theirs and stay where they are. The copy is marked done only once it is,
// so a boot cut short tries again.
function ours() {
  const dir = path.join(home, ".maslow", "claude");
  const read = (at) =>
    JSON.parse(fs.readFileSync(at, "utf8"), (_, v) => filled(v));
  const mcp = read("/opt/maslow/etc/mcp.json");
  if (!process.env.BRAIN_URL) delete mcp.brain;
  const settings = read("/opt/maslow/etc/settings.json");
  // The conversations the door knows as its own, by id: none where the
  // door never kept any; unknown, and carried on the next boot instead,
  // where the record cannot be read.
  let ids = [];
  try {
    const kept = JSON.parse(fs.readFileSync("/data/.agent-chats.json", "utf8"));
    if (!Array.isArray(kept)) throw new Error("not a list");
    ids = kept.filter((id) => /^[\w-]+$/.test(id));
  } catch (err) {
    if (err.code !== "ENOENT") ids = null;
  }
  const asMe = spawnSync(
    process.execPath,
    [
      "-e",
      `
      const fs = require("node:fs"), path = require("node:path");
      const [dir, ids, mcp, settings, slug] = JSON.parse(process.argv[1]);
      fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
      const write = (at, value) => fs.writeFileSync(at, JSON.stringify(value, null, 2) + "\\n");
      let config = {};
      try { config = JSON.parse(fs.readFileSync(path.join(dir, ".claude.json"), "utf8")); } catch {}
      write(path.join(dir, ".claude.json"), { ...config, hasCompletedOnboarding: true, mcpServers: mcp });
      write(path.join(dir, "settings.json"), { permissions: settings });
      fs.copyFileSync("/opt/maslow/etc/CLAUDE.md", path.join(dir, "CLAUDE.md"));
      const link = path.join(dir, "skills", "boardui");
      try { if (!fs.lstatSync(link).isSymbolicLink()) throw new Error(); } catch { try { fs.rmSync(link, { recursive: true, force: true }); } catch {} fs.symlinkSync("/opt/maslow/skills/boardui", link); }
      const done = path.join(dir, ".conversations-carried");
      if (ids && !fs.existsSync(done)) {
        const from = path.join(process.env.HOME, ".claude", "projects", slug);
        const to = path.join(dir, "projects", slug);
        fs.mkdirSync(to, { recursive: true });
        for (const id of ids) {
          for (const name of [id + ".jsonl", id]) {
            const at = path.join(from, name);
            if (fs.existsSync(at)) fs.cpSync(at, path.join(to, name), { recursive: true });
          }
        }
        fs.writeFileSync(done, ids.join("\\n") + "\\n");
      }
      `,
      // Claude Code names a project's folder after the home as the person's
      // Linux sees it, /home/me, not as this host does.
      JSON.stringify([
        dir,
        ids,
        mcp,
        settings,
        "/home/me".replaceAll("/", "-"),
      ]),
    ],
    {
      uid: 1000,
      gid: 1000,
      env: { HOME: home, PATH: process.env.PATH ?? "/usr/bin:/bin" },
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 60_000,
    },
  );
  if (asMe.status !== 0) process.exit(asMe.status ?? 1);
}

// Root's half of giving the servers. The record says a set was given
// before it is, so a boot cut off between the two still knows the value
// as ours next time; and says it was written only once it was, so a key
// never written is not taken for one the person removed.
function give() {
  const ours = JSON.parse(fs.readFileSync(SERVERS.ours, "utf8"), (_, v) =>
    filled(v),
  );
  // The brain is reached only where our server gave the machine its
  // address; a laptop's app is out of a machine's reach.
  if (!process.env.BRAIN_URL) delete ours.brain;
  // A record in any other shape is no record.
  let history = [];
  try {
    history = JSON.parse(fs.readFileSync(SERVERS.memo, "utf8"));
    if (!Array.isArray(history)) history = [];
    history = history.filter((h) => object(h?.defaults));
  } catch {}
  const save = () => fs.writeFileSync(SERVERS.memo, JSON.stringify(history));
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

// The person's half of the servers: their file brought up to the newest
// defaults, except where they changed or removed one. Leaves it alone,
// and says so, when it is not a plain file holding an object.
function mine(history) {
  const file = path.join(home, SERVERS.file);
  const ours = history.at(-1).defaults;
  const leave = (why) => {
    console.log(`servers: ${why}; left alone`);
    process.exit(2);
  };
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
  const mine = whole[SERVERS.at] ?? {};
  if (!object(mine)) leave(`${SERVERS.at} does not hold an object`);
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
  const tmp = `${file}.${process.pid}`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ ...whole, [SERVERS.at]: next }, null, 2) + "\n",
    { flag: "wx" },
  );
  fs.renameSync(tmp, file);
}

// Root's half of taking back: each record of what was given is handed to
// the person's half, and forgotten once that half has finished with the
// file, so a boot cut short tries again and a clean machine does nothing.
function theirs() {
  for (const given of GIVEN) {
    let history;
    try {
      history = JSON.parse(fs.readFileSync(given.memo, "utf8"));
    } catch (err) {
      if (err.code === "ENOENT") continue;
      console.log(`${given.memo}: could not be read; left alone`);
      continue;
    }
    if (!Array.isArray(history)) {
      console.log(`${given.memo}: does not hold a list; left alone`);
      continue;
    }
    // Only what was written into their file counts as ours to take back.
    history = history.filter((h) => object(h?.defaults) && h.written === true);
    const me = spawnSync(process.execPath, [self, home, "take-back"], {
      uid: 1000,
      gid: 1000,
      input: JSON.stringify({ ...given, history }),
      stdio: ["pipe", "inherit", "inherit"],
      timeout: 8_000,
    });
    if (me.status === 0) fs.rmSync(given.memo, { force: true });
  }
  // The skill an earlier image linked among their skills goes with it.
  spawnSync(
    process.execPath,
    [
      "-e",
      `
      const fs = require("node:fs");
      const link = process.argv[1];
      try {
        if (fs.lstatSync(link).isSymbolicLink() && fs.readlinkSync(link) === "/opt/maslow/skills/boardui") fs.unlinkSync(link);
      } catch {}
      `,
      path.join(home, ".claude", "skills", "boardui"),
    ],
    { uid: 1000, gid: 1000, stdio: "inherit", timeout: 8_000 },
  );
}

// The person's half: every entry still holding a value an earlier image
// gave is taken out of their file, and a model of ours a session of ours
// once wrote there goes too; what they changed stays. Leaves the file
// alone, and says so, when it is not a plain file holding an object.
function takeBack({ file, at, history }) {
  const target = path.join(home, file);
  const leave = (why) => {
    console.log(`${file}: ${why}; left alone`);
    process.exit(2);
  };
  // Opened without following a link and without waiting on a pipe, and
  // read only if it is a plain file.
  let whole = {};
  let fd = null;
  try {
    const { O_RDONLY, O_NOFOLLOW, O_NONBLOCK } = fs.constants;
    fd = fs.openSync(target, O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } catch (err) {
    if (err.code === "ENOENT") return;
    leave(err.message);
  }
  if (!fs.fstatSync(fd).isFile()) leave(`${target} is not a plain file`);
  try {
    whole = JSON.parse(fs.readFileSync(fd, "utf8"));
  } catch {
    leave("it could not be read");
  }
  fs.closeSync(fd);
  if (!object(whole)) leave("it does not hold an object");
  let changed = false;
  if (at === "permissions" && /^z-ai\//.test(String(whole.model ?? ""))) {
    delete whole.model;
    changed = true;
  }
  const mine = whole[at];
  if (object(mine)) {
    const next = { ...mine };
    const ever = (key, value) =>
      history.some((h) => same(h.defaults[key], value));
    for (const key of Object.keys(mine))
      if (ever(key, mine[key])) delete next[key];
    if (!same(next, mine)) {
      changed = true;
      if (Object.keys(next).length) whole[at] = next;
      else delete whole[at];
    }
  }
  if (!changed) return;
  const tmp = `${target}.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(whole, null, 2) + "\n", { flag: "wx" });
  fs.renameSync(tmp, target);
}
