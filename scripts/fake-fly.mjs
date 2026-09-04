// Enough of Fly for development and the smoke: the Machines API with
// volumes and machines held in memory, and the proxy in front of them.
// A machine is a real daemon process on a scratch directory, one per
// volume, so the disk it serves is a disk. As on Fly, a new machine is
// "created" until asked about again and refuses to start before that;
// a request through the proxy wakes the machine it names, and a reply
// asking for another machine is replayed there. Nothing here costs money.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import { connect, createServer as tcp } from "node:net";
import path from "node:path";

const DAEMON = new URL("../apps/computer/server.mjs", import.meta.url);

const freePort = () =>
  new Promise((resolve) => {
    const s = tcp();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

export async function startFakeFly({ dir = ".local/computers" } = {}) {
  const volumes = new Map();
  const machines = new Map();
  let n = 0;
  const at = () => Date.now();

  // Runs the daemon for a machine until it is stopped, as Fly boots the
  // image on the volume.
  // Two requests waking one machine wait for one boot.
  function boot(mc) {
    if (!mc.booting)
      mc.booting = bootOnce(mc).finally(() => {
        mc.booting = null;
      });
    return mc.booting;
  }

  async function bootOnce(mc) {
    const port = await freePort();
    const data = path.resolve(dir, mc.volume);
    await fs.mkdir(data, { recursive: true });
    const child = spawn(process.execPath, [DAEMON.pathname], {
      env: {
        ...process.env,
        ...mc.env,
        FLY_MACHINE_ID: mc.id,
        DATA_DIR: data,
        DISK_GB: String(volumes.get(mc.volume)?.size_gb ?? 10),
        PORT: String(port),
      },
      stdio: ["ignore", "ignore", "inherit"],
    });
    mc.child = child;
    mc.port = port;
    mc.state = "starting";
    child.on("exit", () => {
      if (mc.child === child) {
        mc.child = null;
        if (mc.state === "started" || mc.state === "starting") {
          mc.state = "stopped";
          mc.events.push({ type: "exit", status: "stopped", timestamp: at() });
        }
      }
    });
    for (let i = 0; i < 100; i++) {
      const ok = await fetch(`http://127.0.0.1:${port}/health`)
        .then((r) => r.ok)
        .catch(() => false);
      if (ok) {
        mc.state = "started";
        mc.events.push({ type: "start", status: "started", timestamp: at() });
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    child.kill();
    throw new Error(`the daemon for ${mc.id} did not come up`);
  }

  function halt(mc, state) {
    const child = mc.child;
    mc.child = null;
    mc.state = state;
    mc.events.push({ type: "exit", status: state, timestamp: at() });
    if (child) child.kill();
  }

  const machineJson = (mc) => ({
    id: mc.id,
    name: mc.name,
    region: mc.region,
    state: mc.state,
    events: mc.events.slice(-20),
  });

  async function api(req, res, url, body) {
    const json = (status, out) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    };
    const m = url.pathname.match(
      /^\/v1\/apps\/[^/]+\/(volumes|machines)(?:\/([^/?]+))?(?:\/(start|stop|suspend|restart|extend))?$/,
    );
    if (!m) return json(404, { error: "no such route" });
    if (req.headers.authorization !== "Bearer fake")
      return json(401, { error: "bad token" });
    const [, kind, id, action] = m;
    if (kind === "volumes" && req.method === "POST") {
      const v = { id: `vol_${++n}`, ...JSON.parse(body) };
      volumes.set(v.id, v);
      return json(201, v);
    }
    if (kind === "machines" && req.method === "GET" && !id)
      return json(200, [...machines.values()].map(machineJson));
    if (kind === "volumes" && req.method === "GET" && !id)
      return json(200, [...volumes.values()]);
    if (kind === "machines" && req.method === "POST" && !id) {
      const input = JSON.parse(body);
      if (!volumes.has(input.config?.mounts?.[0]?.volume))
        return json(422, { error: "no such volume" });
      const mc = {
        id: `m${(++n).toString().padStart(8, "0")}`,
        name: input.name,
        region: input.region,
        state: "created",
        env: input.config?.env ?? {},
        volume: input.config?.mounts?.[0]?.volume,
        child: null,
        port: 0,
        events: [{ type: "launch", status: "created", timestamp: at() }],
      };
      machines.set(mc.id, mc);
      return json(201, machineJson(mc));
    }
    if (kind === "volumes" && action === "extend") {
      const v = volumes.get(id);
      if (!v) return json(404, { error: "no such volume" });
      const { size_gb } = JSON.parse(body);
      if (!(size_gb > v.size_gb)) return json(422, { error: "not bigger" });
      v.size_gb = size_gb;
      return json(200, { volume: v, needs_restart: true });
    }
    if (req.method === "DELETE") {
      const held = kind === "volumes" ? volumes : machines;
      if (!held.has(id)) return json(404, { error: `no such ${kind}` });
      if (kind === "machines") {
        const mc = held.get(id);
        if (mc.booting) await mc.booting.catch(() => {});
        if (!url.searchParams.has("force") && mc.state === "started")
          return json(412, { error: "machine is running" });
        halt(mc, "destroyed");
      }
      if (kind === "volumes")
        for (const mc of machines.values())
          if (mc.volume === id) return json(409, { error: "volume in use" });
      held.delete(id);
      return json(200, { ok: true });
    }
    const mc = machines.get(id);
    if (!mc) return json(404, { error: "no such machine" });
    // One still booting is let finish before it is asked anything.
    if (mc.booting) await mc.booting.catch(() => {});
    if (mc.state === "created") {
      mc.state = "stopped";
      if (action)
        return json(412, {
          error:
            "failed_precondition: unable to start machine from current state: 'created'",
        });
    }
    if (action === "start" && mc.state !== "started") await boot(mc);
    if (action === "restart") {
      if (mc.state === "started") halt(mc, "stopped");
      await boot(mc);
    }
    if (action === "stop" && mc.state === "started") halt(mc, "stopped");
    if (action === "suspend" && mc.state === "started") halt(mc, "suspended");
    return json(200, machineJson(mc));
  }

  // The machine a request goes to: the one fly-force-instance-id names,
  // woken if it is not running, else any running one.
  async function target(id) {
    let mc = id ? machines.get(id) : null;
    if (id && !mc) throw new Error("no such instance");
    if (!mc)
      mc =
        [...machines.values()].find((x) => x.state === "started") ??
        [...machines.values()].find((x) => x.state !== "created");
    if (!mc) throw new Error("no machines");
    if (mc.booting) await mc.booting;
    if (mc.state !== "started") await boot(mc);
    return mc;
  }

  // The proxy: a fly-replay in the answer sends the request on to the
  // machine it names.
  async function proxy(req, res, body) {
    let id = req.headers["fly-force-instance-id"];
    for (let hop = 0; hop < 3; hop++) {
      let mc;
      try {
        mc = await target(id);
      } catch (err) {
        res.writeHead(err.message === "no machines" ? 503 : 404);
        return res.end(err.message);
      }
      const answer = await new Promise((resolve, reject) => {
        const r = httpRequest(
          {
            host: "127.0.0.1",
            port: mc.port,
            method: req.method,
            path: req.url,
            headers: { ...req.headers, host: "computer" },
          },
          resolve,
        );
        r.on("error", reject);
        r.end(body);
      });
      const replay = answer.headers["fly-replay"]?.match(/instance=(\S+)/);
      if (replay) {
        answer.resume();
        id = replay[1];
        continue;
      }
      res.writeHead(answer.statusCode, answer.headers);
      return answer.pipe(res);
    }
    res.writeHead(508);
    res.end("replayed too often");
  }

  // An upgrade, a WebSocket, is piped raw to the machine; a replay in the
  // machine's first answer sends it on.
  async function upgrade(req, socket, head) {
    let id = req.headers["fly-force-instance-id"];
    for (let hop = 0; hop < 3; hop++) {
      const mc = await target(id).catch(() => null);
      if (!mc) return socket.destroy();
      const replayed = await new Promise((resolve) => {
        const out = connect(mc.port, "127.0.0.1", () => {
          const headers = Object.entries(req.headers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\r\n");
          out.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
          if (head.length) out.write(head);
        });
        // The answer's headers, up to the blank line, say whether it is a
        // replay; what follows is the socket's own.
        let seen = Buffer.alloc(0);
        const onData = (chunk) => {
          seen = Buffer.concat([seen, chunk]);
          const end = seen.indexOf("\r\n\r\n");
          if (end < 0) return;
          out.off("data", onData);
          const m = /fly-replay: instance=(\S+)/i.exec(
            seen.subarray(0, end).toString(),
          );
          if (m) {
            out.destroy();
            return resolve(m[1]);
          }
          socket.write(seen);
          out.pipe(socket).pipe(out);
          resolve(null);
        };
        out.on("data", onData);
        out.on("error", () => {
          socket.destroy();
          resolve(null);
        });
      });
      if (!replayed) return;
      id = replayed;
    }
    socket.destroy();
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fake");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    try {
      if (url.pathname.startsWith("/v1/")) await api(req, res, url, body);
      else await proxy(req, res, body);
    } catch (err) {
      console.error(`fake fly: ${err.message}`);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  server.on("upgrade", (req, socket, head) =>
    upgrade(req, socket, head).catch(() => socket.destroy()),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return {
    url,
    machines,
    volumes,
    close: () => {
      for (const mc of machines.values()) mc.child?.kill();
      server.close();
    },
  };
}
