import type { Principal } from "@placeholder/db/auth";
import {
  computerOf,
  noteCause,
  secretIn,
  secretOf,
  type Computer,
} from "@placeholder/db/computers";
import { createHmac } from "node:crypto";

import { build, computersOn } from "./computer.ts";
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
// A file to land: where on the disk, where its bytes are, how many, and
// the id the machine gives back when it has landed.
export type Pull = { id: string; path: string; url: string; size: number };

export class DiskError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// What a route answers when the disk or a file refused: the sentence,
// with the status it came with, never a bare 500.
export function answer(err: unknown): Response {
  if (err instanceof DiskError)
    return new Response(err.message, { status: err.status });
  throw err;
}

function config() {
  const c = deployment.computers;
  if (c.kind !== "fly") throw new DiskError(503, "Computers are not set up.");
  return c;
}
// The key links are signed with, demanded the moment one is made.
function linkKey(): string {
  const key = process.env.LINK_SECRET ?? config().linkSecret;
  if (!key)
    throw new DiskError(503, "LINK_SECRET is not set; no link can be signed.");
  return key;
}
const host = () => config().host;

// The machine the disk is served by, made on the first touch.
async function machineOf(p: Principal): Promise<Computer> {
  if (!(await computersOn(p)))
    throw new DiskError(403, "Computers are off for this org.");
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
  const secret = await secretOf(p, c.id);
  let res: Response;
  try {
    res = await fetch(`${host()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        "fly-force-instance-id": c.machineId!,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // A machine waking from cold takes a few seconds.
      signal: AbortSignal.timeout(90_000),
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
  orgId: string,
  c: Computer,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  if (!c.machineId) throw new DiskError(503, "no machine");
  const res = await fetch(`${host()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await secretIn(orgId, c.id)}`,
      "fly-force-instance-id": c.machineId,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
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
  // Has the machine put a file on the disk from where its bytes are
  // staged; it carries on alone and says when the file has landed.
  pull: (p: Principal, f: Pull) =>
    call<{ started: boolean }>(p, "POST", "/fs/pull", f),

  ports: (p: Principal) => call<{ ports: number[] }>(p, "GET", "/fs/ports"),
  // What is on the disk, biggest first, and what the operating system takes.
  du: (p: Principal) =>
    call<{
      home: number;
      os: number;
      folders: { path: string; size: number }[];
      files: { path: string; size: number }[];
      disk: Space;
    }>(p, "GET", "/fs/du"),
  // The disk back from an archive, onto an empty one; the machine carries
  // on alone and says how it is going.
  restore: (p: Principal, url: string) =>
    call<{ started: boolean }>(p, "POST", "/fs/restore", { url }),
  restoring: (p: Principal) =>
    call<{
      running: boolean;
      last: { ok: boolean; error?: string; at: number } | null;
    }>(p, "GET", "/fs/restore"),
  // A fresh operating system around the home as it is, after a backup of
  // it unless one from the last hour stands; the machine carries on alone
  // and says how it is going.
  reset: (p: Principal, backedUp: boolean) =>
    call<{ started: boolean }>(p, "POST", "/fs/reset", { backedUp }),
  resetting: (p: Principal) =>
    call<{
      running: boolean;
      last: {
        ok: boolean;
        refused?: string;
        error?: string;
        at: number;
      } | null;
    }>(p, "GET", "/fs/reset"),
  // Asks a machine to back itself up; it carries on alone. For the sweep,
  // which has no person.
  async backupIn(orgId: string, c: Computer): Promise<void> {
    if (!c.machineId) return;
    const res = await fetch(`${host()}/fs/backup`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await secretIn(orgId, c.id)}`,
        "fly-force-instance-id": c.machineId,
      },
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok && res.status !== 202)
      throw new DiskError(res.status, `backup answered ${res.status}`);
  },

  // A link the browser follows to the machine itself for the bytes, good
  // for ten minutes, signed with the deployment's key and bound to what it
  // is for and which machine.
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
  // Why the machine may be woken next: this link.
  const before = await computerOf(p);
  if (before) await noteCause(p.orgId, before, `link-${kind}`);
  const c = await machineOf(p);
  const expires = Date.now() + 600_000;
  const sig = createHmac("sha256", linkKey())
    .update(`${kind}|${c.machineId}|${expires}|${what}`)
    .digest("base64url");
  // On the machine's own origin when the deployment has a domain for it.
  const base = config().domain
    ? `https://${c.machineId}.${config().domain}`
    : host();
  return `${base}/${kind}/${c.machineId}/${expires}/${sig}${tail}`;
}
