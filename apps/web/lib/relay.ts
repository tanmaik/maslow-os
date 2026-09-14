import { deployment } from "./deployment.ts";
import { fly, type Machine } from "./fly.ts";

// The relay's image, built by hand from the repo's root and pinned here,
// as the computer's is:
//   fly deploy --build-only --push --remote-only --image-label sync-N \
//     --config packages/sync/fly.toml --dockerfile packages/sync/Dockerfile .
const IMAGE = "registry.fly.io/maslow-computers-dev:sync-1";

// Where the relay's machine runs: next to the database's region, which
// is where the app runs too.
const REGION = "ord";

// The relay is the deployment's, not a person's: one machine in the
// environment's Fly app, tagged for what it is and where. Outside
// production it carries a lease like a computer, renewed by every sweep
// of every preview that runs, so it lives while previews live and the
// reap takes it once none has wanted it for a day.
function tags(): Record<string, string> {
  const d = deployment.computers;
  return {
    env: deployment.where,
    role: "sync",
    ...(d.kind === "fly" && d.checkout
      ? { checkout: "previews", lease: new Date().toISOString() }
      : {}),
  };
}

// Whether this deployment keeps a relay on Fly at all: a laptop runs its
// own beside the app, and a deployment with no secret has nothing to give
// one.
function kept(): { secret: string } | null {
  if (deployment.where === "local" || deployment.computers.kind !== "fly")
    return null;
  const s = deployment.sync;
  return s.kind === "relay" && !s.url ? { secret: s.secret } : null;
}

const ours = (m: Machine) =>
  m.config?.metadata?.role === "sync" &&
  m.config?.metadata?.env === deployment.where &&
  m.state !== "destroyed";

// The relay's machine here, or null.
async function machine(): Promise<Machine | null> {
  return (await fly.machines()).find(ours) ?? null;
}

// The relay's address for a browser, asked of Fly at most once a minute:
// the machine's own name under the deployment's domain, as a computer's.
// An address given outright, as the dev stack gives one, wins. Null while
// there is none, which the page shows as not live.
let known: { url: string | null; at: number } | null = null;
export async function relayUrl(): Promise<string | null> {
  const s = deployment.sync;
  if (s.kind === "none") return null;
  if (s.url) return s.url;
  if (!kept() || deployment.computers.kind !== "fly") return null;
  if (known && Date.now() - known.at < 60_000) return known.url;
  const m = await machine().catch(() => null);
  const url =
    m && m.state === "started"
      ? `wss://${m.id}.${deployment.computers.domain}`
      : null;
  known = { url, at: Date.now() };
  return url;
}

// The sweep's pass: the relay's machine exists, is on the current image,
// runs, and, outside production, is wanted for another hour.
export async function reconcile(): Promise<void> {
  const k = kept();
  if (!k) return;
  const want: Parameters<typeof fly.reshapeRelay>[1] = {
    image: IMAGE,
    secret: k.secret,
    metadata: tags(),
  };
  let m = await machine();
  if (!m) {
    m = await fly.createRelay({ ...want, name: "sync", region: REGION });
    known = null;
    return;
  }
  // A newer image, or a secret that turned: the machine is remade.
  if (
    m.config?.image?.split("@")[0] !== IMAGE ||
    m.config?.env?.SYNC_SECRET !== k.secret
  ) {
    await fly.reshapeRelay(m.id, want);
    known = null;
  } else if (m.config?.metadata?.lease) {
    await fly.tag(m.id, "lease", new Date().toISOString());
  }
  if (m.state !== "started") {
    await fly.start(m.id);
    known = null;
  }
}
