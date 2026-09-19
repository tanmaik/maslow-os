// What the person had running, remembered so a restart puts it back: each
// terminal window in its folder, with its name and the command running in
// it, and each server listening on a port with its folder and command.
// Kept on the disk, since the machine is what a restart throws away.
import fs from "node:fs";
import { readdir, readFile, readlink } from "node:fs/promises";

const WAS = "/data/.was.json";
const OS = "/data/os";
const HOME = "/home/me";
const BOOT = "/proc/sys/kernel/random/boot_id";

const booted = () => fs.readFileSync(BOOT, "utf8").trim();

// The file as the door left it; none, or one that cannot be read, is
// nothing to put back.
function was() {
  try {
    const w = JSON.parse(fs.readFileSync(WAS, "utf8"));
    return w && typeof w === "object" ? w : null;
  } catch {
    return null;
  }
}

// Written whole, beside and then into place.
function is(w) {
  const tmp = `${WAS}.writing`;
  fs.writeFileSync(tmp, JSON.stringify(w));
  fs.renameSync(tmp, WAS);
}

// A path as the person sees it: the kernel says where a process stands
// from outside their Linux.
const theirs = (p) => (p.startsWith(OS) ? p.slice(OS.length) || "/" : p);

// Every process: its parent, and its own command and folder when asked.
async function processes() {
  const out = new Map();
  for (const pid of (await readdir("/proc")).filter((d) => /^\d+$/.test(d))) {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => null);
    if (!stat) continue;
    const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    out.set(Number(pid), { ppid: Number(after[1]) });
  }
  return out;
}
async function commandOf(pid) {
  const cmd = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
  const argv = cmd.replace(/\0+$/, "").split("\0").filter(Boolean);
  const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => null);
  return argv.length ? { argv, path: cwd ? theirs(cwd) : HOME } : null;
}

// Between the fields tmux answers: a tab it would print as an underscore.
const APART = " ~|~ ";

// The windows of the person's terminal, and what runs in each: the first
// child of the window's shell is the program in the foreground.
async function windows(tmux) {
  const out = await tmux(
    "list-panes",
    "-s",
    "-t",
    "main",
    "-F",
    [
      "#{window_index}",
      "#{window_name}",
      "#{automatic-rename}",
      "#{pane_current_path}",
      "#{pane_pid}",
    ].join(APART),
  );
  if (out === null) return { windows: [], inside: new Set() };
  const procs = await processes();
  const inside = new Set();
  const found = [];
  for (const line of out.trim().split("\n").filter(Boolean)) {
    const [, name, auto, path, pid] = line.split(APART);
    const shell = Number(pid);
    const child = [...procs].find(([, p]) => p.ppid === shell)?.[0];
    if (child) inside.add(child);
    const command = child ? await commandOf(child) : null;
    found.push({
      path: path || HOME,
      name: auto === "0" ? name : null,
      command: command?.argv ?? null,
    });
  }
  return { windows: found, inside, procs };
}

// Whether a process runs under one of the terminal's windows, so the
// window's command brings it back.
const under = (procs, inside, pid) => {
  for (let p = pid, n = 0; p > 1 && n < 64; n++) {
    if (inside.has(p)) return true;
    p = procs.get(p)?.ppid ?? 0;
  }
  return false;
};

// Written down now: what is in the terminal and what is on the ports, the
// ports not already inside a window.
export async function remember(tmux, listeners) {
  const { windows: w, inside, procs } = await windows(tmux);
  const ports = [];
  for (const l of await listeners()) {
    if (procs && under(procs, inside, Number(l.pid))) continue;
    const command = await commandOf(l.pid);
    if (command) ports.push({ port: l.port, ...command });
  }
  is({ boot: booted(), windows: w, ports });
}

// A word as the shell would read it.
const quoted = (s) =>
  /^[A-Za-z0-9_./:=@%+,-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
// The command as a line typed into the shell; a Claude Code that was
// running comes back with its conversation continued.
function line(argv) {
  const words = [...argv];
  const program = words[0].split("/").pop();
  if (
    program === "claude" &&
    !words.some((w) => ["--continue", "-c", "--resume", "-r"].includes(w))
  )
    words.push("--continue");
  return words.map(quoted).join(" ");
}

// The terminal put back as it was before the machine last went: the
// windows in their folders, named where the person named them, each
// command typed back in so it runs in view, and the servers that ran
// outside a window in windows of their own. Once per boot, and never over
// a terminal that is already there.
export async function restore(tmux) {
  const w = was();
  if (!w || w.boot === booted()) return;
  if ((await tmux("has-session", "-t", "main")) !== null) return;
  const folder = (p) => (fs.existsSync(OS + p) ? p : HOME);
  const runs = [...(w.windows ?? []), ...(w.ports ?? [])];
  let index = 0;
  for (const r of runs) {
    index++;
    const made =
      index === 1
        ? await tmux("new-session", "-d", "-s", "main", "-c", folder(r.path))
        : await tmux("new-window", "-d", "-t", "main", "-c", folder(r.path));
    if (made === null) break;
    if (r.name) await tmux("rename-window", "-t", `main:${index}`, r.name);
    if (r.command?.length)
      await tmux("send-keys", "-t", `main:${index}`, line(r.command), "Enter");
  }
  is({ ...w, boot: booted() });
  if (runs.length) console.log(`restored ${runs.length} of the terminal`);
}
