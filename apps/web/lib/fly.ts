import { deployment } from "./deployment.ts";

// The Fly Machines API, the part of it a computer needs. No SDK.
export type MachineState =
  | "created"
  | "starting"
  | "started"
  | "stopping"
  | "stopped"
  | "suspending"
  | "suspended"
  | "replacing"
  | "destroying"
  | "destroyed";

export type Machine = { id: string; state: MachineState; region: string };

// The bootstrap image: enough to mount the volume and answer for it.
export const IMAGE = "registry.fly.io/placeholder-computers:v1";
export const SIZE = "shared-cpu-1x:1024";
export const DISK_GB = 10;
// Fly's limit for one volume.
export const MAX_DISK_GB = 500;

// Fly names carry our id, so a sweep can tell ours apart and match an
// unrecorded one back to its row.

function config() {
  const c = deployment.computers;
  if (c.kind !== "fly") throw new Error("Computers are not set up here.");
  return c;
}

export const volumeName = (computerId: string) =>
  `${config().namePrefix.replaceAll("-", "_")}c_${computerId.replaceAll("-", "").slice(0, 16)}`;
export const machineName = (computerId: string) =>
  `${config().namePrefix}c-${computerId.slice(0, 8)}`;

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  gone?: "null",
): Promise<T> {
  const c = config();
  // The signal also keeps Next from handing one render a memoized copy of
  // an earlier GET: a machine's state is never the same answer twice.
  const res = await fetch(`${c.api}/v1/apps/${c.app}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${c.token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404 && gone) return null as T;
  if (!res.ok)
    throw new Error(
      `Fly ${method} ${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  return (await res.json()) as T;
}

export const fly = {
  async createVolume(name: string, sizeGb = DISK_GB): Promise<{ id: string }> {
    return call("POST", "/volumes", {
      name,
      region: config().region,
      size_gb: sizeGb,
    });
  },

  // A machine on its volume, made stopped: it is recorded before it runs.
  // It has no public address: nothing reaches it, so nothing but us can
  // start it, and it reports on itself to us instead.
  async createMachine(
    name: string,
    volumeId: string,
    secret: string,
  ): Promise<Machine> {
    const [cpuKind, rest] = SIZE.split("-cpu-");
    const [cpus, memoryMb] = rest!.split("x:");
    return call("POST", "/machines", {
      name,
      region: config().region,
      skip_launch: true,
      config: {
        image: IMAGE,
        env: {
          COMPUTER_SECRET: secret,
          REPORT_URL: config().report,
          ...(config().reportBypass
            ? { REPORT_BYPASS: config().reportBypass }
            : {}),
        },
        guest: {
          cpu_kind: cpuKind,
          cpus: Number(cpus),
          memory_mb: Number(memoryMb),
        },
        mounts: [{ volume: volumeId, path: "/data" }],
        restart: { policy: "always" },
        auto_destroy: false,
      },
    });
  },

  // Null once Fly no longer has it.
  machine(id: string): Promise<Machine | null> {
    return call("GET", `/machines/${id}`, undefined, "null");
  },

  // A new machine is "created" for a few seconds and cannot be started
  // until Fly has placed it and reports "stopped".
  async placed(id: string): Promise<Machine> {
    let m = await fly.machine(id);
    for (let i = 0; i < 60 && m?.state === "created"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      m = await fly.machine(id);
    }
    if (!m || m.state === "created")
      throw new Error(`Fly machine ${id} was not placed within a minute.`);
    return m;
  },

  async start(id: string): Promise<void> {
    await call("POST", `/machines/${id}/start`);
  },

  async stop(id: string): Promise<void> {
    await call("POST", `/machines/${id}/stop`);
  },

  // Gone for good. One already gone is fine. The machine goes first and is
  // waited for, since a volume in use cannot go; the volume is tried a few
  // times because Fly lets go of it a moment after the machine.
  async destroyMachine(id: string): Promise<void> {
    await call("DELETE", `/machines/${id}?force=true`, undefined, "null");
    for (let i = 0; i < 60; i++) {
      const m = await fly.machine(id);
      if (!m || m.state === "destroyed") return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Fly machine ${id} did not go within a minute.`);
  },

  async destroyVolume(id: string): Promise<void> {
    let last: unknown;
    for (let i = 0; i < 5; i++) {
      try {
        await call("DELETE", `/volumes/${id}`, undefined, "null");
        return;
      } catch (err) {
        last = err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    throw last;
  },

  // Bigger, never smaller. A running machine sees the room at its next
  // boot; one that is off sees it at once.
  async extendVolume(id: string, sizeGb: number): Promise<void> {
    await call("PUT", `/volumes/${id}/extend`, { size_gb: sizeGb });
  },
};
