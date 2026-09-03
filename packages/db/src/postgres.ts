import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import pg from "pg";

const run = promisify(execFile);
const require = createRequire(import.meta.url);

export type Cluster = {
  url: string;
  stop: () => Promise<void>;
};

// Locates this platform's Postgres binaries inside its npm package.
function native(): { bin: string; lib: string } {
  const name = `@embedded-postgres/${process.platform}-${process.arch}`;
  let root: string;
  try {
    // The package exports only dist/index.js; its root is two levels up.
    root = path.dirname(path.dirname(require.resolve(name)));
  } catch {
    throw new Error(
      `No Postgres binaries for ${process.platform}-${process.arch}. ` +
        `Add ${name} to packages/db/package.json optionalDependencies.`,
    );
  }
  return { bin: path.join(root, "native", "bin"), lib: path.join(root, "native", "lib") };
}

// Starts a Postgres cluster in dataDir on the given port, creating it first if
// it is new. Trust auth on loopback only; the socket lives inside dataDir so
// two checkouts never share one.
export async function startPostgres(dataDir: string, port: number): Promise<Cluster> {
  if (process.getuid?.() === 0) {
    throw new Error(
      "Postgres refuses to run as root. Run `pnpm dev` as an unprivileged user " +
        "(inside a container: `useradd -m dev && su dev`).",
    );
  }
  const { bin, lib } = native();
  const env = { ...process.env, LD_LIBRARY_PATH: lib, DYLD_LIBRARY_PATH: lib };

  if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
    fs.mkdirSync(dataDir, { recursive: true });
    await run(
      path.join(bin, "initdb"),
      ["-D", dataDir, "-U", "postgres", "-A", "trust", "--no-sync", "-E", "UTF8"],
      { env },
    );
  }

  const child = spawn(
    path.join(bin, "postgres"),
    ["-D", dataDir, "-p", String(port), "-k", dataDir, "-c", "listen_addresses=127.0.0.1"],
    { env, stdio: ["ignore", "ignore", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));

  const url = `postgres://postgres@127.0.0.1:${port}/postgres`;
  const deadline = Date.now() + 15_000;
  while (true) {
    if (child.exitCode !== null) {
      throw new Error(`Postgres exited before it was ready:\n${stderr}`);
    }
    const probe = new pg.Client({ connectionString: url });
    try {
      await probe.connect();
      await probe.end();
      break;
    } catch {
      if (Date.now() > deadline) {
        child.kill();
        throw new Error(`Postgres did not become ready within 15s:\n${stderr}`);
      }
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return {
    url,
    stop: () =>
      new Promise((resolve) => {
        child.once("exit", () => resolve());
        child.kill("SIGINT");
      }),
  };
}

// Creates a login role if it does not exist. Roles are cluster-level, so
// they are set up here rather than in a migration.
export async function ensureRole(url: string, name: string): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const exists = await client.query("select 1 from pg_roles where rolname = $1", [name]);
    if (exists.rowCount === 0) await client.query(`create role "${name}" login`);
  } finally {
    await client.end();
  }
}
