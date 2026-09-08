// The door to a computer: the one thing on the machine the internet can
// reach. It opens for a ticket signed with the computer's secret, which
// only our sign-in can mint, and then passes everything, VS Code's page
// and its live connection alike, to VS Code inside. Every machine shares
// the app's address, so a request for another machine's name is passed
// to that machine's door over Fly's private network, whatever its size.
import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";
import net from "node:net";

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
  if (to.mine) {
    const ticket = url.searchParams.get("ticket");
    if (ticket) {
      if (!valid(ticket)) return say(res, 403, "That ticket is not good here.");
      res.writeHead(303, {
        location: "/",
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

server.listen(8080, "::", () => console.log("the door is open on 8080"));
