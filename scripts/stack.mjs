// The whole local stack: this checkout's Postgres, migrated and seeded, and
// Next on a free port with the app role's URL.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as decrypt } from "@dotenvx/dotenvx";

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

// Dev secrets travel with the repo, encrypted; the private key does not. With
// the key, vendors are real; without it, they are faked.
export function devSecrets() {
  const keysFile = path.join(root, ".env.keys");
  if (!process.env.DOTENV_PRIVATE_KEY_DEVELOPMENT && !fs.existsSync(keysFile)) {
    return null;
  }
  const { parsed, error } = decrypt({
    path: path.join(root, ".env.development"),
    envKeysFile: keysFile,
    processEnv: {},
    quiet: true,
  });
  if (error) {
    throw new Error(
      `.env.development could not be decrypted (${error.code}). ` +
        "Is DOTENV_PRIVATE_KEY_DEVELOPMENT the current key?",
    );
  }
  const { DOTENV_PUBLIC_KEY_DEVELOPMENT, ...values } = parsed;
  return values;
}

const exited = (child) => child.exitCode !== null || child.signalCode !== null;

export async function startStack({
  webPort,
  stdio = "inherit",
  dataDir = path.join(root, ".local", "pg"),
  distDir = ".next",
  fresh = false,
  secrets = true,
} = {}) {
  const values = secrets ? devSecrets() : null;
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
        ...values,
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
    secrets: values && Object.keys(values).length,
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
