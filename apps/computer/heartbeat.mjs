// The heartbeat: a run of Claude Code as the person that nobody started
// by hand. It happens on a clock our server sets and at the person's Run
// now, one at a time, on a session of ours, with a time it cannot go
// past. How often, when the last ran and what came of it are
// kept on the disk outside their Linux, so a machine remade or restarted
// keeps its clock. Nothing here calls home.
import fs from "node:fs";

const STATE = "/data/.heartbeat.json";
const BRIEF = "/opt/maslow/etc/heartbeat.md";
// How long one run may go on. What it may spend is the weekly cap on the
// person's key, which Claude Code can count and a run cannot pass.
const LONGEST = 60 * 60_000;
// How soon after the door starts a run that is due happens, so a machine
// still bringing up its browser is not the one it runs on.
const SETTLE = 60_000;
// How much of what a run printed is kept: the end of it, for what went
// wrong.
const KEPT = 2000;
// How long a run told to stop is given before it is killed.
const GRACE = 15_000;

// How often, in minutes; zero is off.
let every = 0;
// What came of the last run, if any.
let last = null;
let timer = null;
let running = null;
let spawnAsThem = null;
// Reasons that arrived while a run was going, for the run after it.
let waiting = [];
// The keys of asks answered, the last few, so an ask answered once is not
// answered again however long ago its run was.
let answered = [];
const REMEMBERED = 50;
// How many reasons wait by name; past that they are counted.
const NAMED = 20;
let more = 0;
// When the door has been up long enough for a run to start.
let settled = Infinity;

// Which boot this is, so a run's process id is only ever believed within
// the boot that gave it.
const boot = (() => {
  try {
    return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return null;
  }
})();

try {
  const kept = JSON.parse(fs.readFileSync(STATE, "utf8"));
  if (Number.isInteger(kept?.every) && kept.every >= 0) every = kept.every;
  if (kept?.last?.at) last = kept.last;
  // What waited for the run after, and what was answered, are still
  // owed and still answered across a restart.
  if (Array.isArray(kept?.waiting))
    waiting = kept.waiting.filter((w) => typeof w?.why === "string");
  if (Number.isInteger(kept?.more)) more = kept.more;
  if (Array.isArray(kept?.answered))
    answered = kept.answered.filter((k) => typeof k === "string");
  // A run the last door left going is nobody's now: it is stopped where
  // this is still the boot it ran in, and is the last run, unfinished.
  if (kept?.running?.at) {
    if (boot && kept.running.boot === boot) stop(kept.running.pid, "SIGKILL");
    last = {
      at: kept.running.at,
      why: kept.running.why,
      key: kept.running.key ?? null,
      took: Date.now() - Date.parse(kept.running.at),
      ok: false,
      said: "The door restarted while it ran, and it was stopped.",
    };
    keep();
  }
} catch {}

function keep() {
  fs.writeFileSync(
    STATE,
    JSON.stringify({
      every,
      last,
      waiting,
      more,
      answered,
      running: running && {
        at: running.at,
        why: running.why,
        key: running.key,
        pid: running.pid,
        boot,
      },
    }),
  );
}

// A signal to a run and everything it started: its group, and every
// process descended from it, since a command it ran may have a group of
// its own.
function stop(pid, signal, known = []) {
  const each = (id) => {
    try {
      process.kill(id, signal);
    } catch {}
  };
  for (const id of new Set([...known, ...descendants(pid)])) each(id);
  each(-pid);
  each(pid);
}

// Every process under one, nearest first, as the kernel lists them.
function descendants(pid) {
  const children = new Map();
  let names = [];
  try {
    names = fs.readdirSync("/proc").filter((n) => /^\d+$/.test(n));
  } catch {
    return [];
  }
  for (const name of names) {
    try {
      const stat = fs.readFileSync(`/proc/${name}/stat`, "utf8");
      const parent = Number(
        stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1],
      );
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(Number(name));
    } catch {}
  }
  const found = [];
  const queue = [pid];
  while (queue.length) {
    const next = queue.shift();
    for (const child of children.get(next) ?? []) {
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

// Starts the clock, given how a command is spawned as the person.
function start(spawner) {
  spawnAsThem = spawner;
  settled = Date.now() + SETTLE;
  schedule();
}

// How often the agent runs on its own, in minutes; zero is off.
function set(minutes) {
  every = minutes;
  // Off is off: a reason waiting for the run after this one waits no
  // more, except an ask with a key, which is the person's own doing and
  // is answered once whatever the clock does.
  if (every === 0) {
    waiting = waiting.filter((w) => w.key);
    more = 0;
  }
  keep();
  schedule();
}

// The next run, from the last one: at once when that is already past,
// and never sooner than the door has been up for a moment.
function schedule() {
  clearTimeout(timer);
  timer = null;
  if (running || !spawnAsThem) return;
  // Reasons that waited for the run after, a door restarted among them,
  // go before any clock, as soon as the door has been up a moment.
  if (waiting.length > 0 || more > 0) {
    timer = setTimeout(drain, Math.max(settled - Date.now(), 0));
    return;
  }
  if (every === 0) return;
  const due = (last ? Date.parse(last.at) : 0) + every * 60_000;
  const wait = Math.max(due, settled) - Date.now();
  timer = setTimeout(() => run("its clock came round"), Math.max(wait, 0));
}

// The reasons that waited go as one run, with the first key among them,
// so the ask that carried it is still answered once.
function drain() {
  const queued = waiting.splice(0);
  const next = [
    ...queued.map((w) => w.why),
    ...(more > 0 ? [`${more} more reasons arrived`] : []),
  ].join("; and ");
  more = 0;
  // Every key the merged run carries is answered by it.
  const keys = queued.map((w) => w.key).filter(Boolean);
  answered = [...answered, ...keys.slice(1)].slice(-REMEMBERED);
  if (next) run(next, keys[0] ?? null);
  else schedule();
}

// A run now, saying why; while one is already going, the reason waits
// for the run after it, and the answer is false.
function run(why, key = null) {
  if (!spawnAsThem) return false;
  // A reason that carries a key is asked for once: one already running,
  // waiting or run is the same ask again, and starts nothing.
  if (
    key &&
    (running?.key === key ||
      answered.includes(key) ||
      waiting.some((w) => w.key === key))
  )
    return false;
  if (running) {
    // A reason with a key is an ask answered once, so it always waits by
    // name; past the named few, the rest are counted.
    if (key || waiting.length < NAMED) waiting.push({ why, key });
    else more += 1;
    // Written down before the ask is answered, so a door restarted
    // before the run after still owes it.
    keep();
    return false;
  }
  if (key) answered = [...answered, key].slice(-REMEMBERED);
  clearTimeout(timer);
  timer = null;
  const at = new Date().toISOString();
  let brief;
  try {
    brief = fs.readFileSync(BRIEF, "utf8");
  } catch (err) {
    end(at, why, false, `The brief could not be read: ${err.message}`, key);
    return true;
  }
  let proc;
  try {
    proc = spawnAsThem([
      "/opt/maslow/bin/claude",
      "-p",
      `${brief.trimEnd()}\n\nThis run started because ${why}.\n`,
      "--permission-mode",
      "bypassPermissions",
    ]);
  } catch (err) {
    end(at, why, false, `The run could not be started: ${err.message}`, key);
    return true;
  }
  running = { at, why, key, pid: proc.pid };
  keep();
  let said = "";
  const heard = (d) => (said = (said + d).slice(-KEPT));
  proc.stdout.on("data", heard);
  proc.stderr.on("data", heard);
  // Past its time it is told to stop, then killed, it and everything it
  // started; and whatever of its group outlives the pipes closing goes
  // with it.
  // What was under the run when it was told to stop is remembered, since
  // a process whose parent has gone is no longer found under it.
  let killer = null;
  let under = null;
  const clock = setTimeout(() => {
    under = descendants(proc.pid);
    heard("\nThe run went on past its time and was stopped.");
    stop(proc.pid, "SIGTERM", under);
    killer = setTimeout(() => stop(proc.pid, "SIGKILL", under), GRACE);
  }, LONGEST);
  proc.on("error", (err) => heard(`\n${err.message}`));
  proc.on("close", (code) => {
    clearTimeout(clock);
    clearTimeout(killer);
    if (under) stop(proc.pid, "SIGKILL", under);
    end(at, why, code === 0 && !under, said.trim(), key);
  });
  return true;
}

function end(at, why, ok, said, key = null) {
  running = null;
  last = { at, why, key, took: Date.now() - Date.parse(at), ok, said };
  keep();
  console.log(
    `heartbeat: ${ok ? "ran" : "failed"} in ${Math.round(last.took / 1000)}s, ${why}${ok ? "" : `: ${said.split("\n").at(-1)}`}`,
  );
  drain();
}

// How often, whether one is going now and since when, and what came of
// the last.
function state() {
  return {
    every,
    running: running ? running.at : null,
    last: last ? { ...last, said: last.ok ? "" : last.said } : null,
  };
}

export const heartbeat = { start, set, run, state };
