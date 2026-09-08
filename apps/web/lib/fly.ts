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
    metadata?: Record<string, string>;
    mounts?: { volume: string; path: string }[];
  };
};

// What a machine says of itself: CPU percent over the last moment, memory
// used and total, the bytes the person holds, the disk's size, and the
// ports listening inside with what listens.
export type Stats = {
  cpu: number;
  memory: { used: number; total: number };
  used: number | null;
  disk: number | null;
  ports: { port: number; name: string }[];
};

// What a machine is made of: its image, its door's secret and domain,
// its size, its disk, its one port behind Fly's edge, and its tags.
export type Shape = {
  image: string;
  volumeId: string;
  cpus: number;
  memoryMb: number;
  secret: string;
  metadata: Record<string, string>;
};

const shape = (m: Shape) => ({
  image: m.image,
  env: { DOOR_SECRET: m.secret, DOMAIN: config().domain },
  guest: { cpu_kind: "shared", cpus: m.cpus, memory_mb: m.memoryMb },
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

  machines(): Promise<Machine[]> {
    return call("GET", "/machines");
  },

  volumes(): Promise<{ id: string; name: string }[]> {
    return call("GET", "/volumes");
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

  // Whether the machine's door answers at Fly's edge.
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
