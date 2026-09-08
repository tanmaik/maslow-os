// The Fly Machines API as the scripts need it: the dev app's machines,
// their leases, and stopping and destroying what lapsed. Plain fetch, the
// token from the environment.
import { ids } from "./ids.mjs";

// The token and the app come from the environment given, the process's
// own unless the caller decrypted the dev secrets itself.
async function call(method, path, body, env = process.env) {
  const token = env.FLY_API_TOKEN;
  if (!token) throw new Error("FLY_API_TOKEN is not set");
  const app = env.FLY_COMPUTERS_APP || ids.FLY_COMPUTERS_DEV_APP;
  const res = await fetch(`https://api.machines.dev/v1/apps/${app}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (res.status === 404 && method === "DELETE") return null;
  const text = await res.text();
  if (!res.ok)
    throw new Error(
      `Fly ${method} ${path} answered ${res.status}: ${text.slice(0, 300)}`,
    );
  // A tag or a stop answers with nothing.
  return text ? JSON.parse(text) : null;
}

export const machines = (env) => call("GET", "/machines", undefined, env);

// Marks every machine of a checkout as wanted now.
export async function renewLeases(checkout, env = process.env) {
  let n = 0;
  for (const m of await machines(env)) {
    if (m.config?.metadata?.checkout !== checkout) continue;
    await call(
      "POST",
      `/machines/${m.id}/metadata/lease`,
      { value: new Date().toISOString() },
      env,
    );
    n++;
  }
  return n;
}

// When a machine was last wanted: its lease, or, for one made by hand
// with none, its birth.
export const wantedAt = (m) =>
  new Date(m.config?.metadata?.lease ?? m.created_at);

export async function stop(id) {
  await call("POST", `/machines/${id}/stop`);
}

// The machine, then its disk, which Fly lets go of a moment later.
export async function destroy(m) {
  await call("DELETE", `/machines/${m.id}?force=true`);
  for (let i = 0; i < 60; i++) {
    const live = await call("GET", `/machines/${m.id}`).catch(() => null);
    if (!live || live.state === "destroyed") break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  for (const mount of m.config?.mounts ?? []) {
    for (let i = 0; i < 5; i++) {
      try {
        await call("DELETE", `/volumes/${mount.volume}`);
        break;
      } catch (err) {
        if (i === 4) throw err;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
}
