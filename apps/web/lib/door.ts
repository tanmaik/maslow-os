import { cloud } from "./cloud.ts";

// One thing in a folder of the person's home: its name, what kind of thing
// it is, its size in bytes, and when it last changed.
export type Entry = {
  name: string;
  kind: "dir" | "file" | "link" | "other";
  size: number;
  modified: string;
  // The id it is shared by, when it is.
  id?: string;
};

// A shared thing as its door finds it: at its path, missing for now, or
// gone for good.
export type SharedStat =
  | {
      name: string;
      kind: "file" | "dir";
      size: number;
      modified: string;
    }
  | { missing: true }
  | { gone: true };

// Thrown when the door says a shared thing is gone from the disk for
// good: deleted, and its share with it.
export class Gone extends Error {}

// One file under a shared thing, by its path there.
export type SharedEntry = { path: string; size: number; modified: string };

// Thrown when a save fell behind: the file changed since it was opened,
// at this time.
export class Changed extends Error {
  modified: string;
  constructor(modified: string) {
    super("the file changed since it was opened");
    this.modified = modified;
  }
}

// What a machine says of itself: CPU percent over the last moment, memory
// used and total, the bytes the person holds, the disk's size, and the
// ports listening inside with what listens.
export type Stats = {
  cpu: number;
  memory: { used: number; total: number };
  // What the machine used the moment it was ready, before anything of the
  // person's came back: the image's own weight. Absent from an older image.
  idleMb?: number;
  used: number | null;
  disk: number | null;
  // Room left on the whole disk; absent from a machine on an older image.
  free?: number | null;
  // The face a thing serving there wears, when it has one: its own
  // favicon, which only the machine can reach to ask for.
  // The number of the public list the door holds; unsaid by an older door.
  publicVersion?: number;
  // `tab` where the page a port serves refuses to be shown in a frame.
  ports: { port: number; name: string; face?: string; tab?: true }[];
  // What is running in their terminal now. Absent from a machine on an
  // older image.
  running?: string[];
};

// A backup coming back into a folder of the home: where it is landing,
// which step it is on, and what went wrong if anything.
export type Restore = {
  key: string;
  name: string;
  startedAt: string;
  finishedAt: string | null;
  step: "fetching" | "unpacking" | "done" | "failed";
  bytes: number | null;
  error: string | null;
};

// What came of a backup: the key it went to, when it started and ended,
// its size, and what went wrong if anything.
export type Backup = {
  key: string;
  startedAt: string;
  finishedAt: string | null;
  bytes: number | null;
  error: string | null;
};

// One request to a machine's door, where the cloud says the door is, with
// the ticket it takes and, where one is given, a limit in milliseconds.
function knock(
  machineId: string,
  path: string,
  ticket: string | null,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit;
    ms?: number;
    redirect?: RequestRedirect;
  } = {},
): Promise<Response> {
  const at = cloud.door(machineId);
  const { ms, headers, ...rest } = init;
  return fetch(`${at.url}/maslow${path}`, {
    ...rest,
    headers: {
      ...at.headers,
      ...(ticket ? { "x-maslow-ticket": ticket } : {}),
      ...headers,
    },
    signal: ms === undefined ? undefined : AbortSignal.timeout(ms),
  });
}

// The door's own words when it refuses, or its status when it says none.
async function refusal(res: Response): Promise<Error> {
  return new Error((await res.text()) || `the door answered ${res.status}`);
}

// A path in the home, as the door takes it in an address.
const path = (at: string) => `path=${encodeURIComponent(at)}`;

// Where one shared thing is under the door, and what to do with it.
const shared = (id: string, what: string) =>
  `/files/shared/${encodeURIComponent(id)}${what}`;

// A picture or a PDF of one file, made on the machine and kept there,
// which can take a while the first time.
async function made(
  machineId: string,
  ticket: string,
  at: string,
  what: "preview" | "pdf",
): Promise<Response> {
  const res = await knock(machineId, `/files/${what}?${path(at)}`, ticket, {
    ms: 150_000,
  });
  if (!res.ok) throw await refusal(res);
  return res;
}

// A file written whole through a door, answering its size and when it now
// says it changed; a save that fell behind is thrown as Changed.
async function written(
  machineId: string,
  to: string,
  ticket: string,
  body: string | Uint8Array,
): Promise<{ size: number; modified: string }> {
  const res = await knock(machineId, to, ticket, {
    method: "PUT",
    body: typeof body === "string" ? body : Buffer.from(body),
    ms: 30_000,
  });
  if (res.status === 409)
    throw new Changed(((await res.json()) as { modified: string }).modified);
  if (!res.ok) throw await refusal(res);
  return (await res.json()) as { size: number; modified: string };
}

// An action on a file or folder through the door, told in JSON, answered
// in JSON: what the action made or moved.
async function acted<T>(
  machineId: string,
  to: string,
  ticket: string,
  body: unknown,
): Promise<T> {
  const res = await knock(machineId, to, ticket, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    ms: 15_000,
  });
  if (!res.ok) throw await refusal(res);
  return (await res.json()) as T;
}

// A question the door answers in JSON within eight seconds.
async function asked<T>(
  machineId: string,
  to: string,
  ticket: string,
): Promise<T> {
  const res = await knock(machineId, to, ticket, { ms: 8_000 });
  if (!res.ok) throw new Error(`the door answered ${res.status}`);
  return (await res.json()) as T;
}

// What a machine's door is asked by this server, whichever cloud the
// machine is on: each call carries a ticket the door takes, but for
// whether it answers at all.
export const door = {
  // A word to a conversation on the machine: what to say, to which
  // conversation, and which ask it answers where it answers one.
  async say(
    machineId: string,
    ticket: string,
    word: { chat: string; text: string; answered?: string },
  ): Promise<void> {
    const res = await knock(machineId, "/say", ticket, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(word),
      ms: 8_000,
    });
    if (!res.ok) throw new Error(`the door answered ${res.status}`);
  },

  // The machine's numbers.
  stats(machineId: string, ticket: string): Promise<Stats> {
    return asked(machineId, "/stats", ticket);
  },

  // What came of the machine's last backup: null before any.
  lastBackup(machineId: string, ticket: string): Promise<Backup | null> {
    return asked(machineId, "/backup", ticket);
  },

  // Asks the machine's door to archive the home and upload it to an
  // address signed for it. False when one is already running.
  async askBackup(
    machineId: string,
    ticket: string,
    ask: { url: string; key: string },
  ): Promise<boolean> {
    const res = await knock(machineId, "/backup", ticket, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ask),
      ms: 8_000,
    });
    if (res.status === 409) return false;
    if (!res.ok) throw new Error(`the door answered ${res.status}`);
    return true;
  },

  // What came of the machine's last restore: null before any.
  lastRestore(machineId: string, ticket: string): Promise<Restore | null> {
    return asked(machineId, "/restore", ticket);
  },

  // Asks the machine's door to fetch a backup from an address signed for
  // it and unpack it into a folder of its own in the home. The folder's
  // name, or null when a restore is already running.
  async askRestore(
    machineId: string,
    ticket: string,
    ask: { url: string; key: string; into: string },
  ): Promise<string | null> {
    const res = await knock(machineId, "/restore", ticket, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ask),
      ms: 8_000,
    });
    if (res.status === 409) return null;
    if (!res.ok) throw new Error(`the door answered ${res.status}`);
    return ((await res.json()) as { name: string }).name;
  },

  // Gives the machine's door the keys that open SSH.
  async pushKeys(
    machineId: string,
    ticket: string,
    keys: string,
  ): Promise<void> {
    const res = await knock(machineId, "/keys", ticket, {
      method: "PUT",
      headers: { "content-type": "text/plain" },
      body: keys,
      ms: 8_000,
    });
    if (!res.ok) throw new Error(`the door answered ${res.status}`);
  },

  // Tells the machine's door which of its ports are open to anyone, the
  // whole list each time with the number of the change it came from, so a
  // list that arrives late never overwrites a newer one.
  async publicPorts(
    machineId: string,
    ticket: string,
    list: { version: number; ports: number[] },
  ): Promise<void> {
    const res = await knock(machineId, "/public", ticket, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(list),
      ms: 8_000,
    });
    if (!res.ok) throw new Error(`the door answered ${res.status}`);
  },

  // Asks the machine's door to start the person's Linux over at the next
  // boot.
  async askReset(machineId: string, ticket: string): Promise<void> {
    const res = await knock(machineId, "/reset", ticket, {
      method: "POST",
      ms: 8_000,
    });
    if (!res.ok) throw new Error(`the door answered ${res.status}`);
  },

  // The person's files: what a folder holds, a file's bytes as a stream,
  // whole or the range asked for, a small picture of a file, and a file
  // written whole. Paths are relative to the home; the door refuses one
  // that leaves it. Uploads do not pass through here: the browser sends
  // those to the door itself, in pieces, with a ticket of its own.
  files: {
    async list(
      machineId: string,
      ticket: string,
      at: string,
    ): Promise<Entry[]> {
      const res = await knock(machineId, `/files?${path(at)}`, ticket, {
        ms: 8_000,
      });
      if (!res.ok) throw await refusal(res);
      return (await res.json()) as Entry[];
    },
    async read(
      machineId: string,
      ticket: string,
      at: string,
      range?: string,
    ): Promise<Response> {
      const res = await knock(machineId, `/files/read?${path(at)}`, ticket, {
        headers: range ? { range } : {},
      });
      if (!res.ok && res.status !== 416) throw await refusal(res);
      return res;
    },
    preview(machineId: string, ticket: string, at: string): Promise<Response> {
      return made(machineId, ticket, at, "preview");
    },
    // A file as a whole PDF, every page: a PDF as it is, a document made
    // into one on the machine.
    pdf(machineId: string, ticket: string, at: string): Promise<Response> {
      return made(machineId, ticket, at, "pdf");
    },
    // Written whole, or added to the end. A save that names when the file
    // was last changed as it was opened is refused with Changed if the
    // file changed meanwhile.
    write(
      machineId: string,
      ticket: string,
      at: string,
      body: string | Uint8Array,
      append = false,
      opened?: string,
    ): Promise<{ size: number; modified: string }> {
      return written(
        machineId,
        `/files/write?${path(at)}${append ? "&append=1" : ""}${opened ? `&opened=${encodeURIComponent(opened)}` : ""}`,
        ticket,
        body,
      );
    },
    // A new name, or a new place in the home when the name is a path.
    rename(
      machineId: string,
      ticket: string,
      at: string,
      to: string,
    ): Promise<Entry> {
      return acted(machineId, `/files/rename?${path(at)}`, ticket, { to });
    },
    // Into the Trash of the person's Linux, never erased.
    trash(
      machineId: string,
      ticket: string,
      at: string,
    ): Promise<{ name: string }> {
      return acted(machineId, `/files/delete?${path(at)}`, ticket, {});
    },
    // A folder in a folder, named as asked or as the Finder would.
    mkdir(
      machineId: string,
      ticket: string,
      at: string,
      name?: string,
    ): Promise<Entry> {
      return acted(
        machineId,
        `/files/mkdir?${path(at)}`,
        ticket,
        name ? { name } : {},
      );
    },
  },

  // What the person shared, by id: marked, followed, listed, read,
  // written and copied out. Every path is under the thing shared.
  shared: {
    // Marks a thing at a path with this id, or answers the id it already
    // has.
    async share(
      machineId: string,
      ticket: string,
      at: string,
      id: string,
    ): Promise<{
      id: string;
      name: string;
      kind: "file" | "dir";
      // Whether the path was shared already, under the id answered.
      had: boolean;
    }> {
      const res = await knock(machineId, `/files/shared?${path(at)}`, ticket, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
        ms: 30_000,
      });
      if (!res.ok) throw await refusal(res);
      return (await res.json()) as {
        id: string;
        name: string;
        kind: "file" | "dir";
        had: boolean;
      };
    },
    async forget(machineId: string, ticket: string, id: string) {
      const res = await knock(machineId, shared(id, ""), ticket, {
        method: "DELETE",
        ms: 8_000,
      });
      if (!res.ok) throw await refusal(res);
    },
    async stat(
      machineId: string,
      ticket: string,
      id: string,
      at = "",
    ): Promise<SharedStat | null> {
      const res = await knock(
        machineId,
        `${shared(id, "")}?${path(at)}`,
        ticket,
        {
          ms: 30_000,
        },
      );
      // Only the door's own "nothing by that id" is nothing; any other
      // 404 is the road to the machine, and says nothing of the share.
      const text = res.ok ? null : await res.text();
      if (res.status === 404 && text?.startsWith("Nothing is shared"))
        return null;
      if (!res.ok) throw new Error(text || `the door answered ${res.status}`);
      return (await res.json()) as SharedStat;
    },
    // Every file under the thing, for the copy of it; `more` when a
    // folder was too big to walk whole.
    async files(
      machineId: string,
      ticket: string,
      id: string,
    ): Promise<
      | { files: SharedEntry[]; more: boolean }
      | { missing: true }
      | { gone: true }
    > {
      const res = await knock(machineId, shared(id, "/files"), ticket, {
        ms: 60_000,
      });
      if (!res.ok) throw await refusal(res);
      return (await res.json()) as { files: SharedEntry[]; more: boolean };
    },
    async list(
      machineId: string,
      ticket: string,
      id: string,
      at: string,
    ): Promise<Entry[]> {
      const res = await knock(
        machineId,
        `${shared(id, "/list")}?${path(at)}`,
        ticket,
        { ms: 30_000 },
      );
      if (res.status === 410) throw new Gone(await res.text());
      if (!res.ok) throw await refusal(res);
      return (await res.json()) as Entry[];
    },
    async read(
      machineId: string,
      ticket: string,
      id: string,
      at: string,
      range?: string,
    ): Promise<Response> {
      const res = await knock(
        machineId,
        `${shared(id, "/read")}?${path(at)}`,
        ticket,
        { headers: range ? { range } : {} },
      );
      if (res.status === 410) throw new Gone(await res.text());
      if (!res.ok && res.status !== 416) throw await refusal(res);
      return res;
    },
    async pdf(
      machineId: string,
      ticket: string,
      id: string,
      at: string,
    ): Promise<Response> {
      const res = await knock(
        machineId,
        `${shared(id, "/pdf")}?${path(at)}`,
        ticket,
        { ms: 150_000 },
      );
      if (!res.ok) throw await refusal(res);
      return res;
    },
    write(
      machineId: string,
      ticket: string,
      id: string,
      at: string,
      body: string | Uint8Array,
      opened?: string,
    ): Promise<{ size: number; modified: string }> {
      return written(
        machineId,
        `${shared(id, "/write")}?${path(at)}${opened ? `&opened=${encodeURIComponent(opened)}` : ""}`,
        ticket,
        body,
      );
    },
    // A colleague's save fetched onto the disk from an address signed for
    // it; answers when the file now says it changed.
    async take(
      machineId: string,
      ticket: string,
      id: string,
      at: string,
      url: string,
      modified: string,
    ): Promise<{ size: number; modified: string }> {
      const res = await knock(
        machineId,
        `${shared(id, "/take")}?${path(at)}`,
        ticket,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url, modified }),
          ms: 150_000,
        },
      );
      if (res.status === 409)
        throw new Changed(
          ((await res.json()) as { modified: string }).modified,
        );
      if (!res.ok) throw await refusal(res);
      return (await res.json()) as { size: number; modified: string };
    },
    // Files of the thing sent to addresses signed for each; answers which
    // landed.
    async mirror(
      machineId: string,
      ticket: string,
      id: string,
      puts: { path: string; url: string }[],
    ): Promise<{ done: string[]; failed: { path: string; error: string }[] }> {
      const res = await knock(machineId, shared(id, "/mirror"), ticket, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ puts }),
        ms: 150_000,
      });
      if (!res.ok) throw await refusal(res);
      return (await res.json()) as {
        done: string[];
        failed: { path: string; error: string }[];
      };
    },
  },

  // Whether the machine's door answers, with the browser server up behind
  // it: what a ready computer is. Given fewer milliseconds by a page that
  // cannot keep a person waiting on a door that may be dead.
  async answers(machineId: string, ms = 8_000): Promise<boolean> {
    try {
      const res = await knock(machineId, "/health", null, {
        ms,
        redirect: "manual",
      });
      return res.status === 200;
    } catch {
      return false;
    }
  },

  // The round trip from this server to the machine's door and back, in
  // milliseconds: what every page that asks the computer something pays.
  async ping(machineId: string): Promise<number> {
    const t = performance.now();
    const res = await knock(machineId, "/health", null, {
      ms: 8_000,
      redirect: "manual",
    });
    if (res.status !== 200) throw new Error(`the door answered ${res.status}`);
    return Math.round(performance.now() - t);
  },
};
