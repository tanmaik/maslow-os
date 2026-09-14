import { Server, type Connection, type Document } from "@hocuspocus/server";
import { headless } from "@maslow/document/headless";
import http from "node:http";
import net from "node:net";
import * as Y from "yjs";

import { nameOf, verify, type Claims } from "./ticket.ts";

// Whom the app is called in the name of, for which record, at which
// deployment.
type Caller = Pick<Claims, "origin" | "org" | "record" | "user">;

// A record's live document while anyone has it open: the same editor the
// page runs, bound to it, and what the relay knows of the record in the
// brain — the change its text rests on, the markdown it last saved, whose
// typing it holds — and everyone in it. Dead is a document the brain has
// a body of that the editor cannot hold, which nobody may save over.
type Held = {
  editor: ReturnType<typeof headless>;
  at: Pick<Claims, "origin" | "org" | "record">;
  known: number;
  saved: string;
  // What saves sent whose answers never came, in case the app took one:
  // seen again, it is this relay's own, not a rewrite.
  sent: string[];
  author: string | null;
  timer: ReturnType<typeof setTimeout> | null;
  flushing: Promise<boolean>;
  // Messages land one after another, whoever sent them, so the save at a
  // change of hands holds only the hands before it: the turn is held from
  // before a message is handled until after it has been.
  gate: Promise<void>;
  release: (() => void) | null;
  saving: boolean;
  dead: boolean;
  poll: ReturnType<typeof setInterval>;
  recheck: ReturnType<typeof setInterval>;
  // The document itself, which knows everyone in it, and when the app
  // last said each may be.
  document: Document;
  okAt: WeakMap<Connection, number>;
};

// What the app says of a record to the relay.
type Said = { body: string; seen: number; access: "view" | "edit" | null };

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A body with one line ending, no blank lines before it and nothing after
// it, to compare letter for letter: a space at the start of a line is a
// change, in a code block most of all.
const plain = (md: string) =>
  md.replace(/\r\n?/g, "\n").replace(/^\n+/, "").trimEnd();

// The relay: one socket per person per record, on a ticket the app signed.
// It holds no table. It loads a record from the app that issued the ticket,
// saves through the same app in the name of whoever typed, and asks it
// again every so often whether the record moved and whether each person may
// still be in it. Quiet is how long after the last keystroke a save goes;
// a change of hands saves at once, so every save is one person's typing.
export function relay({
  port,
  secret,
  quiet = 1000,
  follow = 2000,
  recheck = 60_000,
}: {
  port: number;
  secret: string;
  quiet?: number;
  follow?: number;
  recheck?: number;
}) {
  const held = new Map<string, Held>();
  // An editor bound to nothing, to ask whether a body can be held.
  const scratch = headless(new Y.Doc());

  const app = (c: Caller, method: "GET" | "POST", body?: unknown) =>
    fetch(`${c.origin}/brain/sync/${c.record}`, {
      method,
      headers: {
        authorization: `Bearer ${secret}`,
        "x-maslow-as": c.user,
        "x-maslow-org": c.org,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // An app that does not answer is a failed call, not a held turn.
      signal: AbortSignal.timeout(8000),
    });

  // What the app says of the record to a person; null when it says no —
  // they are not here, or the record is not theirs to see — and "unsure"
  // when it did not answer at all.
  const ask = async (c: Caller): Promise<Said | null | "unsure"> => {
    try {
      const res = await app(c, "GET");
      if (res.ok) return (await res.json()) as Said;
      return res.status === 401 || res.status === 403 || res.status === 404
        ? null
        : "unsure";
    } catch {
      return "unsure";
    }
  };

  // Everyone in the document: each session, whether or not it shares a
  // socket with another.
  const everyone = (h: Held) => h.document.getConnections();

  // Anyone still in the document, to ask the app in the name of.
  const someone = (h: Held): Claims | null => everyone(h)[0]?.context ?? null;

  // Puts everyone out of a document.
  const clear = (h: Held) => {
    for (const c of everyone(h)) c.close();
  };
  // A document nobody may save over: the brain has a body the editor
  // cannot hold.
  const kill = (h: Held) => {
    h.dead = true;
    clear(h);
  };

  // One try at saving what the document says, in the name of whose typing
  // it holds, resting on the change the relay knows. True when nothing was
  // pending or it landed. A save that fell behind means the record moved
  // elsewhere: the document takes what the brain has.
  const save = async (h: Held): Promise<boolean> => {
    if (h.dead) return true;
    const markdown = h.editor.markdown();
    const as = h.author;
    if (markdown === h.saved || !as) return true;
    h.saving = true;
    try {
      const res = await app({ ...h.at, user: as }, "POST", {
        body: markdown,
        seen: h.known,
      });
      if (res.ok) {
        h.known = ((await res.json()) as { seen: number }).seen;
        h.saved = markdown;
        h.sent = [];
        return true;
      }
      if (res.status === 409) {
        const now = (await res.json()) as Said;
        h.known = now.seen;
        // Behind its own save, whose answer was lost: nothing to take, and
        // what is pending goes next.
        const own = h.sent.find((s) => plain(s) === plain(now.body));
        if (own !== undefined) {
          h.saved = own;
          h.sent = [];
          return false;
        }
        if (plain(now.body) === plain(h.saved)) return false;
        if (h.editor.holds(now.body)) {
          h.editor.set(now.body);
          h.saved = now.body;
          // What is in the document is nobody's typing now.
          h.author = null;
        } else kill(h);
        return true;
      }
      // An answer that is not the app's own: it may have taken it all the
      // same.
      h.sent.push(markdown);
      console.error(`sync: save of ${h.at.record} answered ${res.status}`);
    } catch (err) {
      // No answer: the app may have taken it all the same.
      h.sent.push(markdown);
      console.error(`sync: save of ${h.at.record}: ${String(err)}`);
    } finally {
      h.saving = false;
    }
    return false;
  };

  // Saves go one after another, so a keystroke during one is saved by the
  // next rather than dropped.
  const flush = (h: Held) => (h.flushing = h.flushing.then(() => save(h)));

  // A save after a quiet, and again after a while if the app would not
  // take it, for as long as the document is held.
  const settle = (h: Held, after: number) => {
    if (h.timer) clearTimeout(h.timer);
    h.timer = setTimeout(() => {
      h.timer = null;
      void flush(h).then((landed) => {
        if (!landed && held.get(nameOf(h.at)) === h) settle(h, 5000);
      });
    }, after);
  };

  // What the brain has of the record, when it moved past what the relay
  // knows and nothing of the relay's own is on its way. A body other than
  // the one last saved, to the letter, was rewritten elsewhere, and the
  // document takes it; a title or a field changed elsewhere is not the
  // body's concern.
  const catchUp = async (h: Held) => {
    const c = someone(h);
    if (h.saving || h.dead || !c) return;
    try {
      const now = await ask(c);
      if (now === null) {
        // Not theirs to see any more: out, and the next asks another.
        for (const s of everyone(h)) if (s.context.user === c.user) s.close();
        return;
      }
      if (now === "unsure" || now.seen <= h.known || h.saving) return;
      h.known = now.seen;
      if (plain(now.body) === plain(h.saved)) return;
      const own = h.sent.find((s) => plain(s) === plain(now.body));
      if (own !== undefined) {
        h.saved = own;
        h.sent = [];
        return;
      }
      if (!h.editor.holds(now.body)) return kill(h);
      h.editor.set(now.body);
      h.saved = now.body;
      // What is in the document is nobody's typing now.
      h.author = null;
    } catch {}
  };

  // Whether each person in the document may still be, at the level their
  // ticket opened; one who may not is put out at once, and one the app
  // has not vouched for in a while is put out too.
  const rechecked = async (h: Held) => {
    for (const s of everyone(h)) {
      const claims = s.context;
      const now = await ask(claims);
      const ok =
        now !== null &&
        now !== "unsure" &&
        Boolean(now.access) &&
        (claims.level === "view" || now.access === "edit");
      if (ok) h.okAt.set(s, Date.now());
      const since = Date.now() - (h.okAt.get(s) ?? Date.now());
      if ((now !== "unsure" && !ok) || since > 2 * recheck) s.close();
    }
  };

  const hocuspocus = new Server<Claims>({
    address: "127.0.0.1",
    unloadImmediately: true,
    // A ticket of ours, for this record, held by someone the app still
    // lets in at that level, to a body the editor can hold whole; a body
    // it would change is never made live, and the door says so.
    async onAuthenticate({ token, documentName, connectionConfig }) {
      const c = verify(secret, token);
      if (!c || nameOf(c) !== documentName)
        throw new Error("not a ticket to this record");
      const now = await ask(c);
      if (
        !now ||
        now === "unsure" ||
        !now.access ||
        (c.level === "edit" && now.access !== "edit")
      )
        throw new Error("not let in");
      if (!scratch.holds(now.body))
        throw new Error("a body the editor cannot hold");
      connectionConfig.readOnly = c.level === "view";
      return c;
    },
    // The record's body, if the editor can hold it whole; a body it would
    // change is never made live.
    async onLoadDocument({ document, documentName, context }) {
      const now = await ask(context);
      if (!now || now === "unsure") throw new Error("the app would not say");
      const editor = headless(document);
      if (!editor.holds(now.body)) {
        editor.destroy();
        throw new Error("a body the editor cannot hold");
      }
      editor.set(now.body);
      const h: Held = {
        editor,
        at: {
          origin: context.origin,
          org: context.org,
          record: context.record,
        },
        known: now.seen,
        saved: now.body,
        sent: [],
        author: null,
        timer: null,
        flushing: Promise.resolve(true),
        gate: Promise.resolve(),
        release: null,
        saving: false,
        dead: false,
        poll: setInterval(() => void catchUp(h), follow),
        recheck: setInterval(() => void rechecked(h), recheck),
        document,
        okAt: new WeakMap(),
      };
      held.set(documentName, h);
      return document;
    },
    async connected({ documentName, connection }) {
      held.get(documentName)?.okAt.set(connection, Date.now());
    },
    // Before anything from a different person lands, what the document
    // holds is saved in the name of whose typing it is; every message
    // waits its turn behind that save and holds it until it has landed,
    // so nothing of the first person's slips in under the second's name.
    // A save the app will not take is tried again; if it never lands, the
    // hands cannot change truthfully, and everyone is put out.
    async beforeHandleMessage({ documentName, context }) {
      const h = held.get(documentName);
      if (!h) return;
      const before = h.gate;
      let release = () => {};
      const done = new Promise<void>((r) => (release = r));
      h.gate = before.then(() => done);
      await before;
      if (h.author && h.author !== context.user) {
        let landed = await flush(h);
        for (let tries = 0; !landed && tries < 3; tries++) {
          await wait(1000);
          landed = await flush(h);
        }
        if (!landed) {
          release();
          clear(h);
          throw new Error("the app would not take a save");
        }
      }
      // The turn is held until the message has been handled; one that is
      // never seen through releases itself.
      h.release = release;
      setTimeout(release, 10_000);
    },
    async afterHandleMessage({ documentName }) {
      const h = held.get(documentName);
      h?.release?.();
      if (h) h.release = null;
    },
    async onChange({ documentName, connection, context }) {
      // A change with no connection is the relay's own editor.
      const h = held.get(documentName);
      if (!h || !connection) return;
      h.author = context.user;
      settle(h, quiet);
    },
    // The last person gone, what is pending is saved, tried again for a
    // while if the app will not take it, and said aloud if it never does.
    // Nothing is torn down here: someone may come back meanwhile, and the
    // document stays.
    async beforeUnloadDocument({ documentName }) {
      const h = held.get(documentName);
      if (!h) return;
      if (h.timer) clearTimeout(h.timer);
      let landed = await flush(h);
      for (let tries = 0; !landed && tries < 5; tries++) {
        await wait(2000);
        landed = await flush(h);
      }
      if (!landed)
        console.error(
          `sync: ${h.at.record} could not be saved; lost as ${h.author}:\n${h.editor.markdown()}`,
        );
    },
    // The document gone for good, so is what the relay held of it — once
    // what came in while the last save was out has gone too.
    async afterUnloadDocument({ documentName }) {
      const h = held.get(documentName);
      if (!h) return;
      clearInterval(h.poll);
      clearInterval(h.recheck);
      if (h.timer) clearTimeout(h.timer);
      for (let tries = 0; tries < 3 && !h.dead; tries++) {
        if (plain(h.editor.markdown()) === plain(h.saved)) break;
        if (!(await flush(h))) await wait(2000);
      }
      h.editor.destroy();
      // Someone may have opened the record again meanwhile, and what the
      // relay holds now is theirs.
      if (held.get(documentName) === h) held.delete(documentName);
    },
  });

  // The relay's front, on the port given: the documents' own server sits
  // behind it on loopback, and a request that names another machine under
  // the deployment's domain is carried on to that machine instead, as a
  // computer's door carries one on, since Fly hands a request for any
  // machine of the app to whichever answers.
  let inner = 0;
  const where = (req: http.IncomingMessage) =>
    elsewhere(req) ?? { host: "127.0.0.1", port: inner };
  const server = http.createServer((req, res) => {
    const to = where(req);
    const onward = http.request(
      { ...to, method: req.method, path: req.url, headers: forwarded(req) },
      (answer) => {
        res.writeHead(answer.statusCode ?? 502, answer.headers);
        answer.on("error", () => res.destroy());
        answer.pipe(res);
      },
    );
    onward.on("error", () => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("Not answering.");
    });
    // A request the reader walked away from takes its answer with it.
    res.on("close", () => onward.destroy());
    req.pipe(onward);
  });
  server.on("upgrade", (req, socket, head) => {
    const to = where(req);
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

  return {
    listen: async () => {
      inner = await free();
      await hocuspocus.listen(inner);
      // On every address, the private IPv6 one a computer's door carries
      // a request on to included.
      await new Promise<void>((r) => server.listen(port, "::", () => r()));
    },
    destroy: async () => {
      await hocuspocus.destroy();
      await new Promise<void>((r) => server.close(() => r()));
      scratch.destroy();
    },
  };
}

// Where a request is really for, when it names another machine of this
// Fly app under the deployment's domain: that machine's own address
// inside the app. Null for the relay's own name, or off Fly.
const DOMAIN = process.env.DOMAIN;
const ME = process.env.FLY_MACHINE_ID;
const APP = process.env.FLY_APP_NAME;
function elsewhere(req: http.IncomingMessage) {
  if (!DOMAIN || !ME || !APP) return null;
  const host = (req.headers.host ?? "").replace(/:\d+$/, "");
  if (!host.endsWith(`.${DOMAIN}`)) return null;
  const label = host.slice(0, -DOMAIN.length - 1);
  const named = /^(?:\d{1,5}-)?([0-9a-f]{14})$/.exec(label);
  const machine = named?.[1];
  if (!machine || machine === ME) return null;
  return { host: `${machine}.vm.${APP}.internal`, port: 8080 };
}

// A loopback port nothing holds, for the documents' server.
const free = () =>
  new Promise<number>((r, fail) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => r(port));
    });
    s.on("error", fail);
  });

// The headers carried on, with where the request came from added.
function forwarded(req: http.IncomingMessage) {
  return {
    ...req.headers,
    "x-forwarded-proto": "https",
    "x-forwarded-host": req.headers.host ?? "",
    "x-forwarded-for": req.socket.remoteAddress ?? "",
  };
}
