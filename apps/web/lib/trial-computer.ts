// The trial's pretend computer, all in one place: the home folder Files
// lists, the apps Claude built on it and their pages, the shell the
// Terminal runs, and the session `claude` replays. Nothing here runs
// anything: every answer is written out below. Only a trial ever reads it.
// The world is the seed's own made-up one.

const USER = "guest";
const HOST = "maslow";

// --- The apps on the computer -------------------------------------------

export type DemoApp = {
  slug: string;
  title: string;
  port: number;
  // What it is for, in a line, as Applets says it.
  about: string;
};

export const DEMO_APPS: DemoApp[] = [
  {
    slug: "reading-list",
    title: "Reading list",
    port: 3000,
    about: "Books to read and read, written to the brain as you add them.",
  },
  {
    slug: "run-log",
    title: "Run log",
    port: 3001,
    about: "Every run with its distance and time, one record each.",
  },
];

// The address an app's window frames in the trial, which ends in its port
// as a real app's does, and the address its browser shows.
export const appHref = (a: DemoApp) => `/trial/app/${a.port}`;
export const appUrl = (a: DemoApp) => `http://localhost:${a.port}`;
export const appAt = (url: string) =>
  DEMO_APPS.find(
    (a) => url.replace(/\/$/, "") === appUrl(a) || url === appHref(a),
  ) ?? null;

// What the apps hold, which the brain holds too: each row is a record of
// the trial's demo brain, made by the app it came from.
export const BOOKS = [
  {
    ref: "book:gravity",
    title: "Gravity for Beginners",
    author: "A. Coyote",
    status: "reading",
  },
  {
    ref: "book:altitude",
    title: "Sourdough at Altitude",
    author: "Marge Crumb",
    status: "read",
  },
  {
    ref: "book:atlas",
    title: "A Night Sky Atlas",
    author: "Vera Nebula",
    status: "to read",
  },
  {
    ref: "book:mesa",
    title: "Roads of the High Mesa",
    author: "R. Runner",
    status: "to read",
  },
] as const;

export const RUNS = [
  {
    ref: "run:1",
    date: "2026-10-12",
    km: 5.2,
    minutes: 27,
    where: "Mesa road",
  },
  {
    ref: "run:2",
    date: "2026-10-14",
    km: 8.0,
    minutes: 44,
    where: "Canyon loop",
  },
  {
    ref: "run:3",
    date: "2026-10-17",
    km: 3.1,
    minutes: 16,
    where: "Mesa road",
  },
  {
    ref: "run:4",
    date: "2026-10-19",
    km: 10.0,
    minutes: 56,
    where: "Observatory hill",
  },
] as const;

// What the apps wrote to the brain, with the types they defined: the same
// books and runs their pages show, each from the app it came from.
export function appRecords() {
  return {
    types: [
      {
        name: "book",
        properties: [
          { name: "author", datatype: "text" as const },
          {
            name: "status",
            datatype: "enum" as const,
            options: ["to read", "reading", "read"],
          },
        ],
      },
      {
        name: "run",
        properties: [
          { name: "date", datatype: "date" as const },
          { name: "km", datatype: "number" as const },
          { name: "minutes", datatype: "number" as const },
          { name: "where", datatype: "text" as const },
        ],
      },
    ],
    records: [
      ...BOOKS.map((b) => ({
        type: "book",
        source: "reading-list",
        sourceRef: b.ref,
        title: b.title,
        props: { author: b.author, status: b.status },
      })),
      ...RUNS.map((r) => ({
        type: "run",
        source: "run-log",
        sourceRef: r.ref,
        title: `${r.km} km, ${r.where}`,
        props: { date: r.date, km: r.km, minutes: r.minutes, where: r.where },
      })),
    ],
  };
}

// --- The home folder ----------------------------------------------------

type File = {
  kind: "file";
  // Text is the file; a picture is served from the site's own public files.
  text?: string;
  picture?: string;
  size?: number;
};
type Dir = { kind: "dir"; items: Record<string, Node> };
type Node = File | Dir;

const csv = (rows: (string | number)[][]) =>
  rows.map((r) => r.join(",")).join("\n") + "\n";

const BOOKS_CSV = csv([
  ["title", "author", "status"],
  ...BOOKS.map((b) => [b.title, b.author, b.status]),
]);
const RUNS_CSV = csv([
  ["date", "km", "minutes", "where"],
  ...RUNS.map((r) => [r.date, r.km, r.minutes, r.where]),
]);

const READING_SERVER = `// The reading list: one page and a small API, on port 3000.
// Each book added is also written to the brain as a record.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("./index.html", import.meta.url));

createServer((req, res) => {
  if (req.url === "/books") {
    res.setHeader("content-type", "text/csv");
    return res.end(readFileSync(new URL("./books.csv", import.meta.url)));
  }
  res.setHeader("content-type", "text/html");
  res.end(page);
}).listen(3000);
`;

const RUNS_SERVER = `// The run log, on port 3001. A run added here is a record in the brain.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";

createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(readFileSync(new URL("./index.html", import.meta.url)));
}).listen(3001);
`;

const HOME: Dir = {
  kind: "dir",
  items: {
    "README.md": {
      kind: "file",
      text: `# Your computer

This is a trial, so this folder is made up and read-only.

On your own Maslow this is a real Linux computer in the cloud. You and
Claude build apps here; a port you publish becomes an app in your dock,
and what the apps keep is written to your brain.

- apps/ holds the apps Claude built.
- notes/ holds a few notes.
- pictures/ holds two pictures.

Run your own: https://github.com/maslow-tech/maslow-os
`,
    },
    apps: {
      kind: "dir",
      items: {
        "reading-list": {
          kind: "dir",
          items: {
            "README.md": {
              kind: "file",
              text: `# Reading list

Built by Claude in one session. Published on port 3000 as "Reading list".
Each book is a record of type book in the brain, from reading-list.
`,
            },
            "server.mjs": { kind: "file", text: READING_SERVER },
            "books.csv": { kind: "file", text: BOOKS_CSV },
          },
        },
        "run-log": {
          kind: "dir",
          items: {
            "README.md": {
              kind: "file",
              text: `# Run log

Published on port 3001 as "Run log". Each run is a record of type run.
`,
            },
            "server.mjs": { kind: "file", text: RUNS_SERVER },
            "runs.csv": { kind: "file", text: RUNS_CSV },
          },
        },
      },
    },
    notes: {
      kind: "dir",
      items: {
        "ideas.md": {
          kind: "file",
          text: `# Ideas

- A page that shows this week's runs beside the weather.
- Ask Claude to read the reading list and suggest the next book.
- A stargazing log for the observatory nights with Vera.
`,
        },
        "todo.md": {
          kind: "file",
          text: `# To do

- [x] Publish the reading list
- [ ] Add the canyon loop to the run log
- [ ] Return the rocket skates to Acme (batch 7)
`,
        },
        "acme-call.md": {
          kind: "file",
          text: `# Call with Acme Rockets

Wile says batch 7 ships Friday. Road Runner asks that nobody test them on
the mesa road again.
`,
        },
      },
    },
    pictures: {
      kind: "dir",
      items: {
        "aurora.jpg": {
          kind: "file",
          picture: "/wallpapers/aurora.jpg",
          size: 412_000,
        },
        "milky-way.jpg": {
          kind: "file",
          picture: "/wallpapers/milkyway.jpg",
          size: 386_000,
        },
      },
    },
  },
};

const MODIFIED = "2026-10-20T16:00:00.000Z";

const parts = (path: string) => path.split("/").filter((p) => p && p !== ".");

// What lies at a path of the home folder, or null.
function nodeAt(path: string): Node | null {
  let n: Node = HOME;
  for (const p of parts(path)) {
    if (p === "..") return null;
    if (n.kind !== "dir" || !n.items[p]) return null;
    n = n.items[p]!;
  }
  return n;
}

const sizeOf = (n: Node): number =>
  n.kind === "dir"
    ? 4096
    : (n.size ?? new TextEncoder().encode(n.text ?? "").length);

export type TrialEntry = {
  name: string;
  kind: "dir" | "file";
  size: number;
  modified: string;
};

// A folder as Files lists it, or null where there is none.
export function listAt(path: string): TrialEntry[] | null {
  const n = nodeAt(path);
  if (!n || n.kind !== "dir") return null;
  return Object.entries(n.items).map(([name, c]) => ({
    name,
    kind: c.kind,
    size: sizeOf(c),
    modified: MODIFIED,
  }));
}

// A file: its words, or the picture it is, or null.
export function fileAt(
  path: string,
): { text: string } | { picture: string } | null {
  const n = nodeAt(path);
  if (!n || n.kind !== "file") return null;
  if (n.picture) return { picture: n.picture };
  return { text: n.text ?? "" };
}

// Every file whose name has the words, for search.
export function findFiles(words: string): string[] {
  const q = words.toLowerCase();
  const found: string[] = [];
  const walk = (n: Dir, at: string) => {
    for (const [name, c] of Object.entries(n.items)) {
      const path = at ? `${at}/${name}` : name;
      if (c.kind === "dir") walk(c, path);
      else if (
        name.toLowerCase().includes(q) ||
        (c.text ?? "").toLowerCase().includes(q)
      )
        found.push(path);
    }
  };
  walk(HOME, "");
  return found;
}

// --- The shell ----------------------------------------------------------

import { REPO } from "./trial-rules.ts";

export { REPO };

export type Shell = { cwd: string; history: string[] };
export const newShell = (): Shell => ({ cwd: "", history: [] });

// The prompt, with the folder as a shell says it.
export const prompt = (s: Shell) =>
  `${USER}@${HOST}:${s.cwd ? `~/${s.cwd}` : "~"}$ `;

// The path a word names from where the shell stands.
function resolve(cwd: string, word: string): string | null {
  const start = word.startsWith("~") || word.startsWith("/") ? [] : parts(cwd);
  const out = [...start];
  for (const p of word.replace(/^~\/?/, "").replace(/^\//, "").split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") {
      if (!out.length) continue;
      out.pop();
    } else out.push(p);
  }
  return out.join("/");
}

const COMMANDS = [
  "help",
  "ls",
  "cd",
  "pwd",
  "cat",
  "whoami",
  "date",
  "echo",
  "clear",
  "history",
  "uname",
  "claude",
];

const HELP = `This shell is part of the trial: it knows a few commands and runs nothing.
  ls [-la] [path]   list a folder
  cd <path>         change folder
  pwd               where you are
  cat <file>        show a file
  whoami, date, echo, history, uname -a, clear
  claude            watch a recorded session in which Claude builds an app`;

export type Ran = {
  out: string;
  // The screen is cleared first; the recorded session plays after.
  clear?: boolean;
  replay?: boolean;
};

const pad = (s: string, n: number) => s.padStart(n);

// One line typed into the shell, and what it prints. The shell is changed
// in place: where it stands and what it remembers.
export function run(s: Shell, line: string): Ran {
  const typed = line.trim();
  if (typed) s.history.push(typed);
  if (!typed) return { out: "" };
  const [cmd, ...args] = typed.split(/\s+/) as [string, ...string[]];
  const flags = args.filter((a) => a.startsWith("-")).join("");
  const words = args.filter((a) => !a.startsWith("-"));
  switch (cmd) {
    case "help":
      return { out: HELP };
    case "pwd":
      return { out: `/home/${USER}${s.cwd ? `/${s.cwd}` : ""}` };
    case "whoami":
      return { out: USER };
    case "date":
      return { out: new Date().toString() };
    case "echo":
      return { out: args.join(" ") };
    case "clear":
      return { out: "", clear: true };
    case "history":
      return {
        out: s.history
          .map((h, i) => `${pad(String(i + 1), 5)}  ${h}`)
          .join("\n"),
      };
    case "uname":
      return {
        out: flags.includes("a")
          ? `Linux ${HOST} 6.12.0-maslow #1 SMP x86_64 GNU/Linux`
          : "Linux",
      };
    case "cd": {
      const to = resolve(s.cwd, words[0] ?? "~");
      const n = to === null ? null : nodeAt(to);
      if (!n) return { out: `cd: ${words[0]}: No such file or directory` };
      if (n.kind !== "dir") return { out: `cd: ${words[0]}: Not a directory` };
      s.cwd = to!;
      return { out: "" };
    }
    case "ls": {
      const at = resolve(s.cwd, words[0] ?? ".");
      const n = at === null ? null : nodeAt(at);
      if (!n)
        return {
          out: `ls: cannot access '${words[0]}': No such file or directory`,
        };
      const entries: [string, Node][] =
        n.kind === "dir" ? Object.entries(n.items) : [[parts(at!).at(-1)!, n]];
      const shown: [string, Node][] =
        flags.includes("a") && n.kind === "dir"
          ? [[".", n], ["..", HOME], ...entries]
          : entries;
      if (!flags.includes("l"))
        return {
          out: shown
            .map(([name, c]) => (c.kind === "dir" ? `${name}/` : name))
            .join("  "),
        };
      const rows = shown.map(
        ([name, c]) =>
          `${c.kind === "dir" ? "drwxr-xr-x" : "-rw-r--r--"} 1 ${USER} ${USER} ${pad(String(sizeOf(c)), 7)} Oct 20 16:00 ${name}`,
      );
      return { out: [`total ${shown.length * 4}`, ...rows].join("\n") };
    }
    case "cat": {
      if (!words.length) return { out: "cat: which file?" };
      return {
        out: words
          .map((w) => {
            const at = resolve(s.cwd, w);
            const n = at === null ? null : nodeAt(at);
            if (!n) return `cat: ${w}: No such file or directory`;
            if (n.kind === "dir") return `cat: ${w}: Is a directory`;
            if (n.picture) return `cat: ${w}: a picture; open it in Files`;
            return (n.text ?? "").replace(/\n$/, "");
          })
          .join("\n"),
      };
    }
    case "claude":
      return { out: "", replay: true };
    default:
      return {
        out: `${cmd}: not in the trial. Run your own Maslow for a real shell: ${REPO}`,
      };
  }
}

// What Tab finishes a line to: a command at the start, a file or folder
// after it, or the line as it was.
export function complete(s: Shell, line: string): string {
  const words = line.split(" ");
  const last = words.at(-1) ?? "";
  if (words.length === 1) {
    const hits = COMMANDS.filter((c) => c.startsWith(last));
    return hits.length === 1 ? `${hits[0]} ` : line;
  }
  const slash = last.lastIndexOf("/");
  const folder = slash < 0 ? "" : last.slice(0, slash + 1);
  const stem = last.slice(slash + 1);
  const at = resolve(s.cwd, folder || ".");
  const n = at === null ? null : nodeAt(at);
  if (!n || n.kind !== "dir") return line;
  const hits = Object.entries(n.items).filter(([name]) =>
    name.startsWith(stem),
  );
  if (hits.length !== 1) return line;
  const [name, c] = hits[0]!;
  words[words.length - 1] = `${folder}${name}${c.kind === "dir" ? "/" : " "}`;
  return words.join(" ");
}

// The session `claude` plays: what is said, and how long before the next
// line, in milliseconds. It is a recording and says so first.
export const REPLAY: { text: string; wait: number }[] = [
  { text: "A recorded session; on your own Maslow this is live.", wait: 600 },
  { text: "", wait: 200 },
  { text: "> Build me a reading list I can open from the dock.", wait: 900 },
  { text: "", wait: 300 },
  {
    text: "● I'll make a small Node server with one page and a CSV of books.",
    wait: 900,
  },
  { text: "  Write apps/reading-list/server.mjs", wait: 500 },
  { text: "  Write apps/reading-list/index.html", wait: 500 },
  { text: "  Write apps/reading-list/books.csv (4 books)", wait: 700 },
  { text: "● Starting it on port 3000.", wait: 600 },
  { text: "  $ node apps/reading-list/server.mjs &", wait: 400 },
  { text: "  Listening on http://localhost:3000", wait: 800 },
  {
    text: '● Publishing port 3000 as an app called "Reading list".',
    wait: 700,
  },
  { text: '  publish 3000 --name "Reading list"', wait: 400 },
  { text: "  Reading list is in your dock.", wait: 800 },
  {
    text: "● Writing each book to your brain, so the rest of Maslow can use them.",
    wait: 700,
  },
  ...BOOKS.map((b) => ({
    text: `  brain write book "${b.title}" (${b.status})`,
    wait: 350,
  })),
  { text: "", wait: 300 },
  {
    text: "● Done. Open Reading list from the dock, or find the books in the Brain.",
    wait: 400,
  },
];

// --- Settings ------------------------------------------------------------

// What the Computer pane says about the pretend computer.
export const SPECS = {
  name: `${HOST}`,
  size: "2 CPUs · 4 GB memory · 20 GB disk",
  where: "A trial; nowhere",
  image: "trial",
};
