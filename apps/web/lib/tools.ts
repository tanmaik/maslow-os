import type { Query } from "@placeholder/db";
import type { Principal } from "@placeholder/db/auth";
import { allow } from "@placeholder/db/throttle";
import { spend } from "@placeholder/db/usage";

import {
  composio,
  Refused,
  type Action,
  type Found,
  type Ran,
} from "./composio.ts";
import { connections } from "./connections.ts";
import { deployment } from "./deployment.ts";
import { PRICES } from "./prices.ts";

// A person's apps as things an agent can do: which actions fit a task, and
// running one. Composio finds and runs them as the membership; the pretend
// vendor has a few pretend actions. Nothing here is a tool per action: an
// agent asks for what fits, gets a handful, and runs one by name.

export { Refused, type Action };

const PRETEND: Action[] = [
  {
    slug: "PIGEON_SEND",
    app: "pigeon",
    description: "Sends a message by pigeon.",
    inputs: [
      { name: "to", type: "string", required: true, description: "Who." },
      { name: "body", type: "string", required: true, description: "What." },
    ],
  },
  {
    slug: "PIGEON_LIST",
    app: "pigeon",
    description: "Lists the messages that have arrived.",
    inputs: [],
  },
  {
    slug: "SUNDIAL_TODAY",
    app: "sundial",
    description: "Today's events.",
    inputs: [],
  },
  {
    slug: "ABACUS_ADD",
    app: "abacus",
    description: "Adds two numbers.",
    inputs: [
      { name: "a", type: "number", required: true, description: "One." },
      { name: "b", type: "number", required: true, description: "The other." },
    ],
  },
];

// The apps the membership has connected, by slug.
async function connectedApps(p: Principal): Promise<Set<string>> {
  return new Set(
    (await connections.list(p))
      .filter((c) => c.status === "ACTIVE")
      .map((c) => c.app),
  );
}

// The app an action belongs to, as its slug names it.
const appOf = (slug: string) => slug.split("_")[0]!.toLowerCase();

// How many actions one membership may run an hour through an agent.
const RUNS_AN_HOUR = 60;

// One call to the vendor, on the meter at its list price, in the name of
// what it was for, in the transaction of the membership that made it.
const charge = (q: Query, p: Principal, cause: string) =>
  spend(q, p.userId, "actions", "run", 1, PRICES.actions, cause);

export const tools = {
  // The actions that fit a task in the person's connected apps, narrowed
  // to the apps named, with the plan and pitfalls the vendor knows.
  async find(
    q: Query,
    p: Principal,
    task: string,
    apps?: string[],
  ): Promise<Found> {
    const connected = await connectedApps(p);
    const missing = (apps ?? []).filter((a) => !connected.has(a));
    if (missing.length)
      throw new Refused(`connect ${missing.join(", ")} in settings first`);
    const within = apps ?? [...connected];
    if (within.length === 0) return { plan: [], pitfalls: [], actions: [] };
    await charge(q, p, "find");
    if (deployment.connections.kind === "composio") {
      return composio.findTools(p.userId, task, within);
    }
    const words = task.toLowerCase().match(/[a-z0-9]+/g) ?? [];
    const actions = PRETEND.filter(
      (a) =>
        within.includes(a.app) &&
        words.some((w) =>
          `${a.slug} ${a.description}`.toLowerCase().includes(w),
        ),
    );
    return { plan: [], pitfalls: [], actions };
  },

  // Runs one action as the membership, in an app they have connected, at
  // most so many an hour. The vendor's answer, refusal included, is handed
  // back as it came, and every call to it is charged.
  async run(
    q: Query,
    p: Principal,
    slug: string,
    args: Record<string, unknown>,
  ): Promise<Ran> {
    const app = appOf(slug);
    if (!(await connectedApps(p)).has(app)) {
      throw new Refused(`connect ${app} in settings first`);
    }
    const action = PRETEND.find((a) => a.slug === slug);
    if (deployment.connections.kind !== "composio") {
      if (!action) {
        return { ok: false, data: null, error: `no action ${slug}`, app };
      }
      const missing = action.inputs
        .filter((i) => i.required && args[i.name] === undefined)
        .map((i) => i.name);
      if (missing.length) {
        return {
          ok: false,
          data: null,
          error: `missing ${missing.join(", ")}`,
          app,
        };
      }
    }
    if (!(await allow(`tools:${p.userId}`, RUNS_AN_HOUR, 3600))) {
      throw new Refused(
        `${RUNS_AN_HOUR} actions this hour already; wait before the next`,
      );
    }
    await charge(q, p, slug);
    if (deployment.connections.kind === "composio") {
      return composio.execute(p.userId, slug, args);
    }
    const data =
      slug === "PIGEON_SEND"
        ? { id: "pgn_1", sent: true, to: args.to }
        : slug === "PIGEON_LIST"
          ? [{ id: "pgn_0", from: "Road Runner", body: "Meep." }]
          : slug === "SUNDIAL_TODAY"
            ? [{ id: "sun_1", title: "Noon", at: "12:00" }]
            : { sum: Number(args.a) + Number(args.b) };
    return { ok: true, data, error: null, app: action!.app };
  },
};
