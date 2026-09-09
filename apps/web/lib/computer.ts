import { asMeter, asOrg, type Query } from "@placeholder/db";
import type { Principal } from "@placeholder/db/auth";
import {
  allComputers,
  claimComputer,
  clearMachine,
  clearModelKey,
  computerOf,
  holdComputer,
  membersWithoutComputers,
  note,
  openComputerSession,
  setBackedUp,
  setDisk,
  setMachine,
  setModelKey,
  setModelSpent,
  setReady,
  setSize,
  setVolume,
  type Computer,
} from "@placeholder/db/computers";

import { createHmac } from "node:crypto";

import { deployment } from "./deployment.ts";
import { fly, type Backup, type Machine, type Stats } from "./fly.ts";
import { openrouter } from "./openrouter.ts";
import { list, presign, remove } from "./s3.ts";
import { sameSize, SIZES, sizeOf, type SizeKey } from "./sizes.ts";

// Every computer starts at the ladder's first rung, with this much disk.
const FLOOR = { ...SIZES.small, diskGb: 10 };

// The image every machine boots: apps/computer, built and pushed by hand.
const IMAGE = "registry.fly.io/maslow-computers-dev:v37";

// How far a computer has got: off, when this deployment makes none;
// then its disk, its machine, its first start, and ready when VS Code
// answers.
export type Progress = "off" | "disk" | "machine" | "starting" | "ready";

// Fly names carry our ids, so any list from Fly traces back in one look,
// and a disk or machine made and never recorded is found again by name.
const volumeName = (c: Computer) =>
  `c_${c.id.replaceAll("-", "").slice(0, 16)}`;
const machineName = (c: Computer) => `c-${c.id}`;

function tags(c: Computer): Record<string, string> {
  const d = deployment.computers;
  return {
    env: deployment.where,
    org: c.orgId,
    member: c.userId,
    computer: c.id,
    ...(d.kind === "fly" && d.checkout
      ? { checkout: d.checkout, lease: new Date().toISOString() }
      : {}),
  };
}

export const progressOf = (c: Computer): Progress =>
  c.readyAt
    ? "ready"
    : !c.volumeId
      ? "disk"
      : !c.machineId
        ? "machine"
        : "starting";

// Claims a computer for the member signing in, in the region their
// sign-in came from. Quick: nothing is made here.
export async function claim(p: Principal, region: string): Promise<void> {
  if (deployment.computers.kind === "none") return;
  await asOrg(p.orgId, (q) =>
    claimComputer(q, p.orgId, p.userId, region, FLOOR),
  );
}

// Moves the member's computer one step closer to ready and says where it
// stands: the page asks every few seconds until it is there. A row is
// claimed if sign-in did not; a request that finds another holding the
// computer answers with where it stands.
export async function advance(p: Principal, region: string): Promise<Progress> {
  if (deployment.computers.kind === "none") return "off";
  return asOrg(p.orgId, async (q) => {
    let c = await computerOf(q, p.userId);
    if (!c) {
      await claimComputer(q, p.orgId, p.userId, region, FLOOR);
      c = (await computerOf(q, p.userId))!;
    }
    if (c.readyAt) return "ready";
    if (!(await holdComputer(q, c.id))) return progressOf(c);
    await step(q, c, "sign-in");
    return progressOf((await computerOf(q, p.userId))!);
  });
}

// One step: the disk, then the machine, then ready once VS Code answers.
// Each Fly id is written the moment Fly hands it back; one that cannot be
// written is destroyed on the spot, and one written but never committed
// is found again by its name, so nothing at Fly goes unrecorded.
async function step(q: Query, c: Computer, why: string): Promise<void> {
  if (!c.volumeId) {
    const v =
      (await fly.volumes()).find((v) => v.name === volumeName(c)) ??
      (await fly.createVolume(volumeName(c), c.region, c.diskGb));
    try {
      await setVolume(q, c.id, v.id);
      await note(q, {
        orgId: c.orgId,
        userId: c.userId,
        resource: "disk",
        event: "made",
        ref: v.id,
        detail: { region: c.region, gb: c.diskGb },
        why,
      });
    } catch (err) {
      await fly.destroyVolume(v.id).catch(() => {});
      throw err;
    }
    return;
  }
  if (!c.machineId) {
    const m =
      (await fly.machines()).find(
        (m) =>
          m.name === machineName(c) && m.config?.metadata?.computer === c.id,
      ) ??
      (await fly.createMachine({
        name: machineName(c),
        region: c.region,
        image: IMAGE,
        volumeId: c.volumeId,
        cpuKind: c.cpuKind,
        cpus: c.cpus,
        memoryMb: c.memoryMb,
        secret: c.secret,
        brain: await brainOf(q, c),
        modelKey: await modelKeyOf(q, c),
        metadata: tags(c),
      }));
    try {
      await setMachine(q, c.id, m.id);
      await note(q, {
        orgId: c.orgId,
        userId: c.userId,
        resource: "machine",
        event: "made",
        ref: m.id,
        detail: {
          region: c.region,
          cpuKind: c.cpuKind,
          cpus: c.cpus,
          memoryMb: c.memoryMb,
          image: IMAGE,
        },
        why,
      });
    } catch (err) {
      await fly.destroyMachine(m.id).catch(() => {});
      throw err;
    }
    return;
  }
  if (await fly.answers(c.machineId)) await setReady(q, c.id, true);
}

// The name a computer's key carries at OpenRouter: the environment, the
// checkout, and the computer, so any list there traces back in one look
// and each deployment knows its own.
const keyPrefix = () => {
  const d = deployment.computers;
  return `maslow ${deployment.where} ${d.kind === "fly" ? (d.checkout ?? "production") : "off"} `;
};

// The OpenRouter key Claude Code on the machine runs on: minted once per
// computer with the cap, kept on its row, and given to the machine. Null
// where this deployment mints none; the person's own account then.
async function modelKeyOf(q: Query, c: Computer): Promise<string | null> {
  const m = deployment.models;
  if (m.kind !== "openrouter") return null;
  if (c.modelKey) return c.modelKey;
  const minted = await openrouter.mint(`${keyPrefix()}${c.id}`, m.capUsd);
  await setModelKey(q, c.id, minted.key, minted.hash);
  await note(q, {
    orgId: c.orgId,
    userId: c.userId,
    resource: "key",
    event: "made",
    ref: minted.hash,
    detail: { capUsd: m.capUsd },
    why: "the computer's Claude Code runs on it",
  });
  return minted.key;
}

// What Claude Code on the machine reaches the brain with: this
// deployment's address and a session of the owner's, opened once for the
// computer and kept on its row; a session the person ended is replaced
// when the machine is next made. Null where no machine can reach the app,
// as on a laptop.
async function brainOf(
  q: Query,
  c: Computer,
): Promise<{ url: string; token: string } | null> {
  const d = deployment.computers;
  if (d.kind !== "fly" || !d.brain) return null;
  const sessionId = c.sessionId ?? (await openComputerSession(q, c));
  return { url: d.brain, token: `${c.orgId}.${sessionId}` };
}

// The sweep's pass, org by org: every current member has a computer and
// it runs; every past member's is stopped; one cut off mid-making is
// finished; and outside production every machine's lease is renewed. A
// member with none is claimed one beside their org's others; an org with
// none yet waits for a sign-in, which knows where the person is.
export async function reconcile(): Promise<void> {
  if (deployment.computers.kind === "none") return;
  const orgs = await asMeter(async (q) =>
    (await q.query<{ id: string }>("select id from orgs")).rows.map(
      (r) => r.id,
    ),
  );
  const live = new Map((await fly.machines()).map((m) => [m.id, m]));
  const keys = new Set<string>();
  let whole = true;
  for (const orgId of orgs) {
    try {
      for (const hash of await reconcileOrg(orgId, live)) keys.add(hash);
    } catch (err) {
      whole = false;
      console.error(`computers ${orgId}: ${(err as Error).message}`);
    }
  }
  // Only a pass that read every org may say which keys nobody holds.
  if (whole)
    await stray(keys).catch((err: Error) =>
      console.error(`keys: ${err.message}`),
    );
}

// The machine remade on its disk to the image of the day at its row's
// size, with the brain's session and a model key, and probed again before
// it opens.
async function remake(
  q: Query,
  c: Computer,
  m: Machine,
  why: string,
): Promise<void> {
  await fly.reshape(m.id, {
    image: IMAGE,
    volumeId: c.volumeId!,
    cpuKind: c.cpuKind,
    cpus: c.cpus,
    memoryMb: c.memoryMb,
    secret: c.secret,
    brain: await brainOf(q, c),
    modelKey: await modelKeyOf(q, c),
    metadata: m.config?.metadata ?? tags(c),
  });
  await setReady(q, c.id, false);
  await note(q, {
    orgId: c.orgId,
    userId: c.userId,
    resource: "machine",
    event: "made",
    ref: m.id,
    detail: {
      image: IMAGE,
      cpuKind: c.cpuKind,
      cpus: c.cpus,
      memoryMb: c.memoryMb,
    },
    why,
  });
}

// Keys at OpenRouter that carry this deployment's name and no computer
// here holds: gone with the computer, whatever failed to let them go. One
// made within the hour is left: its computer may be mid-making.
async function stray(held: Set<string>): Promise<void> {
  if (deployment.models.kind !== "openrouter") return;
  const prefix = keyPrefix();
  for (const k of await openrouter.list())
    if (
      k.name.startsWith(prefix) &&
      !held.has(k.hash) &&
      Date.now() - k.createdAt.getTime() > 3600 * 1000
    ) {
      await openrouter.remove(k.hash);
      console.log(`key ${k.name}: deleted, its computer is gone`);
    }
}

// The key's spend since the last sweep, into the ledger. A key OpenRouter
// no longer has is forgotten and the machine remade with a fresh one.
async function spend(q: Query, c: Computer, m: Machine): Promise<void> {
  if (deployment.models.kind !== "openrouter" || !c.modelKeyHash) return;
  let total: number;
  try {
    total = await openrouter.spent(c.modelKeyHash);
  } catch (err) {
    if (/ answered 404:/.test((err as Error).message)) {
      await clearModelKey(q, c.id);
      await remake(
        q,
        { ...c, modelKey: null, modelKeyHash: null },
        m,
        "its key was gone",
      );
    }
    return;
  }
  if (total <= c.modelSpentUsd + 0.000001) return;
  await note(q, {
    orgId: c.orgId,
    userId: c.userId,
    resource: "key",
    event: "spent",
    ref: c.modelKeyHash,
    detail: { usd: total - c.modelSpentUsd, total },
    why: "models Claude Code called",
  });
  await setModelSpent(q, c.id, total);
}

// Answers the hashes of the model keys the org's computers hold.
async function reconcileOrg(
  orgId: string,
  live: Map<string, Machine>,
): Promise<string[]> {
  const computers = await asOrg(orgId, allComputers);
  const beside = computers[0];
  if (beside)
    for (const userId of await asOrg(orgId, membersWithoutComputers))
      await asOrg(orgId, (q) =>
        claimComputer(q, orgId, userId, beside.region, FLOOR),
      );
  const claimed = beside ? await asOrg(orgId, allComputers) : computers;
  for (const each of claimed) {
    await asOrg(orgId, async (q) => {
      if (!(await holdComputer(q, each.id))) return;
      // Read again under the hold: the row and the membership may have
      // moved since the list was made.
      let c = await computerOf(q, each.userId);
      if (!c) return;
      // The list from Fly was made before the loop; a machine made since
      // is asked after by name before it is given up on.
      const m = c.machineId
        ? (live.get(c.machineId) ?? (await fly.machine(c.machineId)))
        : null;
      // A machine Fly no longer has is forgotten; a current member gets
      // another at the next step.
      if (c.machineId && !m) {
        await clearMachine(q, c.id);
        c = { ...c, machineId: null, readyAt: null };
      }
      // A current member with no machine gets one at the next step.
      if (!m) {
        if (c.current) await step(q, c, "sweep");
        return;
      }
      // Every machine runs the image of the day at its row's size: one on
      // an older image, or at another size, is remade on the same disk and
      // probed again before it opens. Asked before anything else, so a
      // machine moves at the first sweep after the image does, however it
      // was left. Fly may name an image with its digest; the tag is what
      // is compared.
      const g = m.config?.guest ?? {};
      const sized =
        g.cpu_kind === c.cpuKind &&
        g.cpus === c.cpus &&
        g.memory_mb === c.memoryMb;
      // A machine made before this deployment minted keys gets one too.
      const keyed =
        deployment.models.kind !== "openrouter" || c.modelKeyHash !== null;
      if (
        c.current &&
        (m.config?.image?.split("@")[0] !== IMAGE || !sized || !keyed)
      ) {
        await remake(
          q,
          c,
          m,
          !keyed
            ? "a key was minted"
            : sized
              ? "the image moved on"
              : "the size was changed",
        );
        return;
      }
      // A running machine not yet known to answer is probed for VS Code;
      // a stopped one is started below and probed next time.
      if (!c.readyAt && c.current && m.state !== "stopped") {
        await step(q, c, "sweep");
        return;
      }
      if (c.current && m.state === "stopped") {
        await fly.start(m.id);
        await note(q, {
          orgId,
          userId: c.userId,
          resource: "machine",
          event: "started",
          ref: m.id,
          why: "member is current",
        });
      } else if (!c.current && m.state === "started") {
        await fly.stop(m.id);
        await note(q, {
          orgId,
          userId: c.userId,
          resource: "machine",
          event: "stopped",
          ref: m.id,
          why: "member is past",
        });
      }
      if (m.config?.metadata?.lease)
        await fly.tag(m.id, "lease", new Date().toISOString());
      if (c.readyAt && c.current && m.state === "started") {
        // The numbers once, for the disk and the size; a machine that
        // cannot be read this hour is left for the next.
        const s = await fly
          .stats(c.machineId!, ticket(c, 60))
          .catch(() => null);
        if (s) {
          if (await hot(q, c, m, s)) return;
          await grow(q, c, s);
        }
        await backUp(q, c);
        // The keys again every hour, so a machine remade or reset has them.
        if (c.authorizedKeys)
          await fly
            .pushKeys(c.machineId!, ticket(c, 60), c.authorizedKeys)
            .catch(() => {});
        await spend(q, c, m);
      }
    });
  }
  return (await asOrg(orgId, allComputers))
    .map((c) => c.modelKeyHash)
    .filter((h): h is string => h !== null);
}

// How many backups of a home are kept: the newest fourteen.
const BACKUPS_KEPT = 14;
const DAY = 24 * 3600 * 1000;

// A home archived into the bucket once a day, by the machine, to an
// address signed for it, and recorded here once it is done; the newest
// fourteen are kept. One that failed is tried again the next hour and
// said to us. Nowhere without a bucket.
async function backUp(q: Query, c: Computer): Promise<void> {
  const store = deployment.storage;
  if (store.kind !== "s3") return;
  let last: Backup | null;
  try {
    last = await fly.lastBackup(c.machineId!, ticket(c, 60));
  } catch {
    return;
  }
  // One still running is left to finish; one that has run for three hours
  // was cut off somewhere and is asked again.
  if (
    last &&
    !last.finishedAt &&
    Date.now() - Date.parse(last.startedAt) < 3 * 3600 * 1000
  )
    return;
  const prefix = `${store.prefix}backups/${c.id}/`;
  let backedUpAt = c.backedUpAt;
  if (
    last?.finishedAt &&
    (!backedUpAt || new Date(last.finishedAt) > backedUpAt)
  ) {
    if (last.error) {
      console.error(`computer ${c.id}: backup failed: ${last.error}`);
      // No room for the archive beside the home: the disk grows now, and
      // the backup is asked for again next hour.
      if (last.error.startsWith("no room"))
        await extend(q, c, "no room to archive the home for a backup");
      if (Date.now() - Date.parse(last.finishedAt) < 3600 * 1000) return;
    } else {
      backedUpAt = new Date(last.finishedAt);
      await setBackedUp(q, c.id, backedUpAt);
      await note(q, {
        orgId: c.orgId,
        userId: c.userId,
        resource: "backup",
        event: "made",
        ref: last.key,
        detail: { bytes: last.bytes },
        why: "a day had passed",
      });
      const keys = await list(store, prefix);
      for (const key of keys.slice(
        0,
        Math.max(0, keys.length - BACKUPS_KEPT),
      )) {
        await remove(store, key);
        await note(q, {
          orgId: c.orgId,
          userId: c.userId,
          resource: "backup",
          event: "destroyed",
          ref: key,
          why: `older than the ${BACKUPS_KEPT} kept`,
        });
      }
    }
  }
  if (backedUpAt && Date.now() - backedUpAt.getTime() < DAY) return;
  const key = `${prefix}${new Date().toISOString().replace(/[:.]/g, "-")}.tgz`;
  await fly.askBackup(c.machineId!, ticket(c, 60), {
    url: presign(store, "PUT", key, 3 * 3600),
    key,
  });
}

// The disk's ceiling: ours, high, never shown. Reaching it is said to us.
const DISK_CEILING_GB = 200;

// Grows a disk before it fills: past four fifths full, by half again, up
// to the ceiling, while the machine runs. Fly says when a machine must be
// restarted to see the room, and then it is, as for a new image. A disk
// that cannot be read this hour is left for the next.
async function grow(q: Query, c: Computer, s: Stats): Promise<void> {
  // The whole disk's room, ours on it included, not the person's bytes
  // alone; a machine that does not yet say is left alone.
  if (s.free == null || s.disk === null || s.free > s.disk * 0.2) return;
  await extend(q, c, "the disk was nearly full");
}

// The rung above each: memory doubles up the ladder and stops at Large,
// since Dedicated has no more of it.
const UP: Partial<Record<SizeKey, SizeKey>> = {
  small: "medium",
  medium: "large",
};

// A computer found with nine tenths of its memory in use is moved up one
// rung on its own, a restart of seconds, and never down: a starved
// machine cannot even show the person the warning. At the top, we are
// told. Whether it was moved.
async function hot(
  q: Query,
  c: Computer,
  m: Machine,
  s: Stats,
): Promise<boolean> {
  if (s.memory.used < s.memory.total * 0.9) return false;
  const next = UP[sizeOf(c) ?? "large"];
  if (!next) {
    console.error(`computer ${c.id}: memory nearly full at its largest size`);
    return false;
  }
  const size = SIZES[next];
  await setSize(q, c.id, size);
  await note(q, {
    orgId: c.orgId,
    userId: c.userId,
    resource: "machine",
    event: "resized",
    ref: c.machineId,
    detail: { cpuKind: size.cpuKind, cpus: size.cpus, memoryMb: size.memoryMb },
    why: "memory was nearly full",
  });
  await remake(q, { ...c, ...size }, m, "memory was nearly full");
  return true;
}

// Grows the disk by half again, up to the ceiling; at the ceiling, says
// so to us and leaves it.
async function extend(q: Query, c: Computer, why: string): Promise<void> {
  if (c.diskGb >= DISK_CEILING_GB) {
    console.error(
      `computer ${c.id}: disk at the ceiling of ${DISK_CEILING_GB} GB, ${why}`,
    );
    return;
  }
  const gb = Math.min(DISK_CEILING_GB, Math.ceil(c.diskGb * 1.5));
  const { needsRestart } = await fly.extendVolume(c.volumeId!, gb);
  await setDisk(q, c.id, gb);
  await note(q, {
    orgId: c.orgId,
    userId: c.userId,
    resource: "disk",
    event: "grown",
    ref: c.volumeId,
    detail: { from: c.diskGb, gb, restarted: needsRestart },
    why,
  });
  if (needsRestart) {
    await fly.restart(c.machineId!);
    await setReady(q, c.id, false);
  }
}

// A ticket the computer's door takes: its expiry, signed with the
// computer's secret, which only our server and that machine hold.
function ticket(c: Computer, seconds: number): string {
  const exp = String(Math.floor(Date.now() / 1000) + seconds);
  return `${exp}.${createHmac("sha256", c.secret).update(exp).digest("hex")}`;
}

// The member's ready computer, or null.
async function ready(p: Principal): Promise<Computer | null> {
  if (deployment.computers.kind === "none") return null;
  const c = await asOrg(p.orgId, (q) => computerOf(q, p.userId));
  return c?.readyAt && c.machineId ? c : null;
}

// Where a ready computer opens: its machine's own address, with a ticket
// its door takes for a month, and the path on it to go on to, when that
// is a path. Null until it is ready.
export async function openLink(
  p: Principal,
  to: string | null = null,
): Promise<string | null> {
  const d = deployment.computers;
  const c = await ready(p);
  if (!c || d.kind === "none") return null;
  // A path on the machine: one leading slash, and no backslash anywhere,
  // which a browser would read as a second slash.
  const onward =
    to && /^\/(?!\/)[^\\\s]*$/.test(to) ? `&to=${encodeURIComponent(to)}` : "";
  return `https://${c.machineId}.${d.domain}/?ticket=${ticket(c, 30 * 24 * 3600)}${onward}`;
}

// Starts the person's Linux over and keeps their home: the door is asked
// to mark the disk, the machine is rebooted, and the page watches it come
// back. The person's own choice, never a monitor's. False when there is
// no ready computer to reset. The door first, so a refusal changes
// nothing; the row last, so what a failure leaves behind is a machine
// that comes back ready on its own within the minute.
export async function reset(p: Principal): Promise<boolean> {
  const c = await ready(p);
  if (!c) return false;
  await fly.askReset(c.machineId!, ticket(c, 60));
  await fly.restart(c.machineId!);
  await asOrg(p.orgId, async (q) => {
    await setReady(q, c.id, false);
    await note(q, {
      orgId: c.orgId,
      userId: c.userId,
      resource: "machine",
      event: "reset",
      ref: c.machineId,
      why: "the person asked",
    });
  });
  return true;
}

// Moves a ready computer to a rung of the ladder: the row first, so the
// row is always the truth the sweep restores, then the machine remade
// into it on its own disk, a restart of a few seconds. False when there
// is no ready computer.
export async function resize(p: Principal, key: SizeKey): Promise<boolean> {
  const size = SIZES[key];
  // One transaction, holding the computer throughout: no other request
  // talks to Fly about it meanwhile, and a remake that fails leaves the
  // row as it was.
  return asOrg(p.orgId, async (q) => {
    const c = await computerOf(q, p.userId);
    if (!c?.readyAt || !c.machineId || !(await holdComputer(q, c.id)))
      return false;
    if (sameSize(size, c)) return true;
    await setSize(q, c.id, size);
    await setReady(q, c.id, false);
    await note(q, {
      orgId: c.orgId,
      userId: c.userId,
      resource: "machine",
      event: "resized",
      ref: c.machineId,
      detail: {
        cpuKind: size.cpuKind,
        cpus: size.cpus,
        memoryMb: size.memoryMb,
      },
      why: "the person asked",
    });
    const m = await fly.machine(c.machineId);
    await fly.reshape(c.machineId, {
      image: IMAGE,
      volumeId: c.volumeId!,
      cpuKind: size.cpuKind,
      cpus: size.cpus,
      memoryMb: size.memoryMb,
      secret: c.secret,
      brain: await brainOf(q, c),
      modelKey: await modelKeyOf(q, c),
      metadata: m?.config?.metadata ?? tags(c),
    });
    return true;
  });
}

// Gives a ready computer's machine the keys that open it over SSH, as the
// row has them. Nothing when it is not ready; the sweep gives them then.
export async function pushKeys(p: Principal): Promise<void> {
  const c = await ready(p);
  if (!c) return;
  await fly.pushKeys(c.machineId!, ticket(c, 60), c.authorizedKeys);
}

// What the computer's browser is looking at, or null while it is closed
// or the computer is not ready.
export async function browserShotOf(p: Principal): Promise<Uint8Array | null> {
  const c = await ready(p);
  if (!c) return null;
  return fly.browserShot(c.machineId!, ticket(c, 60)).catch(() => null);
}

// A person's hand on their computer's browser. False when the computer is
// not ready; the door's word when the browser refuses.
export async function browserAct(p: Principal, act: unknown): Promise<boolean> {
  const c = await ready(p);
  if (!c) return false;
  await fly.browserAct(c.machineId!, ticket(c, 60), act);
  return true;
}

// Whose account Claude Code on the computer runs on: ours, with the cap,
// where this deployment mints keys; the person's own elsewhere.
export function modelOf(): { kind: "ours"; capUsd: number } | { kind: "mine" } {
  const m = deployment.models;
  return m.kind === "openrouter"
    ? { kind: "ours", capUsd: m.capUsd }
    : { kind: "mine" };
}

// Where a ready computer answers SSH, and whether any key opens it. Null
// until it is ready.
export async function sshOf(
  p: Principal,
): Promise<{ host: string; keys: boolean } | null> {
  const d = deployment.computers;
  const c = await ready(p);
  if (!c || d.kind === "none") return null;
  return { host: `${c.machineId}.${d.domain}`, keys: c.authorizedKeys !== "" };
}

// The computer's numbers this moment, asked of its door with a ticket
// good for a minute. Null until it is ready.
export async function statsOf(p: Principal): Promise<Stats | null> {
  const c = await ready(p);
  if (!c) return null;
  return fly.stats(c.machineId!, ticket(c, 60));
}

// Pays a purged member's or a deleted org's computer back to Fly: the
// machine, then the disk, each written to the ledger as it goes. The ref
// names both; the member is gone, so the row says the org alone.
export async function destroy(orgId: string, ref: string): Promise<void> {
  const [machineId, volumeId] = ref.split(":");
  if (machineId) {
    await fly.destroyMachine(machineId);
    await asOrg(orgId, (q) =>
      note(q, {
        orgId,
        userId: null,
        resource: "machine",
        event: "destroyed",
        ref: machineId,
        why: "purged",
      }),
    );
  }
  if (volumeId) {
    await fly.destroyVolume(volumeId);
    await asOrg(orgId, (q) =>
      note(q, {
        orgId,
        userId: null,
        resource: "disk",
        event: "destroyed",
        ref: volumeId,
        why: "purged",
      }),
    );
  }
}
