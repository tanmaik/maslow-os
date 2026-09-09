import { deployment } from "./deployment.ts";

// OpenRouter's keys, the part of its API a computer needs: a key minted
// per person with a cap, its spend read back, and the key deleted with the
// machine. No SDK.
export type MintedKey = { key: string; hash: string };

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
  const res = await fetch(`https://openrouter.ai/api/v1/keys${path}`, {
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
  // A key named for the environment and the person, capped in dollars a
  // month. The key itself is answered once, here; after that only its hash.
  async mint(name: string, capUsd: number): Promise<MintedKey> {
    const r = await call<{ key: string; data: { hash: string } }>("POST", "", {
      name,
      limit: capUsd,
      limit_reset: "monthly",
    });
    return { key: r.key, hash: r.data.hash };
  },

  // What the key has spent, in dollars, since it was made.
  async spent(hash: string): Promise<number> {
    const r = await call<{ data: { usage: number } }>("GET", `/${hash}`);
    return r.data.usage;
  },

  // Every key of the account, by name and hash: the vendor's own list,
  // which the sweep reads to find keys whose computer is gone.
  async list(): Promise<{ name: string; hash: string; createdAt: Date }[]> {
    // A page at a time, from the top, until a page comes back short.
    const keys: { name: string; hash: string; createdAt: Date }[] = [];
    for (let offset = 0; ; offset += 100) {
      const r = await call<{
        data: { name: string; hash: string; created_at: string }[];
      }>("GET", `?include_disabled=false&offset=${offset}`);
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
    await call("DELETE", `/${hash}`).catch((err: Error) => {
      if (!/ answered 404:/.test(err.message)) throw err;
    });
  },
};
