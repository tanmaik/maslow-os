// Refuses app code that reaches a cloud past the one interface: each cloud
// is a file under apps/web/lib/clouds/, and only apps/web/lib/cloud.ts,
// which picks this deployment's, imports one. Everything else asks the
// interface, so a cloud is added or taken away in one file and one line.
// And no code that runs in the browser reaches the cloud at all, however
// many imports away: that code is the server's, holding its credentials.
import fs from "node:fs";
import path from "node:path";

import { root } from "./root.mjs";

const APP = "apps/web";
const CLOUDS = "apps/web/lib/clouds/";
const PICKER = "apps/web/lib/cloud.ts";
const CODE = /\.(ts|tsx|mjs|js)$/;

// Every import and re-export a file makes, whole statements at a time, and
// whether it brings in types alone, which never reach the browser.
const STATIC =
  /(?:^|\n)\s*(?:import|export)\s+(type\s+)?([^;]*?)\s*from\s*["']([^"']+)["']/g;
const BARE = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
const DYNAMIC = /import\s*\(\s*["']([^"']+)["']\s*\)/g;

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".next"))
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (CODE.test(entry.name)) yield full;
  }
}

// Where an import lands, relative to the repo, for the app's own paths:
// the file itself, or the file its extension or folder leaves unsaid.
function target(from, spec) {
  const base = spec.startsWith("@/")
    ? path.join(APP, spec.slice(2))
    : spec.startsWith(".")
      ? path.join(path.dirname(from), spec)
      : null;
  if (base === null) return null;
  const tries = [
    base,
    ...["ts", "tsx", "js", "mjs"].map((ext) => `${base}.${ext}`),
    ...["ts", "tsx", "js"].map((ext) => `${base}/index.${ext}`),
  ];
  return (
    tries.find((f) =>
      fs.statSync(path.join(root, f), { throwIfNoEntry: false })?.isFile(),
    ) ?? path.normalize(base)
  );
}

// What a file imports: each landing, with whether only its types come in.
function importsOf(rel, text) {
  const out = [];
  for (const [, typeOnly, what, spec] of text.matchAll(STATIC)) {
    const names = what.match(/\{([^}]*)\}/)?.[1];
    const allTypes =
      Boolean(typeOnly) ||
      (names !== undefined &&
        !/^\s*[\w$]/.test(what.replace(/\{[^}]*\}/, "")) &&
        names
          .split(",")
          .map((n) => n.trim())
          .filter(Boolean)
          .every((n) => n.startsWith("type ")));
    out.push({ to: target(rel, spec), spec, types: allTypes });
  }
  for (const [, spec] of text.matchAll(BARE))
    out.push({ to: target(rel, spec), spec, types: false });
  for (const [, spec] of text.matchAll(DYNAMIC))
    out.push({ to: target(rel, spec), spec, types: false });
  return out;
}

const failures = [];
const graph = new Map();
const client = new Set();
for (const file of files(path.join(root, APP))) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, "utf8");
  const imports = importsOf(rel, text);
  graph.set(
    rel,
    imports.filter((i) => i.to && !i.types).map((i) => i.to),
  );
  if (
    /^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*["']use client["']/.test(text)
  )
    client.add(rel);
  if (rel === PICKER || rel.startsWith(CLOUDS)) continue;
  for (const i of imports)
    if (i.to && `${i.to}`.startsWith(CLOUDS))
      failures.push(`${rel}: imports ${i.spec}`);
}

// Every file that reaches the cloud, walked back from it import by
// import, each with the next file on its way there.
const toward = new Map();
const queue = [...graph.keys()].filter(
  (f) => f === PICKER || f.startsWith(CLOUDS),
);
for (const f of queue) toward.set(f, null);
while (queue.length) {
  const f = queue.shift();
  for (const [from, tos] of graph)
    if (!toward.has(from) && tos.includes(f)) {
      toward.set(from, f);
      queue.push(from);
    }
}
for (const file of client) {
  if (!toward.has(file)) continue;
  const way = [];
  for (let f = toward.get(file); f; f = toward.get(f)) way.push(f);
  failures.push(
    `${file}: runs in the browser and reaches the cloud through ${way.join(" → ")}`,
  );
}

failures.sort();
if (failures.length) {
  console.error(
    `cloud: refused; only ${PICKER} imports a cloud, and nothing in the browser reaches one`,
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(
  "cloud: only lib/cloud.ts imports a cloud, and nothing in the browser reaches one",
);
