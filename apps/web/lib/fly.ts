import { deployment } from "./deployment.ts";

// The Fly Machines API, the part of it a computer needs. No SDK.
export type Machine = {
  id: string;
  name: string;
  state: string;
  region: string;
  created_at: string;
  config?: {
    image?: string;
    env?: Record<string, string>;
    guest?: { cpu_kind?: string; cpus?: number; memory_mb?: number };
    metadata?: Record<string, string>;
    mounts?: { volume: string; path: string }[];
  };
};

// A disk as Fly has it: restoring while it is filled from a snapshot,
// created once it is whole, and the machine holding it, if one does.
export type Volume = {
  id: string;
  name: string;
  region: string;
  state: string;
  size_gb: number;
  attached_machine_id: string | null;
};

// A copy of a disk at a moment, running until it is whole.
export type Snapshot = { id: string; status: string };

// One thing in a folder of the person's home: its name, what kind of thing
// it is, its size in bytes, and when it last changed.
export type Entry = {
  name: string;
  kind: "dir" | "file" | "link" | "other";
  size: number;
  modified: string;
};

// What a machine says of itself: CPU percent over the last moment, memory
// used and total, the bytes the person holds, the disk's size, and the
// ports listening inside with what listens.
export type Stats = {
  cpu: number;
  memory: { used: number; total: number };
  used: number | null;
  disk: number | null;
  // Room left on the whole disk; absent from a machine on an older image.
  free?: number | null;
  // Whose account Claude Code runs on there; absent from an older image.
  auth?: "managed" | "own" | "none";
  ports: { port: number; name: string }[];
};

// What came of a backup: the key it went to, when it started and ended,
// its size, and what went wrong if anything.
export type Backup = {
  key: string;
  startedAt: string;
  finishedAt: string | null;
  bytes: number | null;
  error: string | null;
};

// What a machine is made of: its image, its door's secret and domain, the
// brain's address and the session it reaches it with, who the person is on
// it, its size, its disk, its one port behind Fly's edge, and its tags.
export type Shape = {
  image: string;
  volumeId: string;
  cpuKind: "shared" | "performance";
  cpus: number;
  memoryMb: number;
  secret: string;
  brain: { url: string; token: string } | null;
  // The account's name and the machine's, so a prompt reads wile@acme.
  who: { person: string; org: string };
  // The OpenRouter key Claude Code inside runs on, or none.
  modelKey: string | null;
  metadata: Record<string, string>;
};

const shape = (m: Shape) => ({
  image: m.image,
  env: {
    DOOR_SECRET: m.secret,
    DOMAIN: config().domain,
    PERSON: m.who.person,
    ORG: m.who.org,
    ...(m.brain ? { BRAIN_URL: m.brain.url, BRAIN_TOKEN: m.brain.token } : {}),
    ...(m.modelKey ? { MODEL_KEY: m.modelKey } : {}),
  },
  guest: { cpu_kind: m.cpuKind, cpus: m.cpus, memory_mb: m.memoryMb },
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

// What the relay's machine is made of: its image, the secret it shares
// with the app, one port behind Fly's edge, and its tags. No disk: it
// holds nothing that outlives a document being open.
export type RelayShape = {
  image: string;
  secret: string;
  metadata: Record<string, string>;
};
const relayShape = (m: RelayShape) => ({
  image: m.image,
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
    throw new Error(
      `Fly ${method} ${path} answered ${res.status}: ${text.slice(0, 300)}`,
    );
  // A tag or a stop answers with nothing.
  return (text ? JSON.parse(text) : null) as T;
}

export const fly = {
  createVolume(
    name: string,
    region: string,
    sizeGb: number,
  ): Promise<{ id: string }> {
    return call("POST", "/volumes", { name, region, size_gb: sizeGb });
  },

  // A machine on its disk, started, running until it is stopped: its door
  // on its port behind Fly's edge, opened by a ticket signed with the
  // computer's secret, at its own name under the deployment's domain.
  createMachine(m: Shape & { name: string; region: string }): Promise<Machine> {
    return call("POST", "/machines", {
      name: m.name,
      region: m.region,
      config: shape(m),
    });
  },

  // The same machine remade to a shape, a newer image most often: Fly
  // restarts it into it in seconds, on the same disk.
  async reshape(id: string, m: Shape): Promise<void> {
    await call("POST", `/machines/${id}`, { config: shape(m) });
  },

  // The relay's machine, and the same remade to a newer image.
  createRelay(
    m: RelayShape & { name: string; region: string },
  ): Promise<Machine> {
    return call("POST", "/machines", {
      name: m.name,
      region: m.region,
      config: relayShape(m),
    });
  },
  async reshapeRelay(id: string, m: RelayShape): Promise<void> {
    await call("POST", `/machines/${id}`, { config: relayShape(m) });
  },

  machines(): Promise<Machine[]> {
    return call("GET", "/machines");
  },

  volumes(): Promise<Volume[]> {
    return call("GET", "/volumes");
  },

  // Null once Fly no longer has it.
  volume(id: string): Promise<Volume | null> {
    return call("GET", `/volumes/${id}`, undefined, "null");
  },

  // How many days Fly keeps the disk's snapshots, from the next one on.
  async keepSnapshots(id: string, days: number): Promise<void> {
    await call("PUT", `/volumes/${id}`, { snapshot_retention: days });
  },

  // A copy of the disk this moment, made in the background: the copy's
  // id, which its listing then says the status of.
  async snapshot(volumeId: string): Promise<Snapshot> {
    const r = await call<{ Msg?: { backup?: { graph_id?: string } } }>(
      "POST",
      `/volumes/${volumeId}/snapshots`,
    );
    const id = r?.Msg?.backup?.graph_id;
    if (!id) throw new Error("Fly made a snapshot but did not name it.");
    return { id, status: "running" };
  },

  snapshots(volumeId: string): Promise<Snapshot[]> {
    return call("GET", `/volumes/${volumeId}/snapshots`);
  },

  // A disk filled from a snapshot, in a region, no smaller than the disk
  // the snapshot was of. Fly fills it in the background: the disk says
  // "created" once it is whole.
  restoreVolume(
    name: string,
    region: string,
    sizeGb: number,
    snapshotId: string,
  ): Promise<{ id: string }> {
    return call("POST", "/volumes", {
      name,
      region,
      size_gb: sizeGb,
      snapshot_id: snapshotId,
    });
  },

  // Whether the machine has come to a stop, waited for up to the seconds
  // given.
  async stopped(id: string, seconds: number): Promise<boolean> {
    for (let i = 0; i < seconds; i++) {
      const m = await fly.machine(id);
      if (!m || m.state === "stopped") return true;
      await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
  },

  // Grows a disk to a size while its machine runs. Fly says whether the
  // machine must be restarted before it sees the room.
  async extendVolume(
    id: string,
    sizeGb: number,
  ): Promise<{ needsRestart: boolean }> {
    const r = await call<{ needs_restart?: boolean }>(
      "PUT",
      `/volumes/${id}/extend`,
      { size_gb: sizeGb },
    );
    return { needsRestart: Boolean(r.needs_restart) };
  },

  // Null once Fly no longer has it.
  machine(id: string): Promise<Machine | null> {
    return call("GET", `/machines/${id}`, undefined, "null");
  },

  // Asked of a machine already up, Fly answers 409: that is the state
  // wanted.
  async start(id: string): Promise<void> {
    await call("POST", `/machines/${id}/start`).catch((err: Error) => {
      if (!/ answered 409:/.test(err.message)) throw err;
    });
  },

  async stop(id: string): Promise<void> {
    await call("POST", `/machines/${id}/stop`);
  },

  // A reboot: every running process ends, and only the disk remains.
  async restart(id: string): Promise<void> {
    await call("POST", `/machines/${id}/restart`);
  },

  // The lease and anything else a machine is tagged with, without a
  // restart.
  async tag(id: string, key: string, value: string): Promise<void> {
    await call("POST", `/machines/${id}/metadata/${key}`, { value });
  },

  // Gone for good; one already gone is fine. The disk is let go of a
  // moment after the machine, so it is tried a few times.
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

  // The machine's numbers, asked of its door with a ticket it takes.
  async stats(machineId: string, ticket: string): Promise<Stats> {
    const res = await fetch(`https://${config().app}.fly.dev/maslow/stats`, {
      headers: {
        "fly-force-instance-id": machineId,
        "x-maslow-ticket": ticket,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`the door answered ${res.status}`);
    return (await res.json()) as Stats;
  },

  // What came of the machine's last backup, asked of its door with a
  // ticket it takes: null before any.
  async lastBackup(machineId: string, ticket: string): Promise<Backup | null> {
    const res = await fetch(`https://${config().app}.fly.dev/maslow/backup`, {
      headers: {
        "fly-force-instance-id": machineId,
        "x-maslow-ticket": ticket,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`the door answered ${res.status}`);
    return (await res.json()) as Backup | null;
  },

  // Asks the machine's door to archive the home and upload it to an
  // address signed for it. False when one is already running.
  async askBackup(
    machineId: string,
    ticket: string,
    ask: { url: string; key: string },
  ): Promise<boolean> {
    const res = await fetch(`https://${config().app}.fly.dev/maslow/backup`, {
      method: "POST",
      headers: {
        "fly-force-instance-id": machineId,
        "x-maslow-ticket": ticket,
        "content-type": "application/json",
      },
      body: JSON.stringify(ask),
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 409) return false;
    if (!res.ok) throw new Error(`the door answered ${res.status}`);
    return true;
  },

  // Gives the machine's door the keys that open SSH, with a ticket it takes.
  async pushKeys(
    machineId: string,
    ticket: string,
    keys: string,
  ): Promise<void> {
    const res = await fetch(`https://${config().app}.fly.dev/maslow/keys`, {
      method: "PUT",
      headers: {
        "fly-force-instance-id": machineId,
        "x-maslow-ticket": ticket,
        "content-type": "text/plain",
      },
      body: keys,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`the door answered ${res.status}`);
  },

  // Asks the machine's door to start the person's Linux over at the next
  // boot, with a ticket it takes.
  async askReset(machineId: string, ticket: string): Promise<void> {
    const res = await fetch(`https://${config().app}.fly.dev/maslow/reset`, {
      method: "POST",
      headers: {
        "fly-force-instance-id": machineId,
        "x-maslow-ticket": ticket,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`the door answered ${res.status}`);
  },

  // The person's files through the machine's door, with a ticket it takes:
  // what a folder holds, a file's bytes as a stream, whole or the range
  // asked for, a small picture of a file, and a file written whole. Paths
  // are relative to the home; the door refuses one that leaves it. Uploads
  // do not pass through here: the browser sends those to the door itself,
  // in pieces, with a ticket of its own.
  files: {
    async list(
      machineId: string,
      ticket: string,
      at: string,
    ): Promise<Entry[]> {
      const res = await fetch(
        `https://${config().app}.fly.dev/maslow/files?path=${encodeURIComponent(at)}`,
        {
          headers: {
            "fly-force-instance-id": machineId,
            "x-maslow-ticket": ticket,
          },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!res.ok)
        throw new Error(
          (await res.text()) || `the door answered ${res.status}`,
        );
      return (await res.json()) as Entry[];
    },
    async read(
      machineId: string,
      ticket: string,
      at: string,
      range?: string,
    ): Promise<Response> {
      const res = await fetch(
        `https://${config().app}.fly.dev/maslow/files/read?path=${encodeURIComponent(at)}`,
        {
          headers: {
            "fly-force-instance-id": machineId,
            "x-maslow-ticket": ticket,
            ...(range ? { range } : {}),
          },
        },
      );
      if (!res.ok && res.status !== 416)
        throw new Error(
          (await res.text()) || `the door answered ${res.status}`,
        );
      return res;
    },
    async preview(
      machineId: string,
      ticket: string,
      at: string,
    ): Promise<Response> {
      const res = await fetch(
        `https://${config().app}.fly.dev/maslow/files/preview?path=${encodeURIComponent(at)}`,
        {
          headers: {
            "fly-force-instance-id": machineId,
            "x-maslow-ticket": ticket,
          },
          signal: AbortSignal.timeout(150_000),
        },
      );
      if (!res.ok)
        throw new Error(
          (await res.text()) || `the door answered ${res.status}`,
        );
      return res;
    },
    async write(
      machineId: string,
      ticket: string,
      at: string,
      body: string,
    ): Promise<number> {
      const res = await fetch(
        `https://${config().app}.fly.dev/maslow/files/write?path=${encodeURIComponent(at)}`,
        {
          method: "PUT",
          headers: {
            "fly-force-instance-id": machineId,
            "x-maslow-ticket": ticket,
          },
          body,
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!res.ok)
        throw new Error(
          (await res.text()) || `the door answered ${res.status}`,
        );
      return ((await res.json()) as { size: number }).size;
    },
  },

  // Whether the machine's door answers at Fly's edge, with the browser
  // server up behind it: what a ready computer is.
  async answers(machineId: string): Promise<boolean> {
    try {
      const res = await fetch(`https://${config().app}.fly.dev/maslow/health`, {
        headers: { "fly-force-instance-id": machineId },
        signal: AbortSignal.timeout(8_000),
        redirect: "manual",
      });
      return res.status === 200;
    } catch {
      return false;
    }
  },
};
