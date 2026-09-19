import {
  DiskGone,
  CloudRefused,
  type Cloud,
  type Machine,
  type Place,
  type RelayShape,
  type Shape,
} from "../clouds.ts";
import { deployment } from "../deployment.ts";

// Computers on Fly: a machine on a volume per person in one Fly app, a
// door reached through Fly's edge, and images in Fly's registry. The Fly
// Machines API, the part of it a computer needs. No SDK.

// Images live in Fly's registry, one repository for every environment,
// each pushed by hand by its label: the computer's from apps/computer,
// and the relay's from the repo's root with
//   fly deploy --build-only --push --remote-only --image-label sync-N \
//     --config packages/sync/fly.toml --dockerfile packages/sync/Dockerfile .
const image = (label: string) =>
  `registry.fly.io/maslow-computers-dev:${label}`;

// A machine, a disk and a copy of one as Fly's API answers them.
type FlyMachine = {
  id: string;
  name: string;
  state: string;
  region: string;
  config?: {
    image?: string;
    env?: Record<string, string>;
    guest?: { cpu_kind?: string; cpus?: number; memory_mb?: number };
    metadata?: Record<string, string>;
    mounts?: { volume?: string | null; path: string }[];
  };
};
type FlyVolume = {
  id: string;
  name: string;
  region: string;
  state: string;
  size_gb: number;
};
type FlySnapshot = { id: string; status: string };

// A machine as the product reads it: Fly's states in our words, its image
// back to the label it was named by (the registry in front and the digest
// after are Fly's), and a mount Fly names without a disk no disk at all.
const machineOf = (m: FlyMachine): Machine => {
  const g = m.config?.guest;
  return {
    id: m.id,
    name: m.name,
    state:
      m.state === "started"
        ? "running"
        : m.state === "stopped"
          ? "stopped"
          : /destroy/.test(m.state)
            ? "gone"
            : "changing",
    region: m.region,
    image: m.config?.image?.split("@")[0].split(":").at(-1) ?? null,
    size: { cpuKind: g?.cpu_kind, cpus: g?.cpus, memoryMb: g?.memory_mb },
    env: m.config?.env ?? {},
    tags: m.config?.metadata ?? {},
    disks: (m.config?.mounts ?? [])
      .map((mount) => mount.volume)
      .filter((id): id is string => Boolean(id)),
  };
};

// A disk as the product reads it: ready once Fly says it is created,
// gone once Fly is destroying it.
const volumeOf = (v: FlyVolume) => ({
  id: v.id,
  name: v.name,
  region: v.region,
  state: (v.state === "created"
    ? "ready"
    : /destroy/.test(v.state)
      ? "gone"
      : "filling") as "ready" | "filling" | "gone",
  sizeGb: v.size_gb,
});

// The North American regions Fly still makes disks in. Fly retires
// regions now and then, and one it retired refuses a new disk, so the
// list is what Fly offers and no more; Ashburn first.
const REGIONS: Record<string, Place> = {
  iad: { name: "Ashburn", at: [38.9, -77.04] },
  ord: { name: "Chicago", at: [41.88, -87.63] },
  dfw: { name: "Dallas", at: [32.78, -96.8] },
  lax: { name: "Los Angeles", at: [34.05, -118.24] },
  ewr: { name: "Newark", at: [40.74, -74.17] },
  sjc: { name: "San Jose", at: [37.34, -121.89] },
  yyz: { name: "Toronto", at: [43.65, -79.38] },
};

// Where the relay's machine runs: next to the database's region, which is
// where the app runs too.
const RELAY_REGION = "ord";

const shape = (m: Shape) => ({
  image: image(m.image),
  env: {
    DOOR_SECRET: m.secret,
    DOMAIN: config().domain,
    PERSON: m.who.person,
    ORG: m.who.org,
    ...(m.brain ? { BRAIN_URL: m.brain.url, BRAIN_TOKEN: m.brain.token } : {}),
    ...(m.model ? { MODEL_URL: m.model.url, MODEL_TOKEN: m.model.token } : {}),
  },
  guest: { cpu_kind: m.cpuKind, cpus: m.cpus, memory_mb: m.memoryMb },
  // Two gigabytes of disk standing in for memory, so a machine that
  // outgrows its memory slows down rather than losing what it was running.
  swap_size_mb: 2048,
  mounts: [{ volume: m.volumeId, path: "/data" }],
  services: [
    {
      protocol: "tcp",
      internal_port: 8080,
      autostart: false,
      autostop: "off",
      ports: [{ port: 443, handlers: ["tls", "http"] }],
    },
  ],
  metadata: m.metadata,
  restart: { policy: "always" },
  auto_destroy: false,
});

const relayShape = (m: RelayShape) => ({
  image: image(m.image),
  env: { SYNC_PORT: "8080", SYNC_SECRET: m.secret, DOMAIN: config().domain },
  guest: { cpu_kind: "shared", cpus: 1, memory_mb: 512 },
  services: [
    {
      protocol: "tcp",
      internal_port: 8080,
      autostart: false,
      autostop: "off",
      ports: [{ port: 443, handlers: ["tls", "http"] }],
    },
  ],
  metadata: m.metadata,
  restart: { policy: "always" },
  auto_destroy: false,
});

function config() {
  const c = deployment.computers;
  if (c.kind !== "fly") throw new Error("Computers are off here.");
  return c;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  gone?: "null",
): Promise<T> {
  const c = config();
  const res = await fetch(`https://api.machines.dev/v1/apps/${c.app}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${c.token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404 && gone) return null as T;
  const text = await res.text();
  if (!res.ok)
    throw new CloudRefused(
      "Fly",
      res.status,
      text.slice(0, 300),
      `${method} ${path}`,
    );
  // A tag or a stop answers with nothing.
  return (text ? JSON.parse(text) : null) as T;
}

// A machine as Fly has it, or null once Fly no longer does.
const raw = (id: string) =>
  call<FlyMachine | null>("GET", `/machines/${id}`, undefined, "null");

export const fly: Cloud = {
  regions: REGIONS,

  // The Fly edge that answers this server is the region nearest it.
  async edge() {
    try {
      const res = await fetch("https://debug.fly.dev", {
        signal: AbortSignal.timeout(3_000),
      });
      return res.headers.get("fly-region");
    } catch {
      return null;
    }
  },

  createVolume(name, region, sizeGb) {
    return call("POST", "/volumes", { name, region, size_gb: sizeGb });
  },

  // A machine on its disk, started, running until it is stopped: its door
  // on its port behind Fly's edge, opened by a ticket signed with the
  // computer's secret, at its own name under the deployment's domain.
  async createMachine(m) {
    try {
      return machineOf(
        await call("POST", "/machines", {
          name: m.name,
          region: m.region,
          config: shape(m),
        }),
      );
    } catch (err) {
      if (err instanceof CloudRefused && /volume not found/i.test(err.said))
        throw new DiskGone(err.cloud, err.status, err.said, err.call);
      throw err;
    }
  },

  // Fly restarts the machine into its new shape in seconds, on the same
  // disk.
  async reshape(id, m) {
    await call("POST", `/machines/${id}`, { config: shape(m) });
  },

  async createRelay(m) {
    return machineOf(
      await call("POST", "/machines", {
        name: m.name,
        region: RELAY_REGION,
        config: relayShape(m),
      }),
    );
  },
  async reshapeRelay(id, m) {
    await call("POST", `/machines/${id}`, { config: relayShape(m) });
  },

  async machines() {
    return (await call<FlyMachine[]>("GET", "/machines")).map(machineOf);
  },

  async volumes() {
    return (await call<FlyVolume[]>("GET", "/volumes")).map(volumeOf);
  },

  async volume(id) {
    const v = await call<FlyVolume | null>(
      "GET",
      `/volumes/${id}`,
      undefined,
      "null",
    );
    return v && volumeOf(v);
  },

  async keepSnapshots(id, days) {
    await call("PUT", `/volumes/${id}`, { snapshot_retention: days });
  },

  async snapshot(volumeId) {
    const r = await call<{ Msg?: { backup?: { graph_id?: string } } }>(
      "POST",
      `/volumes/${volumeId}/snapshots`,
    );
    const id = r?.Msg?.backup?.graph_id;
    if (!id) throw new Error("Fly made a snapshot but did not name it.");
    return { id, ready: false };
  },

  async snapshots(volumeId) {
    return (
      await call<FlySnapshot[]>("GET", `/volumes/${volumeId}/snapshots`)
    ).map((s) => ({ id: s.id, ready: s.status === "created" }));
  },

  // Fly fills the disk in the background.
  restoreVolume(name, region, sizeGb, snapshotId) {
    return call("POST", "/volumes", {
      name,
      region,
      size_gb: sizeGb,
      snapshot_id: snapshotId,
    });
  },

  async stopped(id, seconds) {
    for (let i = 0; i < seconds; i++) {
      const m = await fly.machine(id);
      if (!m || m.state === "stopped") return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  },

  async extendVolume(id, sizeGb) {
    const r = await call<{ needs_restart?: boolean }>(
      "PUT",
      `/volumes/${id}/extend`,
      { size_gb: sizeGb },
    );
    return { needsRestart: Boolean(r.needs_restart) };
  },

  async machine(id) {
    const m = await raw(id);
    return m && machineOf(m);
  },

  // Asked of a machine already up, Fly answers 409: that is the state
  // wanted.
  async start(id) {
    await call("POST", `/machines/${id}/start`).catch((err: Error) => {
      if (!/ answered 409:/.test(err.message)) throw err;
    });
  },

  async stop(id) {
    await call("POST", `/machines/${id}/stop`);
  },

  async restart(id) {
    await call("POST", `/machines/${id}/restart`);
  },

  async tag(id, key, value) {
    await call("POST", `/machines/${id}/metadata/${key}`, { value });
  },

  // The disk is let go of a moment after the machine, so it is tried a
  // few times.
  async destroyMachine(id) {
    await call("DELETE", `/machines/${id}?force=true`, undefined, "null");
    for (let i = 0; i < 60; i++) {
      const m = await raw(id);
      if (!m || m.state === "destroyed") return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Fly machine ${id} did not go within a minute.`);
  },

  async destroyVolume(id) {
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

  // Every door is reached at the app's own name on Fly's edge, which
  // carries the request to the machine it is told to.
  door(machineId) {
    return {
      url: `https://${config().app}.fly.dev`,
      headers: { "fly-force-instance-id": machineId },
    };
  },
};
