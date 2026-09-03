// The whole local stack: this checkout's Postgres, migrated and seeded, and
// Next on a free port with the app role's URL.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "../packages/db/src/migrate.ts";
import { ensureRole, startPostgres } from "../packages/db/src/postgres.ts";
import { seed } from "../packages/db/src/seed.ts";

export const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export async function startStack({ webPort, stdio = "inherit" } = {}) {
  const pgPort = await freePort();
  webPort ??= await freePort();

  const cluster = await startPostgres(path.join(root, ".local", "pg"), pgPort);
  await ensureRole(cluster.url, "app");
  const applied = await migrate(
    cluster.url,
    path.join(root, "packages", "db", "migrations"),
  );
  await seed(cluster.url);

  const web = spawn("pnpm", ["exec", "next", "dev", "-p", String(webPort)], {
    cwd: path.join(root, "apps", "web"),
    stdio,
    env: {
      ...process.env,
      DATABASE_URL: `postgres://app@127.0.0.1:${pgPort}/postgres`,
    },
  });

  return {
    pgPort,
    webPort,
    url: `http://127.0.0.1:${webPort}`,
    applied,
    web,
    stop: () =>
      new Promise((resolve) => {
        web.once("exit", () => cluster.stop().then(resolve));
        web.kill("SIGTERM");
      }),
  };
}

export async function waitFor(url, ms = 60_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} did not answer within ${ms}ms`);
}
