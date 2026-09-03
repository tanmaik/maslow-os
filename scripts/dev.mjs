// One command: a Postgres of this checkout's own, migrated and seeded, then
// Next on a free port with the app role's URL.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "../packages/db/src/migrate.ts";
import { ensureRole, startPostgres } from "../packages/db/src/postgres.ts";
import { seed } from "../packages/db/src/seed.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const pgPort = await freePort();
const webPort = process.env.PORT ?? (await freePort());

const cluster = await startPostgres(path.join(root, ".local", "pg"), pgPort);
console.log(`postgres  127.0.0.1:${pgPort}`);

await ensureRole(cluster.url, "app");

const applied = await migrate(cluster.url, path.join(root, "packages", "db", "migrations"));
for (const name of applied) console.log(`migrated  ${name}`);
await seed(cluster.url);
console.log("seeded");

const appUrl = `postgres://app@127.0.0.1:${pgPort}/postgres`;
const web = spawn("pnpm", ["exec", "next", "dev", "-p", String(webPort)], {
  cwd: path.join(root, "apps", "web"),
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: appUrl },
});

async function shutdown() {
  web.kill("SIGTERM");
  await cluster.stop();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
web.on("exit", () => cluster.stop().then(() => process.exit(0)));
