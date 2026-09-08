// Refuses code that could carry a database key out of production: the two
// database URLs are named only where they are opened, and the code that
// ships never handles the environment whole.
import fs from "node:fs";
import path from "node:path";

import { root } from "./root.mjs";

// Where each URL may be named: opened, set for a local stack, or written to
// a preview's own store. Nowhere else, not even in a message.
const OPENS_A_DATABASE_URL = new Set([
  "packages/db/src/index.ts",
  "scripts/migrate.mjs",
  "scripts/stack.mjs",
  "scripts/smoke.mjs",
  "scripts/smoke-brain.mjs",
  "scripts/preview-db.mjs",
  "scripts/check-secrets.mjs",
]);

// Local tooling that hands its whole environment to a child process.
const SPREADS_ENV = new Set(["packages/db/src/postgres.ts"]);

// Code that ships, plus the scripts a deploy runs.
const SHIPS = ["apps/web", "packages", "scripts"];
const SKIP = new Set(["node_modules", "migrations"]);
const CODE = /\.(ts|tsx|mjs|js)$/;

// Next's build output, whichever run made it, is not source.
const built = (name) => name.startsWith(".next");

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    if (entry.isDirectory() && built(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (CODE.test(entry.name)) yield full;
  }
}

const failures = [];
for (const top of SHIPS) {
  for (const file of files(path.join(root, top))) {
    const rel = path.relative(root, file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      // A comment may talk about the environment; only code handles it.
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
      const at = `${rel}:${i + 1}`;
      if (/DATABASE(_OWNER)?_URL/.test(line) && !OPENS_A_DATABASE_URL.has(rel))
        failures.push(
          `${at}: names a database URL outside the files that open one`,
        );
      // The environment is read one name at a time — `process.env.NAME`,
      // `process.env["NAME"]` or `const { NAME } = process.env` — never
      // spread, passed, printed or serialised whole.
      const whole = /process\.env(?![.[\w])/g;
      let m;
      while ((m = whole.exec(line))) {
        const before = line.slice(0, m.index);
        const destructured = /\}\s*=\s*$/.test(before);
        if (!destructured && !(top === "scripts" || SPREADS_ENV.has(rel)))
          failures.push(`${at}: handles the whole environment`);
      }
    });
  }
}

failures.sort();
if (failures.length) {
  console.error("secrets: refused");
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log("secrets: database URLs are named only where they are opened");
