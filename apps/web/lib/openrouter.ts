import { deployment } from "./deployment.ts";

// OpenRouter's keys, the part of its API a computer needs: a key minted
// per person with a cap, its spend read back, and the key deleted with the
// machine. No SDK.
export type MintedKey = { key: string; hash: string };

// What a key has spent, in dollars, and the ceiling it spends against.
export type Spend = {
  usage: number;
  limit: number | null;
  // How often the ceiling resets: "weekly", "monthly", or null for none.
  every: string | null;
};

// A day's spend on one model, through one key.
export type Called = { day: string; model: string; usd: number };

function config() {
  const m = deployment.models;
  if (m.kind !== "openrouter") throw new Error("Model keys are off here.");
  return m;
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`https://openrouter.ai/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config().provisioningKey}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `OpenRouter ${method} ${path} answered ${res.status}: ${text.slice(0, 300)}`,
    );
  return (text ? JSON.parse(text) : null) as T;
}

export const openrouter = {
  // A key named for the environment and the person, with a ceiling in
  // dollars that never resets on its own: the app moves it as the person's
  // weeks turn. The key itself is answered once, here; after that only its
  // hash.
  async mint(name: string, capUsd: number): Promise<MintedKey> {
    const r = await call<{ key: string; data: { hash: string } }>(
      "POST",
      "/keys",
      { name, limit: capUsd, limit_reset: null },
    );
    return { key: r.key, hash: r.data.hash };
  },

  // What the key has spent, in dollars, since it was made, with the
  // ceiling it carries.
  async spent(hash: string): Promise<Spend> {
    const r = await call<{
      data: {
        usage: number;
        limit: number | null;
        limit_reset: string | null;
      };
    }>("GET", `/keys/${hash}`);
    return {
      usage: r.data.usage,
      limit: r.data.limit,
      every: r.data.limit_reset,
    };
  },

  // The key's ceiling, in dollars of everything it ever spent, set again.
  async cap(hash: string, limitUsd: number): Promise<void> {
    await call("PATCH", `/keys/${hash}`, {
      limit: limitUsd,
      limit_reset: null,
    });
  },

  // What one key spent on each model on each day: OpenRouter's own
  // activity, for the key asked for, over the last thirty days. It runs a
  // day behind, so today's calls appear tomorrow.
  async activity(hash: string): Promise<Called[]> {
    const r = await call<{
      data: { date: string; model: string; usage: number }[];
    }>("GET", `/activity?api_key_hash=${hash}`);
    return r.data.map((a) => ({
      day: a.date.slice(0, 10),
      model: a.model,
      usd: a.usage,
    }));
  },

  // Every key of the account, by name and hash: the vendor's own list,
  // which the sweep reads to find keys whose computer is gone.
  async list(): Promise<{ name: string; hash: string; createdAt: Date }[]> {
    // A page at a time, from the top, until a page comes back short.
    const keys: { name: string; hash: string; createdAt: Date }[] = [];
    for (let offset = 0; ; offset += 100) {
      const r = await call<{
        data: { name: string; hash: string; created_at: string }[];
      }>("GET", `/keys?include_disabled=false&offset=${offset}`);
      for (const k of r.data)
        keys.push({
          name: k.name,
          hash: k.hash,
          createdAt: new Date(k.created_at),
        });
      if (r.data.length < 100) return keys;
    }
  },

  // Gone for good; one already gone is fine.
  async remove(hash: string): Promise<void> {
    await call("DELETE", `/keys/${hash}`).catch((err: Error) => {
      if (!/ answered 404:/.test(err.message)) throw err;
    });
  },
};
