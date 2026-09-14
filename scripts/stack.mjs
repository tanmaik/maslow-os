// The whole local stack: this checkout's Postgres, migrated and seeded, and
// Next on a free port with the app role's URL.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

import { config as decrypt } from "@dotenvx/dotenvx";

import { migrate } from "../packages/db/src/migrate.ts";
import {
  ensureAppRole,
  exited,
  startPostgres,
} from "../packages/db/src/postgres.ts";
import { orgs, seed } from "../packages/db/src/seed.ts";
import { seedBrain } from "../packages/brain/src/seed.ts";

import { root } from "./root.mjs";

// This checkout's name at Fly: its path, hashed short.
export const checkout = `laptop-${createHash("sha1").update(root).digest("hex").slice(0, 8)}`;
export { root };

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
  // dotenvx looks for the key in the object it is given; the real environment
  // is never that object, so nothing decrypted leaks into it.
  const { DOTENV_PRIVATE_KEY_DEVELOPMENT } = process.env;
  const { parsed, error } = decrypt({
    path: path.join(root, ".env.development"),
    envKeysFile: keysFile,
    processEnv: { DOTENV_PRIVATE_KEY_DEVELOPMENT },
    quiet: true,
  });
  if (error) {
    throw new Error(
      `.env.development could not be decrypted (${error.code}). ` +
        "Run `pnpm env:pull` for the current key.",
    );
  }
  const { DOTENV_PUBLIC_KEY_DEVELOPMENT, ...values } = parsed;
  return values;
}

// Which vendor each contract has, from the environment the app will read:
// the vendor's name when it is real, null when the app will fake it.
function vendorsOf(env) {
  const has = (...keys) => keys.every((k) => env[k]);
  return {
    identity: has("WORKOS_API_KEY", "WORKOS_CLIENT_ID") ? "WorkOS" : null,
    mail: has("RESEND_API_KEY", "MAIL_FROM") ? "Resend" : null,
    analytics: has("POSTHOG_KEY") ? "PostHog" : null,
    storage: has(
      "STORAGE_ENDPOINT",
      "STORAGE_REGION",
      "STORAGE_BUCKET",
      "STORAGE_ACCESS_KEY",
      "STORAGE_SECRET_KEY",
    )
      ? "S3"
      : null,
    computers: has("FLY_API_TOKEN", "FLY_COMPUTERS_APP") ? "Fly" : null,
    connections: has("COMPOSIO_API_KEY") ? "Composio" : null,
    embeddings: has("VOYAGE_API_KEY") ? "Voyage" : null,
    sync: has("SYNC_URL", "SYNC_SECRET") ? "relay" : null,
  };
}

export async function startStack({
  webPort,
  stdio = "inherit",
  dataDir = path.join(root, ".local", "pg"),
  distDir = ".next",
  fresh = false,
  secrets = true,
  env: extraEnv = {},
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
    await seedBrain(cluster.url, orgs);
  } catch (err) {
    await cluster.stop();
    throw err;
  }

  // The relay for live editing runs beside the app, on a port of its own
  // and a secret the two share for the life of this stack.
  const syncPort = await freePort();
  const syncSecret =
    process.env.SYNC_SECRET ?? randomBytes(24).toString("base64url");
  const sync = spawn(
    process.execPath,
    [path.join(root, "packages", "sync", "src", "main.ts")],
    {
      stdio: stdio === "ignore" ? ["ignore", "ignore", "pipe"] : stdio,
      env: {
        ...process.env,
        ...extraEnv,
        SYNC_PORT: String(syncPort),
        SYNC_SECRET: syncSecret,
      },
    },
  );
  const live = {
    SYNC_URL: `ws://127.0.0.1:${syncPort}`,
    SYNC_SECRET: syncSecret,
    // Where the relay calls this app back.
    APP_URL: `http://127.0.0.1:${webPort}`,
  };

  const web = spawn(
    path.join(root, "apps", "web", "node_modules", ".bin", "next"),
    ["dev", "-p", String(webPort)],
    {
      cwd: path.join(root, "apps", "web"),
      stdio: stdio === "ignore" ? ["ignore", "ignore", "pipe"] : stdio,
      env: {
        ...process.env,
        ...values,
        ...live,
        DATABASE_URL: `postgres://app@127.0.0.1:${pgPort}/postgres`,
        // The machines this checkout makes carry its name, so its own
        // dev server renews their lease and no other's.
        CHECKOUT: checkout,
        NEXT_DIST_DIR: distDir,
        NEXT_TELEMETRY_DISABLED: "1",
        ...extraEnv,
      },
    },
  );
  // Recent stderr, for startup errors.
  let stderr = "";
  web.stderr?.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
  let syncStderr = "";
  sync.stderr?.on("data", (d) => (syncStderr = (syncStderr + d).slice(-2000)));

  const url = `http://127.0.0.1:${webPort}`;
  return {
    pgPort,
    webPort,
    url,
    applied,
    secrets: values && Object.keys(values).length,
    vendors: vendorsOf({ ...process.env, ...values, ...live, ...extraEnv }),
    // What the web process was given, for the dev script's own calls.
    env: { ...process.env, ...values, ...live, ...extraEnv },
    // What the relay said on stderr lately, and whether it is still up.
    sync: {
      url: live.SYNC_URL,
      said: () => syncStderr,
      up: () => !exited(sync),
    },
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
      // The relay first, so its last saves find the app still up.
      for (const child of [sync, web]) {
        if (exited(child)) continue;
        await new Promise((resolve) => {
          child.once("exit", resolve);
          child.kill("SIGTERM");
        });
      }
      await cluster.stop();
    },
  };
}
