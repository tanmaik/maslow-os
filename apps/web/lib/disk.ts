import type { Principal } from "@placeholder/db/auth";
import {
  computerOf,
  computersAllowed,
  type Computer,
} from "@placeholder/db/computers";
import { createHmac } from "node:crypto";

import { build } from "./computer.ts";
import { deployment } from "./deployment.ts";

// The person's disk, as the daemon on their machine serves it. Every call
// goes through Fly's proxy to the machine by id, which wakes it if it is
// asleep: opening the computer is what turns it on.
export type Entry = {
  name: string;
  kind: "file" | "folder";
  size: number;
  modified: string;
};
export type Space = { used: number; total: number };
export type Tree = { name: string; path: string; folders: Tree[] };

export class DiskError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function host() {
  const c = deployment.computers;
  if (c.kind !== "fly") throw new DiskError(503, "Computers are not set up.");
  return c.host;
}

// The machine the disk is served by, made on the first touch.
async function machineOf(p: Principal): Promise<Computer> {
  if (!(await computersAllowed(p)))
    throw new DiskError(403, "Computers are not available for this org.");
  let c = await computerOf(p);
  if (!c?.machineId || c.state === "failed") {
    let built;
    try {
      built = await build(p);
    } catch (err) {
      throw new DiskError(
        503,
        `Your computer could not be made: ${(err as Error).message}`,
      );
    }
    if (built === "off" || built === "not-allowed")
      throw new DiskError(503, "Computers are not available here.");
    c = await computerOf(p);
    // Another request may hold the build; it is done within a minute.
    for (let i = 0; i < 60 && !c?.machineId; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      c = await computerOf(p);
    }
  }
  if (!c?.machineId)
    throw new DiskError(
      503,
      "Your computer is being made; look again shortly.",
    );
  return c;
}

async function call<T>(
  p: Principal,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const c = await machineOf(p);
  let res: Response;
  try {
    res = await fetch(`${host()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${c.secret}`,
        "fly-force-instance-id": c.machineId!,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // A machine waking from cold takes a few seconds; a pull takes what
      // the file takes.
      signal: AbortSignal.timeout(path === "/fs/pull" ? 3600_000 : 90_000),
    });
  } catch (err) {
    throw new DiskError(
      503,
      `Your computer is not answering: ${(err as Error).message}`,
    );
  }
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { error?: string };
    throw new DiskError(
      res.status,
      error.error ?? `Your computer answered ${res.status}.`,
    );
  }
  return (await res.json()) as T;
}

const q = (path: string) => `?path=${encodeURIComponent(path)}`;

// For the sweep, which has no person: a call to a machine by its row.
export async function callIn<T>(
  c: Computer,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (!c.machineId) throw new DiskError(503, "no machine");
  const res = await fetch(`${host()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${c.secret}`,
      "fly-force-instance-id": c.machineId,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(path === "/fs/pull" ? 3600_000 : 90_000),
  });
  if (!res.ok) {
    const error = (await res.json().catch(() => ({}))) as { error?: string };
    throw new DiskError(
      res.status,
      error.error ?? `The machine answered ${res.status}.`,
    );
  }
  return (await res.json()) as T;
}

export const disk = {
  list: (p: Principal, path: string) =>
    call<{ entries: Entry[]; disk: Space }>(p, "GET", `/fs${q(path)}`),
  tree: (p: Principal) => call<{ tree: Tree }>(p, "GET", "/fs/tree"),
  stat: (p: Principal, path: string) =>
    call<{ kind: "file" | "folder"; size: number }>(
      p,
      "GET",
      `/fs/stat${q(path)}`,
    ).catch((err) => {
      if (err instanceof DiskError && err.status === 404) return null;
      throw err;
    }),
  mkdir: (p: Principal, path: string) =>
    call(p, "POST", "/fs/folder", { path }),
  move: (p: Principal, from: string, to: string) =>
    call(p, "POST", "/fs/move", { from, to }),
  remove: (p: Principal, path: string) => call(p, "DELETE", `/fs${q(path)}`),
  // Puts a file on the disk from where its bytes are staged.
  pull: (p: Principal, path: string, url: string, size: number) =>
    call<{ disk: Space }>(p, "POST", "/fs/pull", { path, url, size }),

  ports: (p: Principal) => call<{ ports: number[] }>(p, "GET", "/fs/ports"),

  // A link the browser follows to the machine itself for the bytes, good
  // for ten minutes, signed with the machine's own secret.
  downloadUrl: (p: Principal, path: string) =>
    link(p, "dl", path, `${q(path)}`),
  // A shell on the disk, over a WebSocket to the machine.
  terminalUrl: async (p: Principal) =>
    (await link(p, "term", "term")).replace(/^http/, "ws"),
  // A browser's view of an app the machine serves on a port.
  previewUrl: (p: Principal, port: number) =>
    link(p, "p", String(port), `/${port}`),
};

async function link(
  p: Principal,
  kind: "dl" | "term" | "p",
  what: string,
  tail = "",
): Promise<string> {
  const c = await machineOf(p);
  const expires = Date.now() + 600_000;
  const sig = createHmac("sha256", c.secret)
    .update(`${expires}|${what}`)
    .digest("base64url");
  return `${host()}/${kind}/${c.machineId}/${expires}/${sig}${tail}`;
}
