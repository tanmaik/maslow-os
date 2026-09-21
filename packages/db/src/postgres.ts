import { execFile, execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
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

type Layout = {
  bin: string;
  lib: string;
  dataDir: string;
  // Wraps a command so it runs as the right OS user with its libraries found.
  as: (cmd: string, args: string[]) => { cmd: string; args: string[] };
};

// Locates this platform's Postgres binaries inside its npm package.
function native(): { root: string; bin: string; lib: string } {
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
  return {
    root,
    bin: path.join(root, "native", "bin"),
    lib: path.join(root, "native", "lib"),
  };
}

const ROOT_BOX_USER = "maslow-pg";

// Where the cluster lives and who runs it. On a root box Postgres runs as a
// dedicated user from /var/tmp, because the checkout is usually mode 0700.
function layout(dataDir: string, fresh: boolean): Layout {
  const { root, bin, lib } = native();
  if (process.getuid?.() !== 0) {
    if (fresh) fs.rmSync(dataDir, { recursive: true, force: true });
    return { bin, lib, dataDir, as: (cmd, args) => ({ cmd, args }) };
  }

  execFileSync("sh", [
    "-c",
    `id -u ${ROOT_BOX_USER} >/dev/null 2>&1 || useradd -r -M -s /usr/sbin/nologin ${ROOT_BOX_USER}`,
  ]);
  const idOf = (flag: string) =>
    Number(execFileSync("id", [flag, ROOT_BOX_USER], { encoding: "utf8" }));
  const uid = idOf("-u");
  const gid = idOf("-g");

  const version = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ).version;
  const base = path.join("/var/tmp", "maslow-pg");
  const binaries = path.join(base, "native", version);
  if (!fs.existsSync(binaries)) {
    fs.cpSync(path.join(root, "native"), binaries, { recursive: true });
    execFileSync("chmod", ["-R", "a+rX", binaries]);
  }
  const data = path.join(
    base,
    "data",
    createHash("sha256").update(dataDir).digest("hex").slice(0, 12),
  );
  if (fresh) fs.rmSync(data, { recursive: true, force: true });
  fs.mkdirSync(data, { recursive: true });
  fs.chownSync(data, uid, gid);

  const copiedLib = path.join(binaries, "lib");
  return {
    bin: path.join(binaries, "bin"),
    lib: copiedLib,
    dataDir: data,
    as: (cmd, args) => ({
      cmd: "setpriv",
      args: [
        `--reuid=${uid}`,
        `--regid=${gid}`,
        "--clear-groups",
        "--",
        "env",
        `LD_LIBRARY_PATH=${copiedLib}`,
        cmd,
        ...args,
      ],
    }),
  };
}

// Whether a child process has ended, by exit or by signal.
export const exited = (child: {
  exitCode: number | null;
  signalCode: string | null;
}) => child.exitCode !== null || child.signalCode !== null;

// Starts a Postgres cluster for this checkout on the given port, creating it
// first if it is new or `fresh` was asked for. Trust auth on loopback only,
// over TCP alone: a Unix socket's path is capped at 103 bytes, which a
// worktree's scratch directory passes, and nothing of ours uses one. A
// temporary cluster removes its data when stopped, also on a root box.
export async function startPostgres(
  dataDir: string,
  port: number,
  { fresh = false, temporary = false } = {},
): Promise<Cluster> {
  const l = layout(path.resolve(dataDir), fresh);
  // Set on the child directly, never through /usr/bin/env: macOS strips DYLD_* there.
  const env = {
    ...process.env,
    LD_LIBRARY_PATH: l.lib,
    DYLD_LIBRARY_PATH: l.lib,
  };

  if (!fs.existsSync(path.join(l.dataDir, "PG_VERSION"))) {
    fs.mkdirSync(l.dataDir, { recursive: true });
    const init = l.as(path.join(l.bin, "initdb"), [
      "-D",
      l.dataDir,
      "-U",
      "postgres",
      "-A",
      "trust",
      "--no-sync",
      "-E",
      "UTF8",
    ]);
    await run(init.cmd, init.args, { env });
  }

  const server = l.as(path.join(l.bin, "postgres"), [
    "-D",
    l.dataDir,
    "-p",
    String(port),
    "-c",
    "unix_socket_directories=",
    "-c",
    "listen_addresses=127.0.0.1",
  ]);
  const child = spawn(server.cmd, server.args, {
    env,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d));

  const url = `postgres://postgres@127.0.0.1:${port}/postgres`;
  const deadline = Date.now() + 15_000;
  while (true) {
    if (exited(child)) {
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
    stop: async () => {
      if (!exited(child)) {
        await new Promise<void>((resolve) => {
          child.once("exit", () => resolve());
          child.kill("SIGINT");
        });
      }
      if (temporary) fs.rmSync(l.dataDir, { recursive: true, force: true });
    },
  };
}

// The restricted role the app connects as. Cluster-level, so it is made here
// rather than in a migration. Given a password, the role signs in with it.
export async function ensureAppRole(
  url: string,
  password?: string,
): Promise<void> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const exists = await client.query(
      "select 1 from pg_roles where rolname = 'app'",
    );
    if (exists.rowCount === 0) await client.query("create role app login");
    if (password)
      await client.query(
        `alter role app password ${client.escapeLiteral(password)}`,
      );
  } finally {
    await client.end();
  }
}
