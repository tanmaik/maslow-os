// The door to a computer: the one thing on the machine the internet can
// reach. It opens for a ticket signed with the computer's secret, which
// only our sign-in can mint, and then passes everything, VS Code's page
// and its live connection alike, to VS Code inside. Every machine shares
// the app's address, so a request for another machine's name is passed
// to that machine's door over Fly's private network, whatever its size.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";

import { backup } from "./backup.mjs";
import { stats } from "./stats.mjs";

const SECRET = process.env.DOOR_SECRET;
const DOMAIN = process.env.DOMAIN;
const ME = process.env.FLY_MACHINE_ID ?? "local";
const APP = process.env.FLY_APP_NAME;
const INSIDE = 8081;
const COOKIE = "door";
if (!SECRET) throw new Error("DOOR_SECRET is not set");

// A ticket is its expiry and a signature over it: `<seconds>.<hmac>`.
function valid(ticket) {
  const [exp, sig] = (ticket ?? "").split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = createHmac("sha256", SECRET).update(exp).digest("hex");
  return (
    want.length === sig.length &&
    timingSafeEqual(Buffer.from(want), Buffer.from(sig))
  );
}

const cookieOf = (req) =>
  (req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);

// Where a request goes: VS Code inside, or, when the address names
// another machine, that machine's own door over the private network.
function target(req) {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  const named =
    DOMAIN && host.endsWith(`.${DOMAIN}`)
      ? host.slice(0, -DOMAIN.length - 1)
      : null;
  if (named && named !== ME && APP && /^[0-9a-f]{14}$/.test(named))
    return { host: `${named}.vm.${APP}.internal`, port: 8080, mine: false };
  return { host: "127.0.0.1", port: INSIDE, mine: true };
}

// Whether VS Code inside answers.
const insideAnswers = () =>
  new Promise((resolve) => {
    const probe = http.get(
      { host: "127.0.0.1", port: INSIDE, path: "/healthz", timeout: 2000 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    probe.on("error", () => resolve(false));
    probe.on("timeout", () => probe.destroy());
  });

const say = (res, status, text) => {
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(text);
};

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://door");
  } catch {
    return say(res, 400, "That is not an address.");
  }
  const to = target(req);
  if (to.mine && url.pathname === "/maslow/health")
    return (await insideAnswers())
      ? say(res, 200, "ok")
      : say(res, 503, "VS Code is not answering yet.");
  // The numbers, for our server alone: it signs its ask with the secret.
  if (to.mine && url.pathname === "/maslow/stats") {
    if (!valid(req.headers["x-maslow-ticket"]))
      return say(res, 401, "That ticket is not good here.");
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(await stats()));
  }
  // Backups, for our server alone: it asks with an address to upload to,
  // and reads what came of the last one.
  if (to.mine && url.pathname === "/maslow/backup") {
    if (!valid(req.headers["x-maslow-ticket"]))
      return say(res, 401, "That ticket is not good here.");
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(backup.last()));
    }
    if (req.method === "POST") {
      const body = await new Promise((resolve) => {
        let s = "";
        req.on("data", (d) => (s += d));
        req.on("end", () => resolve(s));
      });
      let ask;
      try {
        ask = JSON.parse(body);
      } catch {
        return say(res, 400, "That is not an ask.");
      }
      if (typeof ask?.url !== "string" || typeof ask?.key !== "string")
        return say(res, 400, "An ask names the address and the key.");
      return backup.start(ask)
        ? say(res, 202, "backing up")
        : say(res, 409, "a backup is already running");
    }
  }
  // What the browser is looking at, for our server alone: the picture the
  // browser server draws of its newest tab, or nothing while it is closed.
  if (to.mine && url.pathname === "/maslow/browser") {
    if (!valid(req.headers["x-maslow-ticket"]))
      return say(res, 401, "That ticket is not good here.");
    const shot = http.get(
      { host: "127.0.0.1", port: 8082, path: "/screenshot", timeout: 8000 },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, {
          "content-type": answer.headers["content-type"] ?? "image/jpeg",
        });
        answer.on("error", () => res.destroy());
        answer.pipe(res);
      },
    );
    shot.on("error", () => say(res, 204, ""));
    shot.on("timeout", () => shot.destroy());
    return;
  }
  // The keys that open SSH, for our server alone: written beside the
  // server's own, outside the person's Linux.
  if (to.mine && url.pathname === "/maslow/keys" && req.method === "PUT") {
    if (!valid(req.headers["x-maslow-ticket"]))
      return say(res, 401, "That ticket is not good here.");
    const text = await new Promise((resolve) => {
      let s = "";
      req.on("data", (d) => (s += d));
      req.on("end", () => resolve(s));
    });
    fs.mkdirSync("/data/keys", { recursive: true });
    fs.writeFileSync("/data/keys/me", text, { mode: 0o644 });
    return say(res, 200, "keys written");
  }
  // Reset, for our server alone: the next boot starts the person's Linux
  // over and keeps their home. The mark is on the disk, outside their
  // Linux, so nothing inside can set or clear it.
  if (to.mine && url.pathname === "/maslow/reset" && req.method === "POST") {
    if (!valid(req.headers["x-maslow-ticket"]))
      return say(res, 401, "That ticket is not good here.");
    // Forced onto the disk before the answer: the restart that follows is
    // a hard stop, and a mark still in memory would be lost with it.
    const fd = fs.openSync("/data/.reset-asked", "w");
    fs.writeSync(fd, new Date().toISOString());
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    const dir = fs.openSync("/data", "r");
    fs.fsyncSync(dir);
    fs.closeSync(dir);
    return say(res, 200, "reset at the next boot");
  }
  if (to.mine) {
    const ticket = url.searchParams.get("ticket");
    if (ticket) {
      if (!valid(ticket)) return say(res, 403, "That ticket is not good here.");
      // Then to where it was going, if that is a path on this machine: one
      // leading slash, and no backslash anywhere, which a browser would
      // read as a second slash.
      const to = url.searchParams.get("to") ?? "/";
      res.writeHead(303, {
        location: /^\/(?!\/)[^\\\s]*$/.test(to) ? to : "/",
        "set-cookie": `${COOKIE}=${ticket}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
      });
      return res.end();
    }
    if (!valid(cookieOf(req)))
      return say(res, 401, "Open your computer from your Computer page.");
  }
  const onward = http.request(
    {
      host: to.host,
      port: to.port,
      method: req.method,
      path: req.url,
      headers: req.headers,
    },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.on("error", () => res.destroy());
      answer.pipe(res);
    },
  );
  onward.on("error", () =>
    say(
      res,
      502,
      to.mine
        ? "VS Code is not answering yet."
        : "That computer is not answering.",
    ),
  );
  req.pipe(onward);
});

// VS Code's live connection: the same ticket, then the two sockets are
// joined; one for another machine is joined to that machine's door.
server.on("upgrade", (req, socket, head) => {
  const to = target(req);
  // SSH over a WebSocket: the internet's road to the SSH server outside
  // the person's Linux. No ticket: the key the person set is the lock,
  // as on any machine on the internet.
  if (to.mine && req.url.split("?")[0] === "/maslow/ssh")
    return sshOver(req, socket, head);
  if (to.mine && !valid(cookieOf(req))) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  const onward = net.connect(to.port, to.host, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [k, v] of Object.entries(req.headers))
      lines.push(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
    onward.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) onward.write(head);
    socket.pipe(onward).pipe(socket);
  });
  onward.on("error", () => socket.destroy());
  socket.on("error", () => onward.destroy());
});

// SSH carried over a WebSocket: the handshake answered here, then every
// binary frame from the client unmasked into the SSH server and every
// byte back framed for the client. Only what a tunnel needs of the
// protocol: binary frames, pings answered, close honoured.
function sshOver(req, socket, head) {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  const ssh = net.connect(22, "127.0.0.1", () => {
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    let buf = head.length ? Buffer.from(head) : Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 0x0f;
        const masked = buf[1] & 0x80;
        let n = buf[1] & 0x7f;
        let at = 2;
        if (n === 126) {
          if (buf.length < 4) return;
          n = buf.readUInt16BE(2);
          at = 4;
        } else if (n === 127) {
          if (buf.length < 10) return;
          n = Number(buf.readBigUInt64BE(2));
          at = 10;
        }
        const maskAt = at;
        if (masked) at += 4;
        if (buf.length < at + n) return;
        const payload = Buffer.from(buf.subarray(at, at + n));
        if (masked)
          for (let i = 0; i < n; i++) payload[i] ^= buf[maskAt + (i % 4)];
        buf = buf.subarray(at + n);
        if (op === 0x8) {
          ssh.end();
          socket.end();
          return;
        }
        if (op === 0x9) socket.write(frame(0x8a, payload));
        else if (op === 0x1 || op === 0x2 || op === 0x0) ssh.write(payload);
      }
    });
    ssh.on("data", (data) => socket.write(frame(0x82, data)));
    ssh.on("end", () => socket.end(frame(0x88, Buffer.alloc(0))));
    socket.on("end", () => ssh.end());
  });
  ssh.on("error", () => socket.destroy());
  socket.on("error", () => ssh.destroy());
}

// A server-to-client frame: never masked.
function frame(first, payload) {
  const n = payload.length;
  const header =
    n < 126
      ? Buffer.from([first, n])
      : n < 65536
        ? Buffer.concat([
            Buffer.from([first, 126]),
            Buffer.from([n >> 8, n & 0xff]),
          ])
        : Buffer.concat([
            Buffer.from([first, 127]),
            (() => {
              const b = Buffer.alloc(8);
              b.writeBigUInt64BE(BigInt(n));
              return b;
            })(),
          ]);
  return Buffer.concat([header, payload]);
}

server.listen(8080, "::", () => console.log("the door is open on 8080"));
