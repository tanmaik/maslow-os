import { deployment } from "./deployment.ts";

// The Composio API, the part of it a connection needs. No SDK.

// An app Composio can connect, as its catalog lists it.
export type App = {
  slug: string;
  name: string;
  description: string | null;
  logo: string | null;
};

// An account at Composio: which app it is in, its standing there, and when
// it was made.
export type Account = {
  id: string;
  app: string;
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
  status: a.status,
  createdAt: new Date(a.created_at),
});

export const composio = {
  // The apps whose sign-in Composio runs for us, that match a search,
  // most used first.
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

  // A page at Composio where userId signs in to the app. The browser comes
  // back to callbackUrl with the account's id and whether it succeeded.
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
};
