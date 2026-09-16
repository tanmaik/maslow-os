import { deployment } from "./deployment.ts";

// The Composio API, the part of it a connection needs. No SDK.

// An app Composio can connect, as its catalog lists it.
export type App = {
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
};

// An account at Composio: which app it is in, the name the person gave it,
// its standing there, and when it was made.
export type Account = {
  id: string;
  app: string;
  name: string | null;
  status: string;
  createdAt: Date;
};

function config() {
  const c = deployment.connections;
  if (c.kind !== "composio") throw new Error("Composio is not set up here.");
  return c;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  gone?: "null",
): Promise<T> {
  const c = config();
  const res = await fetch(`${c.api}/api/v3.1${path}`, {
    method,
    headers: { "x-api-key": c.apiKey, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404 && gone) return null as T;
  if (!res.ok)
    throw new Error(
      `Composio ${method} ${path} answered ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
  return (await res.json()) as T;
}

type Page<T> = { items: T[]; next_cursor?: string | null };
type Toolkit = {
  slug: string;
  name: string;
  no_auth?: boolean;
  composio_managed_auth_schemes?: string[];
  meta?: { description?: string; logo?: string };
};
type ConnectedAccount = {
  id: string;
  alias: string | null;
  status: string;
  toolkit: { slug: string };
  created_at: string;
};

// Composio's auth config for an app, made once and kept for the process.
const authConfigs = new Map<string, Promise<string>>();
function authConfig(slug: string): Promise<string> {
  let found = authConfigs.get(slug);
  if (!found) {
    found = (async () => {
      const listed = await call<Page<{ id: string }>>(
        "GET",
        `/auth_configs?toolkit_slug=${encodeURIComponent(slug)}&is_composio_managed=true&limit=1`,
      );
      if (listed.items[0]) return listed.items[0].id;
      const made = await call<{ auth_config: { id: string } }>(
        "POST",
        "/auth_configs",
        { toolkit: { slug } },
      );
      return made.auth_config.id;
    })();
    found.catch(() => authConfigs.delete(slug));
    authConfigs.set(slug, found);
  }
  return found;
}

const toApp = (t: Toolkit): App => ({
  slug: t.slug,
  name: t.name,
  description: t.meta?.description ?? null,
  logo: t.meta?.logo ?? null,
});
const toAccount = (a: ConnectedAccount): Account => ({
  id: a.id,
  app: a.toolkit.slug,
  name: a.alias || null,
  status: a.status,
  createdAt: new Date(a.created_at),
});

export const composio = {
  // The apps whose sign-in Composio runs for us, that match a search, most
  // used first; the most used of all when the search is empty.
  async search(query: string, limit = 12): Promise<App[]> {
    const page = await call<Page<Toolkit>>(
      "GET",
      `/toolkits?managed_by=composio&sort_by=usage&limit=${limit}&search=${encodeURIComponent(query)}`,
    );
    return page.items
      .filter((t) => !t.no_auth && t.composio_managed_auth_schemes?.length)
      .map(toApp);
  },

  async app(slug: string): Promise<App | null> {
    const t = await call<Toolkit | null>(
      "GET",
      `/toolkits/${encodeURIComponent(slug)}`,
      undefined,
      "null",
    );
    return t && toApp(t);
  },

  // A page at Composio where userId signs in to the app. Afterwards the
  // browser comes to the project's verifier with a session to redeem, or,
  // on a project without one, to callbackUrl with the account's id.
  async link(
    userId: string,
    slug: string,
    callbackUrl: string,
  ): Promise<string> {
    const made = await call<{ redirect_url: string }>(
      "POST",
      "/connected_accounts/link",
      {
        auth_config_id: await authConfig(slug),
        user_id: userId,
        callback_url: callbackUrl,
      },
    );
    return made.redirect_url;
  },

  // Every account of one user, every page.
  async accountsOf(userId: string): Promise<Account[]> {
    const out: Account[] = [];
    let cursor: string | null | undefined;
    do {
      const page = await call<Page<ConnectedAccount>>(
        "GET",
        `/connected_accounts?user_ids=${encodeURIComponent(userId)}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      out.push(...page.items.map(toAccount));
      cursor = page.next_cursor;
    } while (cursor);
    return out;
  },

  // Completes a sign-in Composio is holding until we vouch for who did it:
  // the account's id when the sign-in was this user's, null when it was
  // not, or when Composio no longer holds it.
  async complete(sessionUri: string, userId: string): Promise<string | null> {
    const c = config();
    const res = await fetch(
      `${c.api}/api/v3.1/connected_accounts/complete_auth`,
      {
        method: "POST",
        headers: { "x-api-key": c.apiKey, "content-type": "application/json" },
        body: JSON.stringify({ session_uri: sessionUri, user_id: userId }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok)
      throw new Error(
        `Composio POST /connected_accounts/complete_auth answered ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    const done = (await res.json()) as { connected_account_id: string };
    return done.connected_account_id;
  },

  // Names an account, or clears its name with an empty string. False when
  // another of the user's accounts in the app already has that name.
  async rename(id: string, name: string): Promise<boolean> {
    const c = config();
    const res = await fetch(
      `${c.api}/api/v3.1/connected_accounts/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "x-api-key": c.apiKey, "content-type": "application/json" },
        body: JSON.stringify({ alias: name }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (res.status === 400 || res.status === 409) return false;
    if (!res.ok)
      throw new Error(
        `Composio PATCH /connected_accounts/${id} answered ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    return true;
  },

  // Deletes the account and revokes what the app granted it. An account
  // already gone is gone.
  async remove(id: string): Promise<void> {
    await call<unknown>(
      "DELETE",
      `/connected_accounts/${encodeURIComponent(id)}?revoke_on_delete=true`,
      undefined,
      "null",
    );
  },

  // The tools that fit a task, asked of Composio's own search, which answers
  // with a plan, its pitfalls and the tools it names; each tool's inputs
  // are read from its schema.
  async findTools(
    userId: string,
    task: string,
    toolkits: string[],
  ): Promise<Found> {
    const answer = await call<{ data: Search }>(
      "POST",
      "/tools/execute/COMPOSIO_SEARCH_TOOLS",
      {
        user_id: userId,
        arguments: {
          queries: [{ use_case: task, toolkits }],
          session: { generate_id: true },
        },
      },
    );
    const result = answer.data?.results?.[0];
    const slugs = [
      ...(result?.primary_tool_slugs ?? []),
      ...(result?.related_tool_slugs ?? []),
    ].slice(0, 8);
    const actions = await Promise.all(
      slugs.map(async (slug) => {
        const t = await call<Tool | null>(
          "GET",
          `/tools/${encodeURIComponent(slug)}`,
          undefined,
          "null",
        );
        return t && toAction(t);
      }),
    );
    return {
      plan: result?.recommended_plan_steps ?? [],
      pitfalls: result?.known_pitfalls ?? [],
      actions: actions.filter((a): a is Action => a !== null),
    };
  },

  // Runs one tool as a user, in one of their accounts. An app the user has
  // not connected is a Refused; anything else the tool says is handed back
  // as it said it.
  async execute(
    userId: string,
    accountId: string,
    slug: string,
    args: Record<string, unknown>,
  ): Promise<Ran> {
    const c = config();
    const res = await fetch(
      `${c.api}/api/v3.1/tools/execute/${encodeURIComponent(slug)}`,
      {
        method: "POST",
        headers: { "x-api-key": c.apiKey, "content-type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          connected_account_id: accountId,
          arguments: args,
        }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    const app = slug.split("_")[0]!.toLowerCase();
    if (res.status === 404) {
      const why = (await res.json().catch(() => null)) as {
        error?: { code?: number; message?: string };
      } | null;
      if (why?.error?.code === 1810)
        throw new Refused(`connect ${app} in settings first`);
      return { ok: false, data: null, error: `no action ${slug}`, app };
    }
    if (!res.ok)
      throw new Error(
        `Composio POST /tools/execute/${slug} answered ${res.status}: ${(await res.text()).slice(0, 300)}`,
      );
    const ran = (await res.json()) as {
      data: unknown;
      error: string | null;
      successful: boolean;
    };
    return { ok: ran.successful, data: ran.data, error: ran.error, app };
  },
};

// Thrown when a run cannot happen for a reason the agent can act on: an
// app the person has not connected, or the hour's runs used up.
export class Refused extends Error {}

type Input = {
  name: string;
  type: string;
  required: boolean;
  description: string;
};

// One thing a tool can do, and what it takes.
export type Action = {
  slug: string;
  app: string;
  description: string;
  inputs: Input[];
};

export type Found = { plan: string[]; pitfalls: string[]; actions: Action[] };

export type Ran = {
  ok: boolean;
  data: unknown;
  error: string | null;
  app: string;
};

type Search = {
  results?: {
    primary_tool_slugs?: string[];
    related_tool_slugs?: string[];
    recommended_plan_steps?: string[];
    known_pitfalls?: string[];
  }[];
};
type Tool = {
  slug: string;
  description?: string;
  toolkit?: { slug: string };
  input_parameters?: {
    properties?: Record<
      string,
      { type?: string; enum?: string[]; description?: string }
    >;
    required?: string[];
  };
};

// The first sentence of a description, cut short.
const gist = (s: string | undefined, most = 90) => {
  const first = (s ?? "").replace(/\s+/g, " ").split(/(?<=\.)\s/)[0] ?? "";
  return first.length > most ? `${first.slice(0, most - 1)}…` : first;
};

const MOST_INPUTS = 16;

// A tool as an action: its inputs from its schema, required first,
// Composio's own user_id left out, and no more than a screenful.
function toAction(t: Tool): Action {
  const required = new Set(t.input_parameters?.required ?? []);
  return {
    slug: t.slug,
    app: t.toolkit?.slug ?? t.slug.split("_")[0]!.toLowerCase(),
    description: gist(t.description, 140),
    inputs: Object.entries(t.input_parameters?.properties ?? {})
      .filter(([name]) => name !== "user_id")
      .map(([name, p]) => ({
        name,
        type: p.enum ? p.enum.join("|") : (p.type ?? "any"),
        required: required.has(name),
        description: gist(p.description),
      }))
      .sort((a, b) => Number(b.required) - Number(a.required))
      .slice(0, MOST_INPUTS),
  };
}
