// What the person had open, remembered so a restart puts it back: each
// terminal window in its folder, with its name and the command in its
// foreground, and nothing else. Kept on the disk, since the machine is
// what a restart throws away.
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

// Every process: its parent and its process group.
async function processes() {
  const out = new Map();
  for (const pid of (await readdir("/proc")).filter((d) => /^\d+$/.test(d))) {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => null);
    if (!stat) continue;
    const after = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    out.set(Number(pid), {
      ppid: Number(after[1]),
      pgid: Number(after[2]),
      tpgid: Number(after[5]),
    });
  }
  return out;
}

// The environment of a process, as name → value.
async function environOf(pid) {
  const raw = await readFile(`/proc/${pid}/environ`, "utf8").catch(() => "");
  const out = new Map();
  for (const kv of raw.split("\0")) {
    const eq = kv.indexOf("=");
    if (eq > 0) out.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  return out;
}

// A command as it was typed: its words, its folder, and what the line
// gave it that a shell of the person's does not give every command.
async function commandOf(pid, given) {
  const cmd = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "");
  const argv = cmd.replace(/\0+$/, "").split("\0").filter(Boolean);
  if (!argv.length) return null;
  const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => null);
  const env = [];
  for (const [k, v] of await environOf(pid))
    if (
      /^[A-Z][A-Z0-9_]*$/.test(k) &&
      !THE_SHELLS.has(k) &&
      !SECRET.test(k) &&
      v.length <= 200 &&
      given.get(k) !== v
    )
      env.push(`${k}=${v}`);
  return { argv, env, path: cwd ? theirs(cwd) : HOME };
}
// What every shell of the person's gives a command, read from a fresh
// one: the line's own variables are what a job holds beyond it.
async function givenBy(them) {
  const out = await them("/bin/bash", "-lc", "env");
  const map = new Map();
  for (const kv of (out ?? "").split("\n")) {
    const eq = kv.indexOf("=");
    if (eq > 0) map.set(kv.slice(0, eq), kv.slice(eq + 1));
  }
  return map;
}
// A variable that may hold a credential is never written down or typed
// back: by its name, and everything ours or Claude Code's.
const SECRET =
  /TOKEN|SECRET|KEY|PASS|AUTH|CREDENTIAL|COOKIE|PRIVATE|^MASLOW_|^ANTHROPIC_|^CLAUDE_/;
// What a shell or a terminal sets for its own reasons, never the line.
const THE_SHELLS = new Set([
  "_",
  "SHELL",
  "MASLOW_WELCOMED",
  "SHLVL",
  "OLDPWD",
  "PWD",
  "TMUX",
  "TMUX_PANE",
  "TERM",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "COLUMNS",
  "LINES",
]);

// Between the fields tmux answers: a tab it would print as an underscore.
const APART = " ~|~ ";

// The windows of the person's terminal, and what runs in each: the job
// the terminal is given to, which the shell says by its process group.
async function windows(tmux, procs, given) {
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
  if (out === null) return [];
  const found = [];
  for (const line of out.trim().split("\n").filter(Boolean)) {
    const [, name, auto, path, pid] = line.split(APART);
    const shell = Number(pid);
    const fore = procs.get(shell)?.tpgid;
    const job =
      fore && fore !== procs.get(shell)?.pgid
        ? [...procs].find(([, p]) => p.pgid === fore && p.ppid === shell)?.[0]
        : undefined;
    found.push({
      path: path || HOME,
      name: auto === "0" ? name : null,
      command: job ? await commandOf(job, given) : null,
    });
  }
  return found;
}

// Written down now: what is in the terminal.
export async function remember(tmux, them) {
  const [procs, given] = await Promise.all([processes(), givenBy(them)]);
  is({ boot: booted(), windows: await windows(tmux, procs, given) });
}

// A word as the shell would read it.
const quoted = (s) =>
  /^[A-Za-z0-9_./:=@%+,-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
// The command as a line typed into the shell; a Claude Code that was
// running comes back with its conversation continued.
// A line a terminal takes whole: the kernel drops one over four thousand
// characters, so the words alone are typed where the whole would not fit.
const A_LINE = 3000;
function line({ argv, env }) {
  const words = [...argv];
  const program = words[0].split("/").pop();
  if (
    program === "claude" &&
    !words.some((w) => ["--continue", "-c", "--resume", "-r"].includes(w))
  )
    words.push("--continue");
  const whole = [...env, ...words].map(quoted).join(" ");
  return whole.length <= A_LINE ? whole : words.map(quoted).join(" ");
}

// A window's shell waited for, up to ten seconds, so what is typed into
// it lands at its prompt; typed anyway after that, since a terminal keeps
// what arrives before its shell reads.
async function prompted(tmux, at) {
  for (let i = 0; i < 100; i++) {
    const cmd = await tmux(
      "display",
      "-p",
      "-t",
      at,
      "#{pane_current_command}",
    );
    if (cmd !== null && /^(bash|-bash|sh|zsh)$/.test(cmd.trim())) return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

// A session that is only the bare shell the terminal opens with: nothing
// in it yet, so what was there before can be put in beside it.
async function bare(tmux) {
  const out = await tmux(
    "list-panes",
    "-s",
    "-t",
    "main",
    "-F",
    "#{session_windows} #{history_size} #{pane_current_command}",
  );
  if (out === null) return null;
  const [n, history, cmd] = out.trim().split(/\s+/);
  return n === "1" && history === "0" && /^(bash|-bash)$/.test(cmd ?? "");
}

// The terminal put back as it was before the machine last went: the
// windows in their folders, named where the person named them, each
// command typed back in so it runs in view. A server that ran outside a
// window stays down: what listens after a restart is what the person's
// windows started. Once per boot, into a terminal that is not there yet
// or holds nothing, and never over one with anything in it.
export async function restore(tmux) {
  const w = was();
  if (!w || w.boot === booted()) return;
  const there = await bare(tmux);
  if (there === false) return;
  const folder = (p) => (fs.existsSync(OS + p) ? p : HOME);
  const runs = w.windows ?? [];
  // The windows in their order first, which takes a moment, then every
  // command typed at once, each when its own prompt is up, so however
  // many windows there were the whole of it is one prompt's wait long.
  let made = 0;
  const typed = [];
  for (const r of runs) {
    const opened =
      made === 0 && there === null
        ? await tmux("new-session", "-d", "-s", "main", "-c", folder(r.path))
        : await tmux("new-window", "-d", "-t", "main", "-c", folder(r.path));
    if (opened === null) break;
    made++;
    const at = `main:${made + (there ? 1 : 0)}`;
    if (r.name) await tmux("rename-window", "-t", at, r.name);
    if (r.command?.argv?.length)
      typed.push(
        prompted(tmux, at).then(() =>
          tmux("send-keys", "-t", at, line(r.command), "Enter"),
        ),
      );
  }
  await Promise.all(typed);
  if (made === runs.length) is({ ...w, boot: booted() });
  console.log(
    made === runs.length
      ? `restored ${made} of the terminal`
      : `restored ${made} of ${runs.length} of the terminal; the rest is tried at the next boot`,
  );
}
