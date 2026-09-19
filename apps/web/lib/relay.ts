import { deployment } from "./deployment.ts";
import { cloud } from "./cloud.ts";
import type { Machine, RelayShape } from "./clouds.ts";

// The relay's image, by its label: built by hand from the repo's root and
// pushed to where the cloud keeps images, as the computer's is.
const IMAGE = "sync-1";

// The relay is the deployment's, not a person's: one machine in the
// environment's cloud, tagged for what it is and where. Outside
// production it carries a lease like a computer, renewed by every sweep
// of every preview that runs, so it lives while previews live and the
// reap takes it once none has wanted it for a day.
function tags(): Record<string, string> {
  const d = deployment.computers;
  return {
    env: deployment.where,
    role: "sync",
    ...(d.kind !== "none" && d.checkout
      ? { checkout: "previews", lease: new Date().toISOString() }
      : {}),
  };
}

// Whether this deployment keeps a relay on its cloud at all: a laptop runs its
// own beside the app, and a deployment with no secret has nothing to give
// one.
function kept(): { secret: string } | null {
  if (deployment.where === "local" || deployment.computers.kind === "none")
    return null;
  const s = deployment.sync;
  return s.kind === "relay" && !s.url ? { secret: s.secret } : null;
}

const ours = (m: Machine) =>
  m.tags.role === "sync" &&
  m.tags.env === deployment.where &&
  m.state !== "gone";

// The relay's machine here, or null.
async function machine(): Promise<Machine | null> {
  return (await cloud.machines()).find(ours) ?? null;
}

// The relay's address for a browser, asked of the cloud at most once a minute:
// the machine's own name under the deployment's domain, as a computer's.
// An address given outright, as the dev stack gives one, wins. Null while
// there is none, which the page shows as not live.
let known: { url: string | null; at: number } | null = null;
export async function relayUrl(): Promise<string | null> {
  const s = deployment.sync;
  if (s.kind === "none") return null;
  if (s.url) return s.url;
  if (!kept() || deployment.computers.kind === "none") return null;
  if (known && Date.now() - known.at < 60_000) return known.url;
  const m = await machine().catch(() => null);
  const url =
    m && m.state === "running"
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
  const want: RelayShape = {
    image: IMAGE,
    secret: k.secret,
    metadata: tags(),
  };
  let m = await machine();
  if (!m) {
    m = await cloud.createRelay({ ...want, name: "sync" });
    known = null;
    return;
  }
  // A newer image, or a secret that turned: the machine is remade.
  if (m.image !== IMAGE || m.env.SYNC_SECRET !== k.secret) {
    await cloud.reshapeRelay(m.id, want);
    known = null;
  } else if (m.tags.lease) {
    await cloud.tag(m.id, "lease", new Date().toISOString());
  }
  if (m.state !== "running") {
    await cloud.start(m.id);
    known = null;
  }
}
