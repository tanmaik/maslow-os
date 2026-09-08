import { deployment } from "./deployment.ts";

// The Fly Machines API, the part of it a computer needs. No SDK.
export type Machine = {
  id: string;
  name: string;
  state: string;
  region: string;
  created_at: string;
  config?: {
    metadata?: Record<string, string>;
    mounts?: { volume: string; path: string }[];
  };
};

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

  // A machine on its disk, started, running until it is stopped: VS Code
  // on its port behind Fly's edge, opened by the computer's secret.
  createMachine(m: {
    name: string;
    region: string;
    image: string;
    volumeId: string;
    cpus: number;
    memoryMb: number;
    secret: string;
    metadata: Record<string, string>;
  }): Promise<Machine> {
    return call("POST", "/machines", {
      name: m.name,
      region: m.region,
      config: {
        image: m.image,
        env: { AUTH: "password", PASSWORD: m.secret },
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
      },
    });
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

  // Whether VS Code on the machine answers at Fly's edge.
  async answers(machineId: string): Promise<boolean> {
    try {
      const res = await fetch(`https://${config().app}.fly.dev/login`, {
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
