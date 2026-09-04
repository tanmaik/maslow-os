// The whole local stack: this checkout's Postgres, migrated and seeded, and
// Next on a free port with the app role's URL.
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "../packages/db/src/migrate.ts";
import { ensureAppRole, startPostgres } from "../packages/db/src/postgres.ts";
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

const exited = (child) => child.exitCode !== null || child.signalCode !== null;

export async function startStack({
  webPort,
  stdio = "inherit",
  dataDir = path.join(root, ".local", "pg"),
  distDir = ".next",
  fresh = false,
} = {}) {
  const pgPort = await freePort();
  webPort ??= await freePort();

  const cluster = await startPostgres(dataDir, pgPort, { fresh });
  let applied;
  try {
    await ensureAppRole(cluster.url);
    applied = await migrate(
      cluster.url,
      path.join(root, "packages", "db", "migrations"),
    );
    await seed(cluster.url);
  } catch (err) {
    await cluster.stop();
    throw err;
  }

  const web = spawn(
    path.join(root, "apps", "web", "node_modules", ".bin", "next"),
    ["dev", "-p", String(webPort)],
    {
      cwd: path.join(root, "apps", "web"),
      stdio: stdio === "ignore" ? ["ignore", "ignore", "pipe"] : stdio,
      env: {
        ...process.env,
        DATABASE_URL: `postgres://app@127.0.0.1:${pgPort}/postgres`,
        NEXT_DIST_DIR: distDir,
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  );
  // Recent stderr, for startup errors.
  let stderr = "";
  web.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-2000)));

  const url = `http://127.0.0.1:${webPort}`;
  return {
    pgPort,
    webPort,
    url,
    applied,
    web,
    // Resolves once Next answers; fails at once if Next has died.
    ready: async (ms = 60_000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (exited(web))
          throw new Error(`next dev exited before answering:\n${stderr}`);
        try {
          if ((await fetch(url)).ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(`${url} did not answer within ${ms}ms:\n${stderr}`);
    },
    stop: async () => {
      if (!exited(web)) {
        await new Promise((resolve) => {
          web.once("exit", resolve);
          web.kill("SIGTERM");
        });
      }
      await cluster.stop();
    },
  };
}
