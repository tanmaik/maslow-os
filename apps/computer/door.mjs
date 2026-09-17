// The door to a computer: the one thing on the machine the internet can
// reach. It opens for a ticket signed with the computer's secret, which
// only our sign-in can mint: the terminal, the view and the agent on
// sockets of their own, the person's files and numbers, and any port of
// theirs at its own address. Every machine shares the app's address, so a request for
// another machine's name is passed to that machine's door over Fly's
// private network, whatever its size.
import { execFile, spawn } from "node:child_process";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

import ffmpeg from "@ffmpeg-installer/ffmpeg";
import pty from "node-pty";

import { backup } from "./backup.mjs";
import * as files from "./files.mjs";
import * as shares from "./shares.mjs";
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

// Everything a request carried, as text.
const bodyOf = (req) =>
  new Promise((resolve) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => resolve(s));
  });

// How much of the machine a ticket opens, or null when it is not a ticket
// of ours or its time has passed. A ticket is its expiry, what it opens,
// and a signature over both: `<seconds>.<port>.<hmac>` for one port of the
// person's own, and `<seconds>.<hmac>` for the whole machine, which is
// minted for its owner alone.
function scopeOf(ticket) {
  const parts = (ticket ?? "").split(".");
  if (parts.length < 2 || parts.length > 3) return null;
  const sig = parts.pop();
  const said = parts.join(".");
  const [exp, scope = ""] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now() / 1000) return null;
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

// When the person was last at this computer: a key typed into a terminal
// or over SSH, or a request the door carried to a port of theirs. The
// door's own start counts, so a machine that has just booted is never
// called idle.
let lastSeen = Date.now();
const seen = () => (lastSeen = Date.now());

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

// How big the browser draws a page: the size of the pane the person is
// watching it in, so the picture fills their window and nothing is let in
// around it. The image's own until somebody says otherwise, and the same
// for every viewer, since there is one browser.
let pane = { w: 1280, h: 800 };

// Every socket watching the browser, so a change of size reaches each.
const views = new Set();

// The browser told how big to draw, and every viewer given the size it
// settled on and a stream that begins at it. One at a time: two panes
// sized at once would otherwise race for the browser and the encoders.
let sizing = Promise.resolve();
const resize = (w, h) => {
  sizing = sizing.then(
    async () => {
      const said = await sizeTold({ width: w, height: h });
      if (!said || (said.width === pane.w && said.height === pane.h)) return;
      pane = { w: said.width, h: said.height };
      for (const v of views) v.resized();
    },
    () => {},
  );
  return sizing;
};

// A size to the browser server, answered with the size it took.
const sizeTold = (size) =>
  new Promise((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: BROWSER,
        path: "/size",
        method: "POST",
        headers: { "content-type": "application/json" },
        timeout: 10000,
      },
      (res) => {
        let s = "";
        res.on("data", (d) => (s += d));
        res.on("end", () => resolve(res.statusCode === 200 ? parse(s) : null));
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.end(JSON.stringify(size));
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

// The brain, where this deployment has no address a machine can reach:
// the app dials in and holds one socket open, and what Claude Code asks
// for on this machine goes down it and comes back, paired by number: the
// brain's answer as one line, a model's as a head, its chunks and an end.
const ANSWER_IN = 30_000;
// A model call that says nothing for this long is over.
const STREAM_QUIET = 120_000;
let brain = null;
let asks = 0;
const waiting = new Map();

function brainLine(ws) {
  brain?.close();
  brain = ws;
  ws.text = (text) => {
    const said = parse(text);
    // A ping from the other end is answered, so it can tell this line is
    // still the door's and not one a restart left hanging open.
    if (said?.ping !== undefined)
      return ws.sendText(JSON.stringify({ pong: said.ping }));
    const answer = said && waiting.get(said.id);
    if (!answer) return;
    // A streamed answer keeps its place until its end; a whole one is
    // done with the line it came on.
    if (said.chunk === undefined && said.head === undefined)
      waiting.delete(said.id);
    answer(said);
  };
  ws.closed = () => {
    if (brain !== ws) return;
    brain = null;
    for (const answer of waiting.values()) answer(null);
    waiting.clear();
  };
}

// What the brain is asked, carried whole: the token that says who is
// asking, and what the caller wants back.
const CARRIED = ["authorization", "content-type", "accept", "maslow-answer"];

async function askTheBrain(req, res) {
  if (req.method !== "POST") return say(res, 405, "The brain answers a POST.");
  if (!brain) return say(res, 503, "No brain is listening for this computer.");
  const body = await bodyOf(req);
  // The brain may have gone while the body was read.
  const line = brain;
  if (!line) return say(res, 503, "No brain is listening for this computer.");
  const headers = {};
  for (const name of CARRIED)
    if (req.headers[name]) headers[name] = req.headers[name];
  const id = ++asks;
  const answer = await new Promise((resolve) => {
    const gave = (said) => {
      clearTimeout(clock);
      resolve(said);
    };
    const clock = setTimeout(() => {
      waiting.delete(id);
      resolve(null);
    }, ANSWER_IN);
    waiting.set(id, gave);
    try {
      line.sendText(JSON.stringify({ id, headers, body }));
    } catch {
      waiting.delete(id);
      gave(null);
    }
  });
  if (!answer) return say(res, 504, "The brain did not answer.");
  res.writeHead(answer.status, { "content-type": "application/json" });
  res.end(answer.body ?? "");
}

// A model call from this machine, carried up the same line to the
// laptop's gateway and streamed back down: the head first, then each
// chunk as it comes, then the end.
async function askTheModel(req, res, path) {
  if (req.method !== "POST")
    return say(res, 405, "The gateway answers a POST.");
  if (!brain)
    return say(res, 503, "No gateway is listening for this computer.");
  const body = await bodyOf(req);
  const line = brain;
  if (!line) return say(res, 503, "No gateway is listening for this computer.");
  const headers = {};
  for (const name of [...CARRIED, "anthropic-version", "anthropic-beta"])
    if (req.headers[name]) headers[name] = req.headers[name];
  const id = ++asks;
  let quiet = null;
  const over = () => {
    clearTimeout(quiet);
    waiting.delete(id);
    if (!res.headersSent) say(res, 504, "The gateway did not answer.");
    else res.end();
  };
  const tick = () => {
    clearTimeout(quiet);
    quiet = setTimeout(over, STREAM_QUIET);
  };
  tick();
  waiting.set(id, (said) => {
    if (said === null) return over();
    tick();
    if (said.head !== undefined) {
      if (!res.headersSent)
        res.writeHead(said.head, {
          "content-type": said.type ?? "application/json",
          "cache-control": "no-store",
        });
      return;
    }
    if (said.chunk !== undefined) {
      res.write(Buffer.from(said.chunk, "base64"));
      return;
    }
    clearTimeout(quiet);
    waiting.delete(id);
    res.end();
  });
  res.on("close", () => {
    clearTimeout(quiet);
    waiting.delete(id);
  });
  try {
    line.sendText(JSON.stringify({ id, path, headers, body }));
  } catch {
    over();
  }
}

// Whether an ask came from the machine itself, which nothing outside it
// reaches.
const fromTheMachine = (req) =>
  /^(?:::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(
    req.socket.remoteAddress ?? "",
  );

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

// The person's files, found by name: a walk of the home watched by a cap
// on how much it looks at and how long it takes, so a search never runs
// away on a full disk. Never descends into a dotfolder or node_modules.
// Answers the best eight, a whole name first.
const FIND_HOME = process.env.HOME_DIR ?? "/data/home";
const FIND_CAP = 20_000;
const FIND_MS = 300;

function findFiles(q) {
  const needle = q.toLowerCase();
  const deadline = Date.now() + FIND_MS;
  const hits = [];
  let seen = 0;
  const walk = (abs, rel) => {
    if (seen >= FIND_CAP || Date.now() > deadline) return;
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      if (seen >= FIND_CAP || Date.now() > deadline) return;
      seen++;
      const at = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) {
        if (d.name.startsWith(".") || d.name === "node_modules") continue;
        walk(`${abs}/${d.name}`, at);
      } else if (d.name.toLowerCase().includes(needle)) {
        hits.push(at);
      }
    }
  };
  walk(FIND_HOME, "");
  hits.sort((a, b) => {
    const named = (p) => p.split("/").at(-1).toLowerCase();
    const rank = (n) => (n === needle ? 0 : n.startsWith(needle) ? 1 : 2);
    return rank(named(a)) - rank(named(b)) || a.length - b.length;
  });
  return hits.slice(0, 8);
}

// Where the person's location is kept: a line the browser reads and the
// door writes, readable with `tail`, never through our server or our
// database. Rotated once it grows past what a location log is worth
// keeping.
const LOCATION_LOG = ".maslow/location.log";
const LOCATION_CAP = 5 * 1024 * 1024;

function appendLocation(line) {
  const at = files.inside(LOCATION_LOG);
  if (!at) return;
  const dir = path.dirname(at);
  fs.mkdirSync(dir, { recursive: true });
  fs.chownSync(dir, 1000, 1000);
  const s = fs.statSync(at, { throwIfNoEntry: false });
  if (s && s.size > LOCATION_CAP) fs.renameSync(at, `${at}.1`);
  fs.appendFileSync(at, `${line}\n`, { mode: 0o600 });
  fs.chownSync(at, 1000, 1000);
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
    // What they shared, by id: marked, followed, listed, read, written,
    // sent to the bucket and taken from it, all at our server's asking.
    if (url.pathname.startsWith("/maslow/files/shared"))
      return shares.serve(req, res, url);
    return files.serve(req, res, url, shares.idAt, shares.carrier);
  }
  // The person's location, read once a minute by their own browser and
  // sent straight here: a line appended to their own log, never through
  // our server or our database. The same cross-origin dance as the files
  // above, since this is the person's browser on our site asking their
  // machine's door directly.
  if (to.mine && url.pathname === "/maslow/location") {
    const from = req.headers.origin;
    if (from) {
      res.setHeader("access-control-allow-origin", from);
      res.setHeader("access-control-allow-methods", "POST, OPTIONS");
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
    if (req.method !== "POST")
      return say(res, 405, "A location is sent as a POST.");
    if (!ours(req.headers["x-maslow-ticket"]))
      return say(res, 401, "That ticket is not good here.");
    const said = parse(await bodyOf(req));
    const { latitude, longitude, accuracy, temperature, unit, condition } =
      said ?? {};
    if (
      typeof latitude !== "number" ||
      typeof longitude !== "number" ||
      typeof accuracy !== "number"
    )
      return say(
        res,
        400,
        "A location names its latitude, longitude and accuracy.",
      );
    const weather =
      typeof temperature === "number" && typeof condition === "string"
        ? `${temperature}°${unit === "F" || unit === "C" ? unit : ""} ${condition}`
        : "";
    appendLocation(
      [
        new Date().toISOString(),
        latitude,
        longitude,
        `${Math.round(accuracy)}m`,
        weather,
      ]
        .filter(Boolean)
        .join(" "),
    );
    res.writeHead(204);
    return res.end();
  }
  // The person's files by name, for the command bar: a ticket in the
  // query, as a socket carries one, since this is a plain request rather
  // than the upload's own kind.
  if (to.mine && url.pathname === "/maslow/find" && req.method === "GET") {
    const from = req.headers.origin;
    if (from) res.setHeader("access-control-allow-origin", from);
    if (!ours(url.searchParams.get("ticket")))
      return say(res, 401, "That ticket is not good here.");
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify(findFiles(url.searchParams.get("q") ?? "")));
  }
  // The picture the person last pasted, for the clipboard we answer on
  // their Linux's behalf. Only the machine itself may ask.
  if (to.mine && url.pathname === "/maslow/picture" && req.method === "GET") {
    if (!fromTheMachine(req))
      return say(res, 403, "Only the machine itself may ask.");
    const want = url.searchParams.get("want") ?? "image/png";
    const png = picture();
    if (!png) return say(res, 404, "");
    if (want === "TARGETS") return say(res, 200, "TARGETS\nimage/png\n");
    if (want !== "image/png") return say(res, 404, "");
    res.writeHead(200, {
      "content-type": "image/png",
      "content-length": png.length,
    });
    return res.end(png);
  }
  // Something a program on the machine wants opened, told to the person on
  // every terminal they have open: a port of this machine's, which opens
  // that port's window on their desktop; a file or folder of theirs, which
  // opens Files there; or any other web address, which is offered for them
  // to open on their own device. Only the machine itself can ask: the
  // request has to come from loopback, which nothing outside it reaches.
  if (to.mine && url.pathname === "/maslow/open" && req.method === "POST") {
    if (!fromTheMachine(req))
      return say(res, 403, "Only the machine itself may ask.");
    const ask = parse(await bodyOf(req));
    const offer = (open) => {
      for (const t of talkers) t.sendText(JSON.stringify({ open }));
      return say(
        res,
        200,
        talkers.size ? "offered" : "nobody is at a terminal",
      );
    };
    const port = ask?.port;
    if (Number.isInteger(port)) {
      if (port < 1 || port > 65535 || OURS.has(port))
        return say(res, 400, "That is not a port of yours.");
      return offer({ port });
    }
    // A path of the person's own, as their home has it: what lies outside
    // it is not theirs to open, and Files could not show it.
    if (typeof ask?.path === "string") {
      const rel = files.within(ask.path);
      if (rel === null) return say(res, 400, "That is not in your home.");
      // A file opens in the Preview window and a folder in Files, so
      // which it is goes with it.
      let file = false;
      try {
        file = !fs.statSync(path.join(FIND_HOME, rel)).isDirectory();
      } catch {}
      return offer({ path: rel, file });
    }
    let open;
    try {
      open = new URL(ask?.url);
    } catch {
      return say(res, 400, "That is not an address.");
    }
    if (!/^https?:$/.test(open.protocol))
      return say(res, 400, "Only a web address can be opened.");
    return offer(open.href);
  }
  // The two tools of the door's own, asked for by the small server it
  // hands every conversation of the agent's: a wakeup, which prompts the
  // conversation again after a while, and a monitor, which prompts it
  // with each line a command prints. The token names the conversation.
  if (to.mine && url.pathname === "/maslow/tools" && req.method === "POST") {
    if (!fromTheMachine(req))
      return say(res, 403, "Only the machine itself may ask.");
    const ask = parse(await bodyOf(req));
    const id = acp?.tokens.get(ask?.token);
    if (!id)
      return say(res, 403, "That is no conversation of this computer's.");
    const args = ask?.args ?? {};
    if (ask?.tool === "schedule_wakeup") {
      const delay = Math.min(
        86400,
        Math.max(30, Number(args.delay_seconds) || 0),
      );
      const prompt = String(args.prompt ?? "").trim();
      if (!prompt) return say(res, 400, "Say what to wake up with.");
      wakeupSet(id, delay, prompt);
      return say(res, 200, `You will be woken in ${delay} seconds.`);
    }
    if (ask?.tool === "monitor") {
      const command = String(args.command ?? "").trim();
      if (!command) return say(res, 400, "Say what to run.");
      const told = monitorStart(
        id,
        command,
        String(args.description ?? command),
      );
      return say(res, told.ok ? 200 : 400, told.said);
    }
    if (ask?.tool === "stop_monitor") {
      const m = monitors.get(String(args.id ?? ""));
      if (!m || m.chat !== id)
        return say(res, 404, "No monitor of yours by that id.");
      monitorStop(m);
      return say(res, 200, `Monitor ${m.id} stopped.`);
    }
    return say(res, 400, "No such tool.");
  }
  // The models, for what runs on this machine where the gateway cannot be
  // dialled: the call goes up the laptop's line and streams back.
  if (to.mine && url.pathname.startsWith("/maslow/model/")) {
    if (!fromTheMachine(req))
      return say(res, 403, "Only the machine itself may ask.");
    return askTheModel(req, res, url.pathname.slice("/maslow/model".length));
  }
  // The brain, for what runs on this machine: the person's own agent asks
  // here, and the token it carries says whose brain answers.
  if (to.mine && url.pathname === "/maslow/brain") {
    if (!fromTheMachine(req))
      return say(res, 403, "Only the machine itself may ask.");
    return askTheBrain(req, res);
  }
  // The numbers, for our server alone: it signs its ask with the secret.
  // With them, when the person was last here and what is running in their
  // terminal, which is what an update waiting on an idle computer needs.
  if (to.mine && url.pathname === "/maslow/stats") {
    if (!ours(req.headers["x-maslow-ticket"]))
      return say(res, 401, "That ticket is not good here.");
    const [numbers, programs] = await Promise.all([stats(), running()]);
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(
      JSON.stringify({
        ...numbers,
        idleSince: new Date(lastSeen).toISOString(),
        running: programs,
      }),
    );
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
      const body = await bodyOf(req);
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
  // A backup coming back, for our server alone: it asks with an address to
  // fetch the archive from, and reads how far the unpacking has got. The
  // archive lands in a folder of its own in the home, never over it.
  if (to.mine && url.pathname === "/maslow/restore") {
    if (!ours(req.headers["x-maslow-ticket"]))
      return say(res, 401, "That ticket is not good here.");
    if (req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(backup.restored()));
    }
    if (req.method === "POST") {
      const ask = parse(await bodyOf(req));
      if (typeof ask?.url !== "string" || typeof ask?.key !== "string")
        return say(res, 400, "An ask names the address and the key.");
      const name = backup.restore(ask);
      if (!name) return say(res, 409, "a restore is already running");
      res.writeHead(202, { "content-type": "application/json" });
      return res.end(JSON.stringify({ name }));
    }
  }
  // The keys that open SSH, for our server alone: written beside the
  // server's own, outside the person's Linux.
  if (to.mine && url.pathname === "/maslow/keys" && req.method === "PUT") {
    if (!ours(req.headers["x-maslow-ticket"]))
      return say(res, 401, "That ticket is not good here.");
    const text = await bodyOf(req);
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
    // carries nothing, so saying None gives nothing away. A partitioned
    // cookie is a different cookie to the browser, so both are thrown away.
    const gone = `; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=None`;
    res.writeHead(303, {
      location: onward,
      "set-cookie": [`${COOKIE}=${gone}; Partitioned`, `${COOKIE}=${gone}`],
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
        "set-cookie": `${COOKIE}=${ticket}; Path=/; Max-Age=${left}; HttpOnly; Secure; SameSite=None; Partitioned`,
      });
      return res.end();
    }
    if (!opens(cookieOf(req), to))
      return say(res, 401, "Open this from Maslow.");
  }
  // The machine itself has no page: its terminal, its view and its files
  // each have a road of their own above.
  if (to.mine) return say(res, 200, "ok");
  // A request on a port of theirs is the person at work here, whoever
  // sent it.
  if (to.theirs) seen();
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
    const own = {
      "/maslow/talk": talk,
      "/maslow/view": view,
      "/maslow/agent": agent,
      "/maslow/brain": brainLine,
    }[url.pathname];
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
  // A socket to a port of theirs is opened by the page on that port and by
  // nothing else. The cookie is partitioned to the frame it was set in, so
  // another site's page cannot carry it; the origin is checked as well, so
  // that partitioning is not the only lock. A client that sends no origin
  // is not a browser and is held to the cookie alone.
  if (to.theirs) {
    const from = req.headers.origin;
    if (from && from !== `https://${req.headers.host}`) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
  }
  if (to.theirs && !opens(cookieOf(req), to)) {
    socket.end("HTTP/1.1 401 Unauthorized\r\n\r\n");
    return;
  }
  if (to.theirs) seen();
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
  ws.bytes = (data) => {
    seen();
    server.write(data);
  };
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

// Into the person's own Linux, as them, with nothing of ours in the
// environment but a home and a path.
const AS_THEM = [
  "--userspec=1000:1000",
  "--groups=1000",
  OS,
  "/usr/bin/env",
  "-i",
  "HOME=/home/me",
  "PATH=/usr/local/bin:/usr/bin:/bin",
];

// A tmux command run as the person, in their Linux, answering its output.
const tmux = (...args) =>
  new Promise((resolve) => {
    execFile(
      "/usr/sbin/chroot",
      [...AS_THEM, "tmux", ...args],
      { timeout: 5000 },
      (err, out) => resolve(err ? null : out),
    );
  });

// Every terminal window on the desktop is a tmux session of its own, grouped
// with main, and numbered so the door can ask after it.
let talked = 0;

// A shell at rest is not a program running; what is named before a restart
// is what would be cut off.
const AT_REST = new Set(["bash", "-bash", "sh", "zsh", "tmux", "login"]);

// What is running in the person's terminal, by name, once each: what a
// restart would stop, for the page to say before it asks.
async function running() {
  const out = await tmux("list-panes", "-a", "-F", "#{pane_current_command}");
  if (out === null) return [];
  return [
    ...new Set(
      out
        .trim()
        .split("\n")
        .map((s) => s.trim())
        .filter((name) => name && !AT_REST.has(name)),
    ),
  ];
}

// The biggest picture worth carrying: past this, a screenshot is not what
// was meant.
const BIGGEST = 24 * 1024 * 1024;

// The picture the person last pasted, held for whatever is running in
// their terminal to ask for. It cannot be put on a clipboard of the
// machine's: what runs in the terminal is inside the person's own Linux,
// which has no display and none of our tools, so the clipboard it reaches
// for is one we answer ourselves, through `xclip` on their path.
let pasted = null;
let pastedAt = 0;

// Long enough for the paste it was meant for, and not a copy of what
// somebody put on their clipboard sitting here for the machine's life.
const HELD_FOR = 5 * 60 * 1000;

// A PNG begins with these eight bytes and nothing else does; what is
// handed on is answered for as a PNG, so anything else is not taken.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function holdPicture(base64) {
  const png = Buffer.from(base64, "base64");
  // A picture refused leaves nothing behind: the paste that follows must
  // not fetch the one before it.
  const ok = png.length <= BIGGEST && png.subarray(0, 8).equals(PNG);
  pasted = ok ? png : null;
  pastedAt = Date.now();
}

// The picture, while it is still the one that was just pasted.
function picture() {
  if (pasted && Date.now() - pastedAt > HELD_FOR) pasted = null;
  return pasted;
}

function talk(ws, url) {
  talkers.add(ws);
  const session = `talk-${++talked}`;
  const size = (name, fallback) => {
    const n = Number(url.searchParams.get(name));
    return Number.isInteger(n) && n > 0 && n <= 1000 ? n : fallback;
  };
  const term = pty.spawn(
    "/usr/sbin/chroot",
    [
      ...AS_THEM,
      `USER=${PERSON}`,
      `LOGNAME=${PERSON}`,
      "SHELL=/bin/bash",
      "LANG=C.UTF-8",
      "TERM=xterm-256color",
      // A terminal window just opened on the desktop asks for a shell of its
      // own; one coming back finds the session as it was.
      `FRESH=${url.searchParams.get("fresh") === "1" ? 1 : 0}`,
      `TALK=${session}`,
      "/bin/bash",
      "-lc",
      "exec /opt/maslow/terminal.sh",
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
  term.onExit(() => ws.close());
  // The session's windows, in order, and which this terminal is looking
  // at: asked four times a second, so a window opened or renamed in the
  // terminal itself shows in the list about as fast as it happened, and
  // said only when they change, so the page is quiet the rest of the time.
  let windows = null;
  const list = async () => {
    const out = await tmux(
      "list-windows",
      "-t",
      session,
      "-F",
      "#{window_index} #{window_active} #{window_name}",
    );
    if (out === null) return;
    const now = JSON.stringify({
      windows: out
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          // The number, whether it is in view, and then the name, which
          // may hold spaces of its own.
          const m = /^(\d+) ([01]) (.*)$/.exec(line);
          return m && { index: Number(m[1]), on: m[2] === "1", name: m[3] };
        })
        .filter(Boolean),
    });
    if (now === windows) return;
    windows = now;
    ws.sendText(now);
  };
  const listing = setInterval(() => void list(), 250);
  ws.bytes = (data) => {
    seen();
    term.write(data);
  };
  ws.text = (text) => {
    const said = parse(text);
    // The window this terminal should look at, by number, or a new one.
    if (Number.isInteger(said?.select))
      void tmux("select-window", "-t", `${session}:${said.select}`).then(list);
    if (said?.window === "new")
      void tmux("new-window", "-t", session, "-c", "/home/me").then(list);
    // A name the person gave a shell. tmux stops naming that one itself
    // from here on, so their word stands until they change it.
    const named = said?.rename;
    if (Number.isInteger(named?.index) && typeof named?.name === "string") {
      const name = named.name
        .replace(/[\n\r]/g, " ")
        .trim()
        .slice(0, 40);
      if (name)
        void tmux(
          "rename-window",
          "-t",
          `${session}:${named.index}`,
          name,
        ).then(list);
    }
    // A window closed from the list, never the last: the last going
    // would take every terminal with it.
    if (Number.isInteger(said?.close))
      void tmux("display", "-p", "-t", session, "#{session_windows}").then(
        (n) =>
          Number(n) > 1 &&
          tmux("kill-window", "-t", `${session}:${said.close}`).then(list),
      );
    const r = said?.resize;
    if (Number.isInteger(r?.cols) && Number.isInteger(r?.rows))
      term.resize(
        Math.min(Math.max(r.cols, 1), 1000),
        Math.min(Math.max(r.rows, 1), 1000),
      );
    // A picture the person copied on their own device, put on the
    // machine's clipboard where what runs in the terminal can take it:
    // Claude Code asks the clipboard for a picture, and there is no other
    // way to hand it one from a browser a thousand miles away.
    if (typeof said?.picture === "string") holdPicture(said.picture);
  };
  ws.closed = () => {
    clearInterval(listing);
    talkers.delete(ws);
    // The window this terminal was looking at goes with it when nobody
    // ever ran anything there: one pane, a bare prompt, nothing scrolled
    // past, no other terminal on it. Anything more stays for the next tab.
    void tmux(
      "display",
      "-p",
      "-t",
      session,
      "#{window_active_sessions} #{window_panes} #{history_size} #{cursor_y} #{pane_current_command} #{session_windows}",
    )
      .then((out) => {
        const [looking, panes, past, line, command, count] = (out ?? "")
          .trim()
          .split(" ");
        if (
          looking === "1" &&
          panes === "1" &&
          past === "0" &&
          line === "0" &&
          command === "bash" &&
          Number(count) > 1
        )
          return tmux("kill-window", "-t", session);
      })
      .finally(() => term.kill());
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
  // The size the picture arrives at, said as the socket opens and again
  // whenever it changes, so the viewer's decoder and its canvas are the
  // size of what is coming. A stream begins again at the new size, so the
  // first frame after a change is a whole one.
  const me = {
    resized() {
      if (video) {
        video.stop();
        video = stream(ws, send);
      }
      send({ size: pane });
    },
  };
  views.add(me);
  send({ size: pane });
  // The tabs, and whether there is one to show, said whenever they change:
  // asked every second, and at once after the person changed them.
  let were = null;
  let wasOpen = false;
  const ask = async () => {
    const now = await tabsOf();
    if (now === null || now === were) return;
    were = now;
    const open = JSON.parse(now).current !== null;
    if (open !== wasOpen) {
      wasOpen = open;
      send({ browser: open ? "open" : "closed" });
    }
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
  // Acts and tab changes happen one after another, in the order they
  // came, so a copy asked for right after a selection copies that
  // selection; a pointer move never waits.
  let queue = Promise.resolve();
  const inTurn = (work) => {
    queue = queue.then(work, work);
    return queue;
  };
  ws.text = async (text) => {
    const said = parse(text);
    if (!said) return;
    if ("ping" in said) send({ pong: said.ping });
    else if ("view" in said) {
      video?.stop();
      video = said.view === true ? stream(ws, send) : null;
    } else if ("size" in said) {
      const { w, h } = said.size ?? {};
      if (typeof w === "number" && typeof h === "number") await resize(w, h);
    } else if (said.act?.kind === "move") {
      if (typeof said.act.x === "number" && typeof said.act.y === "number")
        move(said.act.x, said.act.y);
    } else if (said.act?.kind === "leave") {
      hands?.end();
      hands = null;
    } else if ("act" in said)
      await inTurn(async () => send({ id: said.id, ...(await act(said.act)) }));
    else if ("tab" in said || "newTab" in said || "closeTab" in said) {
      await inTurn(async () => {
        await tabsTold(text);
        await ask();
      });
    } else if ("watch" in said) {
      watcher?.close();
      watcher = watch(said.watch, (name) => send({ changed: name }));
    }
  };
  ws.closed = () => {
    views.delete(me);
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
// pointer. The pictures end when another tab becomes current and are asked
// for again at once, into the same encoder, so a tab change is a cut in
// one stream rather than a stream that stops and starts; while the browser
// is closed there is no picture, and it is asked for again every second
// until there is.
function stream(ws, send) {
  let on = true;
  let asking = null;
  let encoder = null;
  let retry = null;
  // One encoder for as long as this viewer watches. A tab becoming
  // current changes which pictures arrive, not what turns them into
  // video, so the video is one unbroken stream: the viewer never waits
  // on a new encoder to make a frame it can begin on.
  //
  // One picture in the encoder at a time; the next waits in its place
  // and goes the moment the write is done, so the last change always
  // reaches the viewer.
  let latest = null;
  let writing = false;
  const feed = (jpeg) => {
    const ff = encoder;
    if (!ff) return;
    if (writing) {
      latest = jpeg;
      return;
    }
    writing = true;
    ff.stdin.write(jpeg, () => {
      writing = false;
      if (!latest) return;
      const next = latest;
      latest = null;
      feed(next);
    });
  };
  // At once when the pictures ended because another tab is current; in a
  // second when there was no tab, or no answer, to show. Not at all once
  // the viewer has gone.
  const again = (wait) => {
    clearTimeout(retry);
    if (on) retry = setTimeout(go, wait);
  };
  const go = () => {
    if (!on) return;
    asking = http.get(
      { host: "127.0.0.1", port: BROWSER, path: "/screencast" },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          res.on("end", () => again(1000));
          return;
        }
        if (!encoder) {
          const ff = encode(ws);
          encoder = ff;
          // An encoder that stops on its own is made again on the next
          // pictures, rather than leaving the viewer with none.
          ff.on("exit", () => {
            if (encoder === ff) encoder = null;
            writing = false;
            latest = null;
          });
        }
        let buf = Buffer.alloc(0);
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
        res.on("close", () => again(0));
      },
    );
    asking.on("error", () => again(1000));
  };
  go();
  return {
    stop() {
      on = false;
      clearTimeout(retry);
      asking?.destroy();
      encoder?.kill("SIGKILL");
      encoder = null;
    },
  };
}

// A fresh H.264 encoder for one viewer, so the first frame it sends is a
// key frame: pictures in, and each frame out sent as it is made, as FLV
// delimits them. The socket's pace is the encoder's: a viewer that cannot
// take frames as fast as they come holds the encoder, which then takes
// fewer pictures. The encoder is told to look at one picture and start,
// rather than gather seconds of them first, as it would for a file. The
// browser draws at the size of the pane being watched, so its pictures
// pass through unchanged; one of another size, from the moment a size
// changed, is fitted into it, since a viewer decodes one size at a time.
function encode(ws) {
  const { w, h } = pane;
  const ff = spawn(
    ffmpeg.path,
    [
      ...["-loglevel", "error", "-probesize", "32", "-analyzeduration", "0"],
      ...["-f", "image2pipe", "-c:v", "mjpeg", "-i", "-", "-an"],
      ...["-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency"],
      ...["-pix_fmt", "yuv420p", "-profile:v", "baseline", "-level", "3.1"],
      ...["-x264-params", "keyint=120:scenecut=0:repeat-headers=1"],
      "-vf",
      `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2`,
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

// The agent: Claude Code on this machine as an editor talks to it, over
// the Agent Client Protocol. One process for the machine, started as the
// person in their home on the key Maslow gave the machine, and started
// again when it ends. It is the one way to that key: the person's own
// `claude` in a terminal never sees it. The door holds the conversation, not the
// tab: the sockets carry the protocol's lines both ways, one JSON message
// to a frame, what the agent said while nobody watched is kept and
// replayed to the next socket, and the session id is written to the disk
// so a door that comes back after a new image loads the same conversation.

// Where the agent works: the person's home, as any shell of theirs opens.
const HOME = "/home/me";

// The conversations this computer has open, outside the person's Linux so
// a reset of theirs never takes them; opened again when the door starts.
const CHATS = "/data/.agent-chats.json";
// A conversation quiet this long is closed, its Claude Code process
// freed, and opened again with its whole history the next time it is
// wanted.
const SLEEP = 3 * 60_000;

// The most of what the agent said that is kept for the next socket.
const KEPT = 2000;

// Every socket watching the conversation.
const watchers = new Set();

// The process and everything the door knows about it, or none while no
// socket has ever asked for one.
let acp = null;

// The conversations open when the door last ran, as the disk has them.
function chatsWere() {
  try {
    const ids = JSON.parse(fs.readFileSync(CHATS, "utf8"));
    return Array.isArray(ids)
      ? ids.filter((id) => /^[0-9a-fA-F-]{36}$/.test(id)).slice(0, 4)
      : [];
  } catch {
    return [];
  }
}

const chatsAre = (room) => {
  try {
    fs.writeFileSync(CHATS, JSON.stringify([...room.chats.keys()]));
  } catch {
    // A disk that will not take it costs the next door its history and
    // nothing else.
  }
};

// The server of the door's own tools, handed to a conversation as it is
// opened: Claude Code starts it beside the conversation over stdio, and
// every call comes back to the door under this token, which is the
// conversation's name to the door and nothing else's.
function handed() {
  const token = randomBytes(16).toString("hex");
  return {
    token,
    servers: [
      {
        name: "maslow",
        command: "node",
        args: ["/opt/maslow/agent-tools.mjs"],
        env: [{ name: "MASLOW_TOOL_TOKEN", value: token }],
      },
    ],
  };
}

// A word to a conversation from the door itself, a wakeup firing or a
// monitor's lines: into the record as a line of the person's, into the
// running turn if one runs and as a turn of its own if not, and the
// conversation woken first if it sleeps.
async function chatSay(id, text) {
  const room = acp ?? agentStart();
  await room.started;
  if (acp !== room) return;
  const chat = await chatOpen(room, id);
  if (!chat || acp !== room) return;
  fromAgent(room, {
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: chat.id,
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text },
      },
    },
  });
  const steer = (chat.busy ?? 0) > 0;
  if (!steer) {
    chat.busy = (chat.busy ?? 0) + 1;
    chatRunning(room, chat, true);
  }
  try {
    await agentAsk(room, "session/prompt", {
      sessionId: chat.id,
      prompt: [{ type: "text", text }],
    });
  } catch {
    // A turn that failed ends like any other; the record says what it said.
  } finally {
    if (!steer && acp === room && room.chats.get(chat.id) === chat) {
      chat.busy = Math.max(0, (chat.busy ?? 1) - 1);
      settle(room, chat);
    }
  }
}

// A wakeup: one per conversation, kept on the disk so the door coming
// back still keeps it, and fired at once when its time passed while the
// door was down.
const WAKEUPS = "/data/.agent-wakeups.json";
const wakeups = new Map();
function wakeupsWere() {
  try {
    const w = JSON.parse(fs.readFileSync(WAKEUPS, "utf8"));
    return w && typeof w === "object" ? w : {};
  } catch {
    return {};
  }
}
const wakeupsAre = (w) => {
  try {
    fs.writeFileSync(WAKEUPS, JSON.stringify(w));
  } catch {
    // Kept in memory alone, then.
  }
};
function wakeupArm(id, at, prompt) {
  clearTimeout(wakeups.get(id));
  wakeups.set(
    id,
    setTimeout(
      () => {
        wakeups.delete(id);
        void chatSay(id, prompt).then(() => {
          const w = wakeupsWere();
          delete w[id];
          wakeupsAre(w);
        });
      },
      Math.max(0, at - Date.now()),
    ),
  );
}
function wakeupSet(id, delay, prompt) {
  const at = Date.now() + delay * 1000;
  const w = wakeupsWere();
  w[id] = { at, prompt };
  wakeupsAre(w);
  wakeupArm(id, at, prompt);
}

// A monitor: a command run as the person, whose lines reach its
// conversation as they come, a second's worth at a time. It outlives the
// conversation's sleep, waking it with what it prints, and ends with the
// door.
const monitors = new Map();
let ranMonitors = 0;
function monitorStart(chat, command, description) {
  let mine = 0;
  for (const m of monitors.values()) if (m.chat === chat) mine++;
  if (mine >= 4)
    return {
      ok: false,
      said: "Four monitors already run for you; stop one first.",
    };
  const id = `m${++ranMonitors}`;
  const proc = spawn(
    "/usr/sbin/chroot",
    [
      ...AS_THEM,
      `USER=${PERSON}`,
      `LOGNAME=${PERSON}`,
      "SHELL=/bin/bash",
      "LANG=C.UTF-8",
      "/bin/bash",
      "-lc",
      `cd ${HOME} && ${command}`,
    ],
    { cwd: "/", stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  const m = {
    id,
    chat,
    proc,
    held: "",
    lines: [],
    timer: undefined,
    stopped: false,
  };
  monitors.set(id, m);
  const tell = () => {
    m.timer = undefined;
    if (!m.lines.length) return;
    const said = m.lines.splice(0).join("\n");
    void chatSay(chat, `[monitor ${id}: ${description}]\n${said}`);
  };
  const heard = (buf) => {
    const parts = (m.held + buf).split("\n");
    m.held = parts.pop() ?? "";
    if (m.held.length > 4096) {
      m.lines.push(`${m.held.slice(0, 4096)} …`);
      m.held = "";
    }
    for (const line of parts) if (line.trim()) m.lines.push(line);
    if (m.lines.length > 200) m.lines.splice(0, m.lines.length - 200);
    if (!m.timer) m.timer = setTimeout(tell, 1000);
  };
  proc.stdout.on("data", heard);
  proc.stderr.on("data", heard);
  proc.on("error", (err) => heard(`${err.message}\n`));
  proc.on("exit", (code, signal) => {
    monitors.delete(id);
    if (m.held.trim()) m.lines.push(m.held);
    clearTimeout(m.timer);
    if (!m.stopped) m.lines.push(`(ended: ${signal ?? `exit ${code}`})`);
    tell();
  });
  return {
    ok: true,
    said: `Monitor ${id} started: ${description}. What it prints reaches you as it comes; stop_monitor ${id} ends it.`,
  };
}
function monitorStop(m) {
  m.stopped = true;
  try {
    process.kill(-m.proc.pid, "SIGTERM");
  } catch {
    // Gone already.
  }
}

// A conversation as the page is told of it.
const chatSaid = (chat) => ({
  id: chat.id,
  running: chat.running,
  modes: chat.session?.modes ?? null,
  title: titles[chat.id] ?? null,
});

// The way to Maslow's models this machine holds: the gateway's address
// and a token of this computer's, given by our server with the machine.
// No key is on the machine. The door hands them to the agent behind the
// Agent window and to the terminals it runs its commands in, and `claude`
// in the person's own terminal never sees them.
const asOurs = () => [
  "MASLOW_AUTH=managed",
  `MASLOW_MODEL_URL=${process.env.MODEL_URL ?? ""}`,
  `MASLOW_MODEL_TOKEN=${process.env.MODEL_TOKEN ?? ""}`,
];

// The whole picture of the conversation: what the process is doing, which
// conversation it is in, and whether a prompt is running. `clear` says the
// transcript a socket holds is no longer this one's, so the page begins
// again on what follows.
const agentHello = (clear) => ({
  maslow: {
    clear,
    state: acp?.state ?? "off",
    why: acp?.why ?? null,
    chats: acp ? [...acp.chats.values()].map(chatSaid) : [],
  },
});

// How full the conversation is, reckoned from Claude Code's own record of
// it on the machine, since a model reached through OpenRouter reports no
// token counts of its own: what was said, what the tools said back and
// what was thought, about four characters to a token, counted since the
// last time Claude Code folded the conversation down. Told to every
// socket when a conversation is opened and each time a prompt ends.
const WINDOW = 1_000_000;
const record = (id) =>
  `${FIND_HOME}/.claude/projects/${HOME.replaceAll("/", "-")}/${id}.jsonl`;
async function contextOf(id) {
  let text;
  try {
    const at = record(id);
    const { size } = await fs.promises.stat(at);
    if (size > 64 * 1024 * 1024) return null;
    text = await fs.promises.readFile(at, "utf8");
  } catch {
    return null;
  }
  let said = 0;
  let tools = 0;
  let thought = 0;
  const grow = (s) =>
    typeof s === "string" ? s.length : JSON.stringify(s ?? "").length;
  for (const line of text.split("\n")) {
    if (!line) continue;
    let j;
    try {
      j = JSON.parse(line);
    } catch {
      continue;
    }
    // A fold: what came before it is no longer in the window.
    if (j.type === "summary" || j.isCompactSummary) {
      said = grow(j.summary ?? j.message?.content);
      tools = 0;
      thought = 0;
      continue;
    }
    const content = j.message?.content;
    if (content === undefined) continue;
    if (typeof content === "string") {
      said += content.length;
      continue;
    }
    for (const c of content) {
      if (c?.type === "text") said += grow(c.text);
      else if (c?.type === "thinking") thought += grow(c.thinking);
      else if (c?.type === "tool_use") tools += grow(c.input);
      else if (c?.type === "tool_result") tools += grow(c.content);
    }
  }
  const tokens = (n) => Math.round(n / 4);
  return {
    max: WINDOW,
    segments: [
      { label: "Messages", tokens: tokens(said) },
      { label: "Tools and their output", tokens: tokens(tools) },
      { label: "Thinking", tokens: tokens(thought) },
    ],
  };
}
// What a conversation is called: a few plain words from its first
// exchange, asked of the model the key runs once the first answer is in,
// kept on the disk beside the session id, and laid over the first-prompt
// names Claude Code's own list gives.
const TITLES = "/data/.agent-titles.json";
let titles = {};
try {
  titles = JSON.parse(fs.readFileSync(TITLES, "utf8"));
} catch {
  titles = {};
}
const naming = new Set();
// A conversation's name, whoever gave it: kept on the disk and told to
// every socket.
function entitled(id, title) {
  titles[id] = title;
  try {
    fs.writeFileSync(TITLES, JSON.stringify(titles));
  } catch {
    // The disk keeps it next time.
  }
  toWatchers({ maslow: { chat: { id, title } } });
}

async function entitle(chat) {
  const id = chat.id;
  if (!id || titles[id] || naming.has(id) || !process.env.MODEL_TOKEN) return;
  const words = (kind) =>
    chat.ring
      .filter(
        (m) =>
          m.method === "session/update" &&
          m.params?.update?.sessionUpdate === kind,
      )
      .map((m) => m.params.update.content?.text ?? "")
      .join("")
      .trim();
  const person = words("user_message_chunk");
  const agent = words("agent_message_chunk");
  if (!person) return;
  naming.add(id);
  try {
    const res = await fetch(`${process.env.MODEL_URL}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.MODEL_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "z-ai/glm-5.3-flash:nitro",
        // The model thinks before it answers and will not be told not to;
        // the budget is wide enough that the name comes after the thought
        // rather than in place of it.
        max_tokens: 400,
        messages: [
          {
            role: "system",
            content:
              "Name this conversation in at most five plain words, as a title. No quotes, no full stop, no word 'conversation'. Answer with the title alone.",
          },
          {
            role: "user",
            content: `Person: ${person.slice(0, 600)}\n\nAgent: ${agent.slice(0, 600)}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const j = await res.json();
    const title = String(j?.choices?.[0]?.message?.content ?? "")
      .trim()
      .split("\n")[0]
      .replace(/^["'“]|["'”.]$/g, "")
      .slice(0, 60);
    if (title) entitled(id, title);
  } catch (err) {
    // Unnamed is what Claude Code's own list calls it, and that stands.
    console.error("naming a conversation:", err?.message ?? err);
  } finally {
    naming.delete(id);
  }
}
const titled = (result) =>
  result?.sessions
    ? {
        ...result,
        sessions: result.sessions.map((s) =>
          titles[s.sessionId] ? { ...s, title: titles[s.sessionId] } : s,
        ),
      }
    : result;

async function tellContext(chat) {
  const context = await contextOf(chat.id).catch(() => null);
  toWatchers({ maslow: { chat: { id: chat.id, context } } });
}

const toWatchers = (said) => {
  const line = JSON.stringify(said);
  for (const ws of watchers) ws.sendText(line);
};

const toAgent = (room, said) => {
  try {
    room.proc.stdin.write(`${JSON.stringify(said)}\n`);
  } catch {
    // A process that has gone is answered for by its exit.
  }
};

// Something the door asks the agent for itself, answered when the agent
// answers or when the process ends under it.
function agentAsk(room, method, params) {
  return new Promise((answer, fail) => {
    // A process that has ended answers nothing ever again, so an ask that
    // arrives after it fails now rather than waiting for a reply.
    if (room.gone) return fail(new Error("The agent stopped answering."));
    const id = ++room.asked;
    room.waiting.set(id, (said) =>
      said && !said.error
        ? answer(said.result)
        : fail(
            new Error(said?.error?.message ?? "The agent stopped answering."),
          ),
    );
    toAgent(room, { jsonrpc: "2.0", id, method, params });
  });
}

// Whether a prompt is running, told to every socket so each shows the way
// to stop it, whichever of them sent it.
function chatRunning(room, chat, on) {
  clearTimeout(chat.quiet);
  chat.quiet = undefined;
  if (chat.running !== on) {
    chat.running = on;
    toWatchers({ maslow: { chat: { id: chat.id, running: on } } });
  }
  if (on) return;
  // A question the agent asked before it acted belongs to the prompt that
  // just ended, answered or not; it is not asked of the next socket to
  // arrive.
  for (let i = chat.ring.length - 1; i >= 0; i--)
    if (
      /^(session\/request_permission|_maslow\/ask)$/.test(chat.ring[i].method)
    ) {
      const [gone] = chat.ring.splice(i, 1);
      if (gone.id !== undefined)
        toAgent(room, {
          jsonrpc: "2.0",
          id: gone.id,
          error: { code: -32800, message: "The person moved on." },
        });
    }
  void tellContext(chat);
  void entitle(chat);
  nap(room, chat);
}

// A turn is over once the agent has been quiet for a moment with no
// prompt of the door's own still out and no question waiting on the
// person: a word pushed into a running turn can start another the door
// never asked for, and that one has no answer to mark its end.
const SETTLE = 1000;
const asking = (chat) =>
  chat.ring.some((m) =>
    /^(session\/request_permission|_maslow\/ask)$/.test(m.method),
  );
function settle(room, chat) {
  clearTimeout(chat.settle);
  chat.settle = setTimeout(() => {
    chat.settle = undefined;
    if (chat.busy > 0 || asking(chat)) return;
    if (acp === room && room.chats.get(chat.id) === chat)
      chatRunning(room, chat, false);
  }, SETTLE);
}

// A conversation left alone sleeps after a while: its process is freed,
// and it opens again whole when wanted.
const nap = (room, chat) => {
  clearTimeout(chat.quiet);
  chat.quiet = setTimeout(() => void chatClose(room, chat.id), SLEEP);
};

// The terminals the agent runs its commands in. The protocol lets the
// client own them: the agent asks for one, the door starts it as the
// person in their home on the key Maslow gave the machine, and what it
// writes goes to every socket as it arrives, so a command's output is
// live in the Agent window instead of a wall of text at the end. The
// browser never runs anything; it is shown what this one did.
const MOST_OUTPUT = 1 << 20;
const terminals = new Map();
let ranTerminals = 0;

// One word for a shell, with nothing in it the shell will read as its own.
const quoted = (s) => `'${String(s).replaceAll("'", `'\\''`)}'`;

// What a terminal has written and how it ended, as the protocol says it.
const terminalSaid = (t) => ({
  output: t.output,
  truncated: t.truncated,
  exitStatus: t.exit,
});

// Every socket told what a terminal has written now, at most ten times a
// second, so a command writing fast costs one frame a beat rather than
// one a line.
function terminalSays(t) {
  if (t.saying) return;
  t.saying = setTimeout(() => {
    t.saying = null;
    toWatchers({ maslow: { terminal: { id: t.id, ...terminalSaid(t) } } });
  }, 100);
}

// A terminal started as the person, in the folder the agent named or
// their home, through a login shell so the key Claude Code runs on and
// their own path are there as in any terminal of theirs.
function terminalStart(params) {
  const id = `t${++ranTerminals}`;
  const cwd =
    typeof params?.cwd === "string" && params.cwd.startsWith("/")
      ? params.cwd
      : HOME;
  // What was asked for, as a shell reads it: the command is a line, since
  // an agent hands its whole command over as one, and each argument after
  // it is one word however it is spelled.
  const line = [
    params?.command ?? "",
    ...(params?.args ?? []).map(quoted),
  ].join(" ");
  // The environment the agent named, as either shape the protocol uses,
  // kept to what a variable may be called — chroot reads every word before
  // the command as an assignment — and never ours: a session of ours runs
  // on credentials of ours and never spends what the person provided, and
  // the last assignment wins, so an agent naming them would win.
  const named = (
    Array.isArray(params?.env)
      ? params.env.map((e) => `${e?.name}=${e?.value ?? ""}`)
      : Object.entries(params?.env ?? {}).map(([k, v]) => `${k}=${v}`)
  ).filter(
    (e) =>
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(e) &&
      !/^MASLOW_(AUTH|MODEL_URL|MODEL_TOKEN)=/.test(e),
  );
  const proc = spawn(
    "/usr/sbin/chroot",
    [
      ...AS_THEM,
      `USER=${PERSON}`,
      `LOGNAME=${PERSON}`,
      "SHELL=/bin/bash",
      "LANG=C.UTF-8",
      ...asOurs(),
      ...named,
      "/bin/bash",
      "-lc",
      `cd ${quoted(cwd)} && ${line}`,
    ],
    // A group of its own, so what the command starts — a pipeline, a
    // child left in the background — stops with it.
    { cwd: "/", stdio: ["ignore", "pipe", "pipe"], detached: true },
  );
  const most =
    Number.isInteger(params?.outputByteLimit) && params.outputByteLimit > 0
      ? Math.min(params.outputByteLimit, MOST_OUTPUT)
      : MOST_OUTPUT;
  const t = {
    id,
    proc,
    output: "",
    truncated: false,
    exit: null,
    saying: null,
    waiting: [],
  };
  // The end of what was written is what matters, so a long run keeps its
  // last words rather than its first.
  const wrote = (chunk) => {
    t.output += chunk;
    if (t.output.length > most) {
      t.output = t.output.slice(-most);
      t.truncated = true;
    }
    terminalSays(t);
  };
  proc.stdout.on("data", (d) => wrote(d.toString()));
  proc.stderr.on("data", (d) => wrote(d.toString()));
  proc.on("error", (err) => wrote(`${err.message}\n`));
  proc.on("exit", (code, signal) => {
    t.exit = { exitCode: code ?? null, signal: signal ?? null };
    clearTimeout(t.saying);
    t.saying = null;
    toWatchers({ maslow: { terminal: { id, ...terminalSaid(t) } } });
    for (const done of t.waiting) done();
    t.waiting = [];
  });
  terminals.set(id, t);
  return id;
}

// The terminal an ask names, or nothing when it has been let go.
const terminalOf = (params) => terminals.get(params?.terminalId);

function terminalEnd(t, forget) {
  // The whole group, not only the shell: a pipeline's members and anything
  // it left behind go with it.
  if (!t.exit) {
    try {
      process.kill(-t.proc.pid, "SIGKILL");
    } catch {
      t.proc.kill("SIGKILL");
    }
  }
  clearTimeout(t.saying);
  t.saying = null;
  if (forget) terminals.delete(t.id);
}

// What the door answers the agent about a terminal of its own.
async function terminalAsk(room, said) {
  const reply = (result, error) =>
    toAgent(room, {
      jsonrpc: "2.0",
      id: said.id,
      ...(error ? { error } : { result }),
    });
  const p = said.params;
  if (said.method === "terminal/create")
    return reply({ terminalId: terminalStart(p) });
  const t = terminalOf(p);
  if (!t) return reply(null, { code: -32602, message: "No such terminal." });
  if (said.method === "terminal/output") return reply(terminalSaid(t));
  if (said.method === "terminal/kill") {
    terminalEnd(t, false);
    return reply(null);
  }
  if (said.method === "terminal/release") {
    terminalEnd(t, true);
    return reply(null);
  }
  if (said.method === "terminal/wait_for_exit") {
    if (!t.exit) await new Promise((done) => t.waiting.push(done));
    return reply({ exitStatus: t.exit });
  }
  reply(null, { code: -32601, message: `${said.method} is not here.` });
}

// A line the agent said: an answer to something asked, or something it is
// telling the client, which every socket hears and the next socket is
// replayed. A question it asks stays in the record until somebody answers;
// an ask about a terminal is the door's own to answer, and never the
// browser's.
function fromAgent(room, said) {
  if (acp !== room) return;
  if (said.method === undefined && said.id !== undefined) {
    const answer = room.waiting.get(said.id);
    if (!answer) return;
    room.waiting.delete(said.id);
    return answer(said);
  }
  if (typeof said.method === "string" && said.method.startsWith("terminal/"))
    return void terminalAsk(room, said);
  const chat = room.chats.get(said.params?.sessionId);
  if (!chat) return;
  if (chat.replaying && said.method === "session/update") return;
  chat.ring.push(said);
  if (chat.ring.length > KEPT) chat.ring.shift();
  toWatchers(said);
  if (said.method === "session/update") {
    const kind = said.params?.update?.sessionUpdate;
    if (
      /^(agent_message_chunk|agent_thought_chunk|tool_call|tool_call_update|plan)$/.test(
        kind,
      )
    ) {
      if (!chat.running) chatRunning(room, chat, true);
      settle(room, chat);
    }
  } else if (asking(chat)) clearTimeout(chat.settle);
}

// The records of conversations closed since the door started, by id, so
// one opened again is whole on the page before Claude Code has loaded it.
// Only the last few are held: a door that runs for weeks would otherwise
// keep every transcript it ever closed.
const KEPT_CHATS = 8;
const kept = new Map();
const keep = (id, ring) => {
  kept.set(id, ring);
  // A Map hands back its keys in the order they were set, so the first is
  // the one closed longest ago.
  if (kept.size > KEPT_CHATS) kept.delete(kept.keys().next().value);
};

function agentStart() {
  const proc = spawn(
    "/usr/sbin/chroot",
    [
      ...AS_THEM,
      `USER=${PERSON}`,
      `LOGNAME=${PERSON}`,
      "SHELL=/bin/bash",
      "LANG=C.UTF-8",
      // A session of ours, on the key Maslow gave the machine, never on
      // what the person provided for their own.
      ...asOurs(),
      "/bin/bash",
      "-lc",
      `cd ${HOME} && exec /opt/maslow/bin/claude-code-acp`,
    ],
    { cwd: "/", stdio: ["pipe", "pipe", "inherit"] },
  );
  const room = {
    proc,
    state: "starting",
    why: null,
    // Set when the process ends, so nothing asks a dead one anything.
    gone: false,
    // What the agent answered `initialize` with, which every socket is
    // given: the process takes one client, and the door is it.
    init: null,
    chats: new Map(),
    tokens: new Map(),
    spare: null,
    warming: false,
    asked: 0,
    waiting: new Map(),
  };
  acp = room;
  toWatchers(agentHello(true));
  let rest = "";
  proc.stdout.on("data", (d) => {
    rest += d;
    for (;;) {
      const at = rest.indexOf("\n");
      if (at < 0) return;
      const line = rest.slice(0, at);
      rest = rest.slice(at + 1);
      const said = parse(line);
      if (said) fromAgent(room, said);
    }
  });
  proc.stdin.on("error", () => {});
  proc.on("error", () => {});
  proc.on("exit", () => {
    // Nothing of this room outlives its process: what the door was waiting
    // on is failed rather than left hanging, and the sleep timers are
    // cleared, since one firing minutes later would close a conversation of
    // the dead room and write its chats over the living one's.
    room.gone = true;
    for (const answer of room.waiting.values()) answer(null);
    room.waiting.clear();
    for (const chat of room.chats.values()) clearTimeout(chat.quiet);
    if (acp !== room) return;
    acp = null;
    // The terminals were the agent's; nothing of it is left running when
    // it goes.
    for (const t of terminals.values()) terminalEnd(t, true);
    toWatchers(agentHello(false));
    // Started again for whoever is still watching, so a prompt a moment
    // later has somewhere to go and the conversation comes back with it.
    setTimeout(() => {
      if (!acp && watchers.size) agentStart();
    }, 1000);
  });
  room.started = (async () => {
    try {
      room.init = await agentAsk(room, "initialize", {
        protocolVersion: 1,
        // Claude Code reads and writes this machine's files as itself,
        // not as the tab: we give it no hands through us. The terminal is
        // the one thing the door owns, so a command it runs streams out
        // live under the tool call that ran it.
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: true,
        },
      });
      // The conversations open when the door last ran are opened again,
      // each replayed as the agent's own lines, so what the person said
      // and what it answered are there before they look.
      room.state = "ready";
      for (const id of chatsWere()) await chatOpen(room, id);
      void chatWarm(room);
    } catch (err) {
      room.state = "failed";
      room.why = err?.message ?? "The agent did not start.";
    }
    if (acp === room) toWatchers(agentHello(false));
  })();
  return room;
}

// A conversation opened: a new one, or an earlier one of the agent's own
// brought back. Several stand open at once, each with its own record and
// its own prompt running or not. A record is made before the agent is
// asked, since loading replays the conversation as the agent's own lines
// and they must land in it, and anyone opening it meanwhile waits on the
// same load; one that cannot be opened is forgotten. A new one is the
// warm one when there is one, and the next is warmed behind it.
async function chatOpen(room, id) {
  const had = id ? room.chats.get(id) : undefined;
  if (had) {
    await had.ready;
    return room.chats.get(id) ?? null;
  }
  const chat = {
    id: id ?? null,
    session: null,
    token: null,
    running: false,
    ring: kept.get(id) ?? [],
    replaying: kept.has(id),
    quiet: undefined,
    ready: null,
  };
  kept.delete(id);
  if (id) {
    room.chats.set(id, chat);
    toWatchers({ maslow: { chat: { id, clear: true } } });
    for (const said of chat.ring) toWatchers(said);
  }
  const spare = id ? null : room.spare;
  if (!id) {
    room.spare = null;
    void chatWarm(room);
  }
  const tools = spare ?? handed();
  chat.ready = spare
    ? Promise.resolve(spare)
    : agentAsk(
        room,
        id ? "session/load" : "session/new",
        id
          ? { sessionId: id, cwd: HOME, mcpServers: tools.servers }
          : { cwd: HOME, mcpServers: tools.servers },
      ).catch(() => null);
  const now = await chat.ready;
  chat.replaying = false;
  if (acp !== room || (id && room.chats.get(id) !== chat)) return null;
  if (!now) {
    if (id) {
      room.chats.delete(id);
      toWatchers({ maslow: { chat: { id, gone: true } } });
    }
    return null;
  }
  chat.id = now.sessionId ?? id;
  chat.session = { ...now, id: chat.id };
  chat.token = tools.token;
  room.tokens.set(chat.token, chat.id);
  room.chats.set(chat.id, chat);
  chatsAre(room);
  toWatchers({ maslow: { chat: { ...chatSaid(chat), clear: !id } } });
  void tellContext(chat);
  nap(room, chat);
  return chat;
}

// One conversation kept warm and unshown, so a new one is handed over the
// moment it is asked for: starting Claude Code takes seconds, and the
// person should not wait on it to say a word.
async function chatWarm(room) {
  if (room.spare || room.warming) return;
  room.warming = true;
  try {
    const tools = handed();
    const now = await agentAsk(room, "session/new", {
      cwd: HOME,
      mcpServers: tools.servers,
    });
    if (acp === room) room.spare = { ...now, ...tools };
  } catch {
    // The next new conversation starts cold, and warms the one after.
  } finally {
    room.warming = false;
  }
}

// A conversation closed: its prompt stopped where it is, the agent told
// to let it go, and its Claude Code process with it. Its record stays on
// the disk, so it opens again whole.
async function chatClose(room, id) {
  const chat = room.chats.get(id);
  if (!chat) return;
  clearTimeout(chat.quiet);
  room.chats.delete(id);
  room.tokens.delete(chat.token);
  keep(id, chat.ring);
  chatsAre(room);
  if (chat.running)
    toAgent(room, {
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId: id },
    });
  await agentAsk(room, "_maslow/close", { sessionId: id }).catch(() => {});
  if (!room.chats.has(id)) toWatchers({ maslow: { chat: { id, gone: true } } });
}

function agent(ws) {
  watchers.add(ws);
  // Started for the first socket to arrive and shared by every one after;
  // what this socket is given to catch up on is what it holds now.
  const first = acp ?? agentStart();
  ws.sendText(JSON.stringify(agentHello(true)));
  for (const chat of first.chats.values()) {
    for (const said of chat.ring) ws.sendText(JSON.stringify(said));
    void tellContext(chat);
  }
  // And what the commands in the record wrote, so a tab arriving mid-run
  // sees the output under the tool call rather than an empty terminal.
  for (const t of terminals.values())
    ws.sendText(
      JSON.stringify({
        maslow: { terminal: { id: t.id, ...terminalSaid(t) } },
      }),
    );
  ws.text = (text) => {
    const said = parse(text);
    // Whichever process is running now is the one this word goes to, so a
    // socket held open across a restart talks to the agent that replaced
    // the one it arrived on.
    const room = acp;
    if (!said || !room) return;
    // A word to the door itself rather than to the agent: which
    // conversation this computer is in is the door's to change, since one
    // process holds it for every socket.
    if (said.maslow) {
      const w = said.maslow;
      if (w.fresh === true) return void chatOpen(room, null);
      if (typeof w.open === "string") return void chatOpen(room, w.open);
      if (typeof w.close === "string") return void chatClose(room, w.close);
      if (typeof w.name?.id === "string" && typeof w.name.title === "string") {
        const title = w.name.title.trim().slice(0, 60);
        if (title) entitled(w.name.id, title);
      }
      return;
    }
    if (typeof said.method === "string") {
      // Every socket is answered `initialize` from what the agent said to
      // the door, since the process is initialized once and shared.
      if (said.method === "initialize")
        return void room.started.then(() =>
          ws.sendText(
            JSON.stringify({
              jsonrpc: "2.0",
              id: said.id,
              ...(room.init
                ? { result: room.init }
                : {
                    error: {
                      code: -32603,
                      message: room.why ?? "The agent did not start.",
                    },
                  }),
            }),
          ),
        );
      if (said.id === undefined) {
        const stopped = room.chats.get(said.params?.sessionId);
        if (said.method === "session/cancel" && stopped) {
          stopped.busy = 0;
          chatRunning(room, stopped, false);
        }
        return toAgent(room, said);
      }
      // A prompt for a conversation that is asleep wakes it first.
      const sid = said.params?.sessionId;
      if (
        said.method === "session/prompt" &&
        typeof sid === "string" &&
        !room.chats.get(sid)?.session
      )
        return void chatOpen(room, sid).then((chat) => {
          if (chat && acp === room) ws.text(text);
          else
            ws.sendText(
              JSON.stringify({
                jsonrpc: "2.0",
                id: said.id,
                error: {
                  code: -32603,
                  message: "That conversation could not be opened.",
                },
              }),
            );
        });
      const chat = room.chats.get(sid);
      // Asked under a number of the door's own, so two tabs asking at once
      // never take each other's answer.
      const id = ++room.asked;
      // A prompt while one runs is a word into the running turn: the
      // agent hears it at its next step, and the turn is still the one.
      const steer = said.method === "session/prompt" && (chat?.busy ?? 0) > 0;
      if (said.method === "session/prompt" && chat && !steer) {
        chat.busy = (chat.busy ?? 0) + 1;
        chatRunning(room, chat, true);
      }
      if (said.method === "session/prompt") {
        // What the person said goes into the record in their own words,
        // steer or not.
        const words = (said.params?.prompt ?? [])
          .filter((c) => c?.type === "text")
          .map((c) => c.text)
          .join("");
        if (words)
          fromAgent(room, {
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: said.params?.sessionId,
              update: {
                sessionUpdate: "user_message_chunk",
                content: { type: "text", text: words },
              },
            },
          });
      }
      room.waiting.set(id, (answer) => {
        if (said.method === "session/prompt" && !steer) {
          const now = room.chats.get(sid);
          if (now) {
            now.busy = Math.max(0, (now.busy ?? 1) - 1);
            settle(room, now);
          }
        }
        ws.sendText(
          JSON.stringify({
            jsonrpc: "2.0",
            id: said.id,
            ...(answer?.error
              ? { error: answer.error }
              : {
                  result:
                    said.method === "session/list"
                      ? titled(answer?.result ?? null)
                      : (answer?.result ?? null),
                }),
          }),
        );
      });
      return toAgent(room, { ...said, id });
    }
    // An answer to a question the agent asked, back under the agent's own
    // number; answered, it leaves the record, so the next socket to arrive
    // is not asked it again.
    if (said.id === undefined) return;
    for (const chat of room.chats.values()) {
      const at = chat.ring.findIndex(
        (m) => m.id === said.id && m.method !== undefined,
      );
      if (at < 0) continue;
      chat.ring.splice(at, 1);
      settle(room, chat);
      return toAgent(room, said);
    }
  };
  ws.closed = () => watchers.delete(ws);
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
      // A handler that throws, now or later, takes down its socket's
      // message and nothing else.
      if (kind === 0x1)
        void Promise.try(() => ws.text(whole.toString())).catch(() => {});
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
  if (n < 126) return Buffer.concat([Buffer.from([first, n]), payload]);
  const header = Buffer.alloc(n < 65536 ? 4 : 10);
  header[0] = first;
  header[1] = n < 65536 ? 126 : 127;
  if (n < 65536) header.writeUInt16BE(n, 2);
  else header.writeBigUInt64BE(BigInt(n), 2);
  return Buffer.concat([header, payload]);
}

server.listen(8080, "::", () => console.log("the door is open on 8080"));

// The wakeups kept from before the door last ran, armed now: one whose
// time passed meanwhile fires at once.
for (const [id, w] of Object.entries(wakeupsWere()))
  if (w && typeof w.prompt === "string") wakeupArm(id, w.at, w.prompt);
