// Enough of the Fly Machines API for the smoke: volumes and machines held
// in memory, each machine reporting on itself when started as the daemon
// does. As on Fly, a new machine is "created" until asked about again and
// refuses to start before that. Nothing here costs money.
import { createServer } from "node:http";

export async function startFakeFly() {
  const volumes = new Map();
  const machines = new Map();
  let n = 0;
  const server = createServer(async (req, res) => {
    const json = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const url = new URL(req.url, "http://fake");
    let body = "";
    for await (const chunk of req) body += chunk;
    const m = url.pathname.match(
      /^\/v1\/apps\/[^/]+\/(volumes|machines)(?:\/([^/?]+))?(?:\/(start|stop|suspend|extend))?$/,
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
    if (kind === "machines" && req.method === "POST" && !id) {
      const input = JSON.parse(body);
      if (!volumes.has(input.config?.mounts?.[0]?.volume))
        return json(422, { error: "no such volume" });
      const mc = {
        id: `m${(++n).toString().padStart(8, "0")}`,
        region: input.region,
        state: "created",
        env: input.config?.env ?? {},
        volume: input.config?.mounts?.[0]?.volume,
      };
      machines.set(mc.id, mc);
      return json(201, mc);
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
      if (
        kind === "machines" &&
        !url.searchParams.has("force") &&
        held.get(id).state === "started"
      )
        return json(412, { error: "machine is running" });
      if (kind === "volumes")
        for (const m of machines.values())
          if (m.volume === id) return json(409, { error: "volume in use" });
      held.delete(id);
      return json(200, { ok: true });
    }
    const mc = machines.get(id);
    if (!mc) return json(404, { error: "no such machine" });
    if (mc.state === "created") {
      mc.state = "stopped";
      if (action)
        return json(412, {
          error:
            "failed_precondition: unable to start machine from current state: 'created'",
        });
    }
    if (action === "start") {
      mc.state = "started";
      // The daemon reports on boot; here, before the start is even answered.
      await fetch(mc.env.REPORT_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${mc.env.COMPUTER_SECRET}`,
          "fly-machine-id": mc.id,
          "content-type": "application/json",
        },
        body: JSON.stringify({ disk: { used: 1.2e9, total: 10e9 } }),
      });
    }
    if (action === "stop") mc.state = "stopped";
    if (action === "suspend") mc.state = "suspended";
    return json(200, { id: mc.id, region: mc.region, state: mc.state });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, machines, volumes, close: () => server.close() };
}
