// The door to a computer: the one thing on the machine the internet can
// reach. It opens for a ticket signed with the computer's secret, which
// only our sign-in can mint: the terminal and the view on sockets of their
// own, the person's files and numbers, and any port of theirs at its own
// address. Every machine shares the app's address, so a request for
// another machine's name is passed to that machine's door over Fly's
// private network, whatever its size.
import { spawn } from "node:child_process";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";

import ffmpeg from "@ffmpeg-installer/ffmpeg";
import pty from "node-pty";

import { backup } from "./backup.mjs";
import * as files from "./files.mjs";
import { stats } from "./stats.mjs";

const SECRET = process.env.DOOR_SECRET;
const DOMAIN = process.env.DOMAIN;
const ME = process.env.FLY_MACHINE_ID ?? "local";
const APP = process.env.FLY_APP_NAME;
// The person's name on their machine, as the app gave it to the boot.
const PERSON = process.env.PERSON || "me";
const OS = "/data/os";
const BROWSER = 8082;
const COOKIE = "door";
if (!SECRET) throw new Error("DOOR_SECRET is not set");

// How much of the machine a ticket opens, or null when it is not a ticket
// of ours or its time has passed. A ticket is its expiry, what it opens,
// and a signature over both: `<seconds>.<port>.<hmac>` for one port of the
// person's own, and `<seconds>.<hmac>` for the whole machine, which is
// minted for its owner alone.
function scopeOf(ticket) {
  const parts = (ticket ?? "").split(".");
  const [exp, scope, sig] =
    parts.length === 3 ? parts : [parts[0], "", parts[1]];
  if (!/^\d+$/.test(exp ?? "") || !sig || Number(exp) < Date.now() / 1000)
    return null;
  const said = scope ? `${exp}.${scope}` : exp;
  const want = createHmac("sha256", SECRET).update(said).digest("hex");
  if (
    want.length !== sig.length ||
    !timingSafeEqual(Buffer.from(want), Buffer.from(sig))
  ) {
    return null;
  }
  return scope;
}

// A ticket for the whole machine, which is what the door's own endpoints
// take: nothing about a person's ports reaches them.
const ours = (ticket) => scopeOf(ticket) === "";

// Whether a ticket opens what is being asked for. A ticket for one port
// opens that port and nothing else, so a port shared with somebody does not
// hand them the machine it runs on.
function opens(ticket, to) {
  const scope = scopeOf(ticket);
  if (scope === null) return false;
  return scope === "" || (to.theirs === true && String(to.port) === scope);
}

const cookieOf = (req) =>
  (req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);

// The ports the image itself holds: SSH, the door and the browser. Nothing
// the person runs may take one, and no address may reach one, or the door
// would carry traffic to itself.
const OURS = new Set([22, 8080, BROWSER]);

// Where a request goes, from the one label under the domain: a port of the
// person's own on this machine, the machine itself, or the same address on
// another machine, reached over the private network for its door to answer.
function target(req) {
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  const label =
    DOMAIN && host.endsWith(`.${DOMAIN}`)
      ? host.slice(0, -DOMAIN.length - 1)
      : null;
  const named = /^(?:(\d{1,5})-)?([0-9a-f]{14})$/.exec(label ?? "");
  const machine = named?.[2];
  const port = named?.[1] ? Number(named[1]) : null;
  const elsewhere = machine && machine !== ME && APP;
  if (elsewhere)
    return { host: `${machine}.vm.${APP}.internal`, port: 8080, mine: false };
  // A port of theirs is theirs alone: ours are not addressable, and neither
  // is anything outside the range a port can have.
  if (port !== null && machine === ME) {
    if (port < 1 || port > 65535 || OURS.has(port)) return null;
    return { host: "127.0.0.1", port, mine: false, theirs: true };
  }
  return { mine: true };
}

// The browser's tabs and which is current, as the browser server says
// them, in its own words; none while the browser is closed, and null when
// the server does not answer.
const tabsOf = () =>
  new Promise((resolve) => {
    const probe = http.get(
      { host: "127.0.0.1", port: BROWSER, path: "/tabs", timeout: 2000 },
      (res) => {
        let s = "";
        res.on("data", (d) => (s += d));
        res.on("end", () => resolve(res.statusCode === 200 ? s : null));
      },
    );
    probe.on("error", () => resolve(null));
    probe.on("timeout", () => probe.destroy());
  });

// A word to the browser server about its tabs, in the words the socket
// carries, answered once it is done.
const tabsTold = (text) =>
  new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: BROWSER,
        path: "/tabs",
        method: "POST",
        headers: { "content-type": "application/json" },
        timeout: 15000,
      },
      (res) => {
        res.resume();
        res.on("end", resolve);
      },
    );
    req.on("error", resolve);
    req.on("timeout", () => req.destroy());
    req.end(text);
  });

const say = (res, status, text) => {
  res.writeHead(status, { "content-type": "text/plain" });
  res.end(text);
};

const parse = (text) => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
};

// What an app inside is told about the request. Its own name is carried
// rather than replaced, since a dev server refuses a host it does not know,
// and it is told the outside is https, which it cannot see from loopback and
// would otherwise write http into its own links and cookies.
function forwarded(req) {
  const host = req.headers.host ?? "";
  return {
    ...req.headers,
    "x-forwarded-proto": "https",
    "x-forwarded-host": host,
    "x-forwarded-for": req.socket.remoteAddress ?? "",
  };
}

// What comes back, with anywhere it points rewritten to the address the
// person is actually at: an app on loopback names itself by the port it
// binds, which is a place nobody outside the machine can go.
function outward(answer, req) {
  const location = answer.headers.location;
  if (!location) return answer.headers;
  const inside = /^https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?/i;
  if (!inside.test(location)) return answer.headers;
  return {
    ...answer.headers,
    location: location.replace(inside, `https://${req.headers.host ?? ""}`),
  };
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://door");
  } catch {
    return say(res, 400, "That is not an address.");
  }
  const to = target(req);
  if (!to) return say(res, 404, "Nothing of yours is listening there.");
  // Ready is the door answering with the browser server up behind it.
  if (to.mine && url.pathname === "/maslow/health")
    return (await tabsOf()) !== null
      ? say(res, 200, "ok")
      : say(res, 503, "The browser is not answering yet.");
  // The person's own files, for the owner alone: our server asking with a
  // ticket, or their browser carrying one for the whole machine. A ticket
  // for a port opens none of this.
  if (to.mine && url.pathname.startsWith("/maslow/files")) {
    // The person's browser, on our site, sends an upload here straight
    // from its own page, which is another site to this door: the browser
    // asks first whether it may, and the ticket it carries is the answer.
    // The site is echoed rather than named because the ticket is the lock,
    // and nobody without one gets past the line below.
    const from = req.headers.origin;
    if (from) {
      res.setHeader("access-control-allow-origin", from);
      res.setHeader("access-control-allow-methods", "GET, PUT, OPTIONS");
      res.setHeader(
        "access-control-allow-headers",
        "x-maslow-ticket, content-type",
      );
      res.setHeader("access-control-max-age", "600");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (!ours(req.headers["x-maslow-ticket"]) && !ours(cookieOf(req)))
      return say(res, 401, "That ticket is not good here.");
    return files.serve(req, res, url);
  }
  // An address a program on the machine wants opened, offered to the
  // person on every terminal they have open, to open on their own device.
  // Only the machine itself can ask: the request has to come from
  // loopback, which nothing outside it reaches.
  if (to.mine && url.pathname === "/maslow/open" && req.method === "POST") {
    if (
      !/^(?:::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(
        req.socket.remoteAddress ?? "",
      )
    )
      return say(res, 403, "Only the machine itself may ask.");
    const body = await new Promise((resolve) => {
      let s = "";
      req.on("data", (d) => (s += d));
      req.on("end", () => resolve(s));
    });
    let open;
    try {
      open = new URL(JSON.parse(body)?.url);
    } catch {
      return say(res, 400, "That is not an address.");
    }
    if (!/^https?:$/.test(open.protocol))
      return say(res, 400, "Only a web address can be opened.");
    for (const t of talkers) t.sendText(JSON.stringify({ open: open.href }));
    return say(res, 200, talkers.size ? "offered" : "nobody is at a terminal");
  }
  // The numbers, for our server alone: it signs its ask with the secret.
  if (to.mine && url.pathname === "/maslow/stats") {
    if (!ours(req.headers["x-maslow-ticket"]))
      return say(res, 401, "That ticket is not good here.");
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(await stats()));
  }
  // Backups, for our server alone: it asks with an address to upload to,
  // and reads what came of the last one.
  if (to.mine && url.pathname === "/maslow/backup") {
    if (!ours(req.headers["x-maslow-ticket"]))
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
  // The keys that open SSH, for our server alone: written beside the
  // server's own, outside the person's Linux.
  if (to.mine && url.pathname === "/maslow/keys" && req.method === "PUT") {
    if (!ours(req.headers["x-maslow-ticket"]))
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
    if (!ours(req.headers["x-maslow-ticket"]))
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
  // Signing out of Maslow throws the ticket kept here away. A cookie on
  // this machine's own name is beyond the reach of our server, which lives
  // at another, so sign-out sends the browser through here on its way out.
  // Where it goes next is signed with the same secret a ticket is, or this
  // would carry anybody anywhere under our name.
  if (to.mine && url.pathname === "/maslow/leave") {
    const onward = url.searchParams.get("to") ?? "";
    const said = url.searchParams.get("sig") ?? "";
    // Signed under its own label, so what signs a way out can never be
    // read as a ticket in.
    const want = createHmac("sha256", SECRET)
      .update(`leave:${onward}`)
      .digest("hex");
    if (
      want.length !== said.length ||
      !timingSafeEqual(Buffer.from(want), Buffer.from(said))
    ) {
      return say(res, 403, "Nobody asked for that.");
    }
    // Thrown away rather than set, and arriving in the middle of a hop that
    // began at our server, which a browser counts as another site: a cookie
    // that says Lax would be dropped here and the ticket would live on. It
    // carries nothing, so saying None gives nothing away.
    res.writeHead(303, {
      location: onward,
      "set-cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`,
    });
    return res.end();
  }
  // Everything on this machine is behind a ticket, whether it is ours or a
  // port of theirs. Another machine's door asks for its own.
  if (to.mine || to.theirs) {
    const ticket = url.searchParams.get("ticket");
    if (ticket) {
      if (!opens(ticket, to))
        return say(res, 403, "That ticket is not good here.");
      // Then to where it was going, if that is a path on this machine: one
      // leading slash, and no backslash anywhere, which a browser would
      // read as a second slash.
      const onto = url.searchParams.get("to") ?? "/";
      // The cookie dies with the ticket in it, so a browser never carries
      // one long after it stopped opening anything.
      const left = Math.max(
        1,
        Math.floor(Number(ticket.split(".")[0]) - Date.now() / 1000),
      );
      res.writeHead(303, {
        location: /^\/(?!\/)[^\\\s]*$/.test(onto) ? onto : "/",
        "set-cookie": `${COOKIE}=${ticket}; Path=/; Max-Age=${left}; HttpOnly; Secure; SameSite=Lax`,
      });
      return res.end();
    }
    if (!opens(cookieOf(req), to))
      return say(res, 401, "Open this from Maslow.");
  }
  // The machine itself has no page: its terminal, its view and its files
  // each have a road of their own above.
  if (to.mine) return say(res, 200, "ok");
  const onward = http.request(
    {
      host: to.host,
      port: to.port,
      method: req.method,
      path: req.url,
      headers: forwarded(req),
    },
    (answer) => {
      res.writeHead(
        answer.statusCode ?? 502,
        to.theirs ? outward(answer, req) : answer.headers,
      );
      answer.on("error", () => res.destroy());
      answer.pipe(res);
    },
  );
  onward.on("error", () =>
    say(
      res,
      502,
      to.theirs
        ? "Nothing is answering on that port."
        : "That computer is not answering.",
    ),
  );
  // A request the person walked away from takes its answer with it, rather
  // than leaving a road into their machine open behind them.
  res.on("close", () => onward.destroy());
  req.pipe(onward);
});

// A live connection: one of the door's own, the terminal or the view, each
// opened by a ticket for the whole machine in its address, or SSH, which
// the key the person set opens instead; or one to a port of the person's
// own or to another machine's door, the same ticket as a request, then the
// two sockets joined. Anything modern holds one of these open for its own
// live reload alone, so a port that cannot upgrade is a port that does not
// work.
server.on("upgrade", (req, socket, head) => {
  const to = target(req);
  if (!to) {
    socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
    return;
  }
  if (to.mine) {
    let url;
    try {
      url = new URL(req.url, "http://door");
    } catch {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
      return;
    }
    // SSH over a WebSocket: the internet's road to the SSH server outside
    // the person's Linux. No ticket: the key the person set is the lock,
    // as on any machine on the internet.
    if (url.pathname === "/maslow/ssh") {
      const ws = websocket(req, socket, head);
      if (ws) ssh(ws);
      return;
    }
    const own = { "/maslow/talk": talk, "/maslow/view": view }[url.pathname];
    if (!own) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    if (!ours(url.searchParams.get("ticket"))) {
      socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return;
    }
    const ws = websocket(req, socket, head);
    if (ws) own(ws, url);
    return;
  }
  if (to.theirs && !opens(cookieOf(req), to)) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  const onward = net.connect(to.port, to.host, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [k, v] of Object.entries(forwarded(req)))
      lines.push(`${k}: ${Array.isArray(v) ? v.join(", ") : v}`);
    onward.write(lines.join("\r\n") + "\r\n\r\n");
    if (head.length) onward.write(head);
    socket.pipe(onward).pipe(socket);
  });
  onward.on("error", () => socket.destroy());
  socket.on("error", () => onward.destroy());
});

// SSH carried over a WebSocket: every binary frame from the client into
// the SSH server, and every byte back framed for the client.
function ssh(ws) {
  const server = net.connect(22, "127.0.0.1");
  server.on("data", (data) => ws.sendBytes(data));
  server.on("end", () => ws.close());
  server.on("error", () => ws.close());
  ws.bytes = (data) => server.write(data);
  ws.closed = () => server.destroy();
}

// The terminal: the socket joined to a terminal in which the person's own
// tmux session runs, attached when it exists and made when not, so closing
// the tab ends this terminal and nothing in the session, and the next tab
// finds it where it was. Bytes pass untouched both ways; a resize is the
// one word the socket carries up, and an address the machine wants opened
// the one it carries down.

// Every terminal open right now, for an address to be offered on.
const talkers = new Set();

function talk(ws, url) {
  talkers.add(ws);
  const size = (name, fallback) => {
    const n = Number(url.searchParams.get(name));
    return Number.isInteger(n) && n > 0 && n <= 1000 ? n : fallback;
  };
  const term = pty.spawn(
    "/usr/sbin/chroot",
    [
      "--userspec=1000:1000",
      "--groups=1000",
      OS,
      "/usr/bin/env",
      "-i",
      "HOME=/home/me",
      `USER=${PERSON}`,
      `LOGNAME=${PERSON}`,
      "SHELL=/bin/bash",
      "LANG=C.UTF-8",
      "TERM=xterm-256color",
      "PATH=/usr/local/bin:/usr/bin:/bin",
      "/bin/bash",
      "-lc",
      "exec /opt/maslow/terminal.sh page",
    ],
    {
      name: "xterm-256color",
      cols: size("cols", 80),
      rows: size("rows", 24),
      cwd: "/",
      env: { PATH: "/usr/sbin:/usr/bin:/bin" },
      encoding: null,
    },
  );
  term.onData((data) => ws.sendBytes(data));
  term.onExit(() => {
    talkers.delete(ws);
    ws.close();
  });
  ws.bytes = (data) => term.write(data);
  ws.text = (text) => {
    const r = parse(text)?.resize;
    if (Number.isInteger(r?.cols) && Number.isInteger(r?.rows))
      term.resize(
        Math.min(Math.max(r.cols, 1), 1000),
        Math.min(Math.max(r.rows, 1), 1000),
      );
  };
  ws.closed = () => {
    talkers.delete(ws);
    term.kill();
  };
}

// The view: the machine's browser as video while the person watches, its
// tabs, their hands and pointer on it, and what changed in one folder of
// their home, on one socket. Video flows only while asked for, and every
// viewer who asks gets an encoder of their own, so the first picture they
// get is a whole one.
function view(ws) {
  const send = (said) => ws.sendText(JSON.stringify(said));
  let video = null;
  let watcher = null;
  let hands = null;
  // The tabs, and whether there is one to show, said whenever they change:
  // asked every second, and at once after the person changed them.
  let were = null;
  const ask = async () => {
    const now = await tabsOf();
    if (now === null || now === were) return;
    const open = JSON.parse(now).current !== null;
    if (open !== (were !== null && JSON.parse(were).current !== null))
      send({ browser: open ? "open" : "closed" });
    were = now;
    ws.sendText(now);
  };
  const asking = setInterval(ask, 1000);
  void ask();
  // The pointer, sent on to the browser server as it moves, on one request
  // that stays open, so a hover costs no more than its line.
  const move = (x, y) => {
    if (!hands) {
      hands = http.request({
        host: "127.0.0.1",
        port: BROWSER,
        path: "/moves",
        method: "POST",
        headers: { "content-type": "application/x-ndjson" },
      });
      hands.on("error", () => (hands = null));
      hands.on("response", (res) => {
        res.resume();
        hands = null;
      });
    }
    hands.write(`${JSON.stringify({ x, y })}\n`);
  };
  ws.text = async (text) => {
    const said = parse(text);
    if (!said) return;
    if ("ping" in said) send({ pong: said.ping });
    else if ("view" in said) {
      video?.stop();
      video = said.view === true ? stream(ws, send) : null;
    } else if (said.act?.kind === "move") {
      if (typeof said.act.x === "number" && typeof said.act.y === "number")
        move(said.act.x, said.act.y);
    } else if (said.act?.kind === "leave") {
      hands?.end();
      hands = null;
    } else if ("act" in said) send({ id: said.id, ...(await act(said.act)) });
    else if ("tab" in said || "newTab" in said || "closeTab" in said) {
      await tabsTold(text);
      await ask();
    } else if ("watch" in said) {
      watcher?.close();
      watcher = watch(said.watch, (name) => send({ changed: name }));
    }
  };
  ws.closed = () => {
    clearInterval(asking);
    video?.stop();
    watcher?.close();
    hands?.destroy();
  };
}

// A hand on the browser, passed to the browser server as it came, and what
// came of it: nothing, the words a copy took, or why the browser refused.
const act = (what) =>
  new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: BROWSER,
        path: "/act",
        method: "POST",
        headers: { "content-type": "application/json" },
        timeout: 15000,
      },
      (res) => {
        let s = "";
        res.on("data", (d) => (s += d));
        res.on("end", () =>
          resolve(
            res.statusCode === 204
              ? {}
              : res.statusCode === 200
                ? { copy: s }
                : { why: s || `The browser answered ${res.statusCode}.` },
          ),
        );
        res.on("error", () =>
          resolve({ why: "The browser stopped answering." }),
        );
      },
    );
    req.on("error", () => resolve({ why: "The browser is not answering." }));
    req.on("timeout", () => req.destroy());
    req.end(JSON.stringify(what));
  });

// Watches one folder of the person's home, saying the name of whatever
// changed in it once the changes have settled for a moment. Nothing outside
// the home can be watched; null when the folder cannot be.
function watch(rel, changed) {
  const at = files.inside(typeof rel === "string" ? rel : "");
  if (!at) return null;
  const pending = new Map();
  let watcher;
  try {
    watcher = fs.watch(at, (_, name) => {
      if (!name) return;
      clearTimeout(pending.get(name));
      pending.set(
        name,
        setTimeout(() => {
          pending.delete(name);
          changed(name);
        }, 250),
      );
    });
  } catch {
    return null;
  }
  watcher.on("error", () => watcher.close());
  return {
    close() {
      for (const t of pending.values()) clearTimeout(t);
      watcher.close();
    },
  };
}

// The browser as video for one viewer: the browser server's pictures of its
// current tab, one whenever the page changes, into an encoder of the
// viewer's own, and the cursor's name when the page changes it under the
// pointer. A picture arriving while the encoder still takes in the last is
// kept in its place, so the encoder never falls behind the page and the
// last change is never lost. The pictures end when another tab becomes
// current, and start again on it with a fresh encoder, so the first frame
// of it is whole; while the browser is closed there is no picture, and it
// is asked for again every second until there is.
function stream(ws, send) {
  let on = true;
  let asking = null;
  let encoder = null;
  // At once when the pictures ended because another tab is current; in a
  // second when there was no tab, or no answer, to show.
  const again = (wait) => {
    if (on) setTimeout(go, wait);
  };
  const go = () => {
    asking = http.get(
      { host: "127.0.0.1", port: BROWSER, path: "/screencast" },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          res.on("end", () => again(1000));
          return;
        }
        const ff = encode(ws);
        encoder = ff;
        let buf = Buffer.alloc(0);
        let latest = null;
        const feed = (jpeg) => {
          if (ff.stdin.writableLength === 0) ff.stdin.write(jpeg);
          else latest = jpeg;
        };
        ff.stdin.on("drain", () => {
          if (!latest) return;
          const jpeg = latest;
          latest = null;
          feed(jpeg);
        });
        // Each thing on the stream: its length, a byte for what it is, a
        // picture or the cursor's name, then the thing.
        res.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          for (;;) {
            if (buf.length < 4) return;
            const n = buf.readUInt32BE(0);
            if (buf.length < 4 + n) return;
            const body = buf.subarray(5, 4 + n);
            if (buf[4] === 0) feed(body);
            else if (buf[4] === 1) send({ cursor: body.toString() });
            buf = buf.subarray(4 + n);
          }
        });
        res.on("close", () => {
          ff.kill("SIGKILL");
          encoder = null;
          again(0);
        });
      },
    );
    asking.on("error", () => again(1000));
  };
  go();
  return {
    stop() {
      on = false;
      asking?.destroy();
      encoder?.kill("SIGKILL");
    },
  };
}

// A fresh H.264 encoder for one viewer, so the first frame it sends is a
// key frame: pictures in, and each frame out sent as it is made, as FLV
// delimits them. The socket's pace is the encoder's: a viewer that cannot
// take frames as fast as they come holds the encoder, which then takes
// fewer pictures. The encoder is told to look at one picture and start,
// rather than gather seconds of them first, as it would for a file. The
// browser's 1280x800 passes through unchanged; a picture of another size
// is fitted into it, since the viewer decodes one size.
function encode(ws) {
  const ff = spawn(
    ffmpeg.path,
    [
      ...["-loglevel", "error", "-probesize", "32", "-analyzeduration", "0"],
      ...["-f", "image2pipe", "-c:v", "mjpeg", "-i", "-", "-an"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency"],
      ...["-pix_fmt", "yuv420p", "-profile:v", "baseline", "-level", "3.1"],
      ...["-x264-params", "keyint=120:scenecut=0:repeat-headers=1"],
      "-vf",
      "scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2",
      ...["-vsync", "0", "-flush_packets", "1", "-f", "flv", "-"],
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  ff.stdin.on("error", () => {});
  const frames = flv();
  ff.stdout.on("data", (chunk) => {
    for (const each of frames(chunk))
      if (!ws.sendBytes(each)) ff.stdout.pause();
  });
  ws.drained = () => ff.stdout.resume();
  return ff;
}

// Cuts an FLV stream into its video tags, one frame each, and gives each as
// the frame the viewer decodes: a byte saying whether it is a key frame,
// then the H.264 access unit in Annex B form. The encoder puts the SPS and
// PPS inside every key frame, so a viewer can start at any one.
function flv() {
  let buf = Buffer.alloc(0);
  // The file's header and the size of the tag before it, which is none.
  let header = 13;
  return (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const skip = Math.min(header, buf.length);
    buf = buf.subarray(skip);
    header -= skip;
    const out = [];
    while (buf.length >= 11) {
      const size = buf.readUIntBE(1, 3);
      if (buf.length < 11 + size + 4) break;
      const tag = buf.subarray(11, 11 + size);
      // A video tag holding a picture: its kind, the packet type, three
      // bytes of timing, then the picture's NAL units.
      if (buf[0] === 9 && tag[1] === 1) out.push(frame(tag.subarray(5)));
      buf = buf.subarray(11 + size + 4);
    }
    return out;
  };
}

const START = Buffer.from([0, 0, 0, 1]);

// One picture's NAL units, each behind four bytes of length, as one frame:
// a start code before each unit, behind a byte that is 1 for a key frame,
// which is one holding an IDR slice, unit type 5.
function frame(nals) {
  const parts = [];
  let key = false;
  for (let i = 0; i + 4 <= nals.length;) {
    const n = nals.readUInt32BE(i);
    const nal = nals.subarray(i + 4, i + 4 + n);
    if ((nal[0] & 0x1f) === 5) key = true;
    parts.push(START, nal);
    i += 4 + n;
  }
  return Buffer.concat([Buffer.from([key ? 1 : 0]), ...parts]);
}

// A WebSocket the door answers itself: the handshake, then every frame from
// the client unmasked and handed on whole by kind, and what the door says
// framed back. Only what its sockets need of the protocol: text and binary
// messages, in one frame or several, pings answered, close honoured. What
// the door hands on and hears back is set by whoever takes the socket.
function websocket(req, socket, head) {
  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return null;
  }
  const accept = createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const ws = {
    text: () => {},
    bytes: () => {},
    closed: () => {},
    drained: () => {},
    sendText: (text) => socket.write(frameOf(0x81, Buffer.from(text))),
    sendBytes: (data) => socket.write(frameOf(0x82, data)),
    close: () => socket.end(frameOf(0x88, Buffer.alloc(0))),
  };
  let buf = head.length ? Buffer.from(head) : Buffer.alloc(0);
  // A message arriving in pieces: its kind, and the pieces so far.
  let kind = 0;
  let pieces = [];
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80;
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
        ws.close();
        return;
      }
      if (op === 0x9) {
        socket.write(frameOf(0x8a, payload));
        continue;
      }
      if (op === 0xa) continue;
      if (op !== 0) kind = op;
      pieces.push(payload);
      if (!fin) continue;
      const whole = pieces.length === 1 ? pieces[0] : Buffer.concat(pieces);
      pieces = [];
      if (kind === 0x1) ws.text(whole.toString());
      else if (kind === 0x2) ws.bytes(whole);
    }
  });
  socket.on("drain", () => ws.drained());
  socket.on("close", () => {
    ws.closed();
    ws.closed = () => {};
  });
  socket.on("error", () => socket.destroy());
  return ws;
}

// A server-to-client frame: never masked.
function frameOf(first, payload) {
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
