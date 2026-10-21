import { createHmac } from "node:crypto";

import { machines } from "./fly.mjs";

// The brain, for computers that cannot reach the app. A laptop has no
// address on the internet, so instead of a machine dialling this checkout,
// this checkout dials each of its machines and holds their door open; what
// Claude Code there asks of the brain comes up that socket and the answer
// goes back down it, paired by number: the brain's answer as one line, and
// a model call, which streams, as a head, its chunks and an end.
const TICKET_FOR = 60 * 60;
const LOOK_EVERY = 30_000;
// How often a held door is pinged, and how long its silence is borne: a
// machine that restarts leaves the socket to it looking open from here,
// and only an unanswered ping tells them apart.
const PING_EVERY = 20_000;
const SILENCE = 65_000;

// The door takes the same ticket from us as from a browser: a moment it
// stops being good, signed with the machine's own secret.
const ticket = (secret) => {
  const exp = String(Math.floor(Date.now() / 1000) + TICKET_FOR);
  return `${exp}.${createHmac("sha256", secret).update(exp).digest("hex")}`;
};

// One machine's door, held open until it closes.
function hold(held, id, secret, domain, mcp, model) {
  const ws = new WebSocket(
    `wss://${id}.${domain}/maslow/brain?ticket=${ticket(secret)}`,
  );
  held.set(id, ws);
  const letGo = () => {
    if (held.get(id) === ws) held.delete(id);
  };
  let heard = Date.now();
  let pings = 0;
  const pinging = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - heard > SILENCE) return ws.close();
    ws.send(JSON.stringify({ ping: ++pings }));
  }, PING_EVERY);
  ws.addEventListener("close", letGo);
  ws.addEventListener("error", letGo);
  ws.addEventListener("close", () => clearInterval(pinging));
  ws.addEventListener("message", async (e) => {
    let asked;
    try {
      asked = JSON.parse(String(e.data));
    } catch {
      return;
    }
    if (asked.pong !== undefined) {
      heard = Date.now();
      return;
    }
    if (asked.path !== undefined) return stream(ws, asked, model);
    let status = 502;
    let body = "";
    try {
      const res = await fetch(mcp, {
        method: "POST",
        headers: asked.headers ?? {},
        body: asked.body ?? "",
      });
      status = res.status;
      body = await res.text();
    } catch (err) {
      body = JSON.stringify({ error: err.message });
    }
    ws.send(JSON.stringify({ id: asked.id, status, body }));
  });
}

// One model call, fetched from this checkout's gateway and sent down the
// line as it arrives.
async function stream(ws, asked, model) {
  const { id } = asked;
  const send = (m) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ id, ...m }));
  };
  let headed = false;
  try {
    const res = await fetch(`${model}${asked.path}`, {
      method: "POST",
      headers: asked.headers ?? {},
      body: asked.body ?? "",
    });
    send({ head: res.status, type: res.headers.get("content-type") });
    headed = true;
    for await (const chunk of res.body ?? [])
      send({ chunk: Buffer.from(chunk).toString("base64") });
  } catch (err) {
    // Before the head, the failure is the answer; after it, the door has
    // already begun the response and only the end is left to send.
    if (!headed) {
      send({ head: 502, type: "text/plain" });
      send({ chunk: Buffer.from(err.message).toString("base64") });
    }
  }
  send({ end: true });
}

// Every machine this checkout made, answered for as long as it runs. Looks
// again on a beat, so one made or restarted later is picked up.
export function answerTheBrain({ checkout, webPort, env }) {
  const domain = env.FLY_MACHINES_DOMAIN;
  if (!domain) return null;
  const mcp = `http://127.0.0.1:${webPort}/mcp`;
  const model = `http://127.0.0.1:${webPort}/model`;
  const held = new Map();
  const look = async () => {
    for (const m of await machines(env)) {
      if (m.config?.metadata?.checkout !== checkout) continue;
      if (m.state !== "started" || held.has(m.id)) continue;
      const secret = m.config?.env?.DOOR_SECRET;
      if (secret) hold(held, m.id, secret, domain, mcp, model);
    }
  };
  const beat = () =>
    void look().catch((err) => console.error(`brain: ${err.message}`));
  beat();
  const clock = setInterval(beat, LOOK_EVERY);
  return () => {
    clearInterval(clock);
    for (const ws of held.values()) ws.close();
  };
}
