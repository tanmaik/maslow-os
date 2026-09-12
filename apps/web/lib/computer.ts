import { asMeter, asOrg, asPerson, type Query } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import {
  allComputers,
  claimComputer,
  clearMachine,
  clearVolume,
  clearModelKey,
  computerByMachine,
  computerOf,
  holdComputer,
  membersWithoutComputers,
  note,
  openComputerSession,
  ownerOf,
  portsReaching,
  setBackedUp,
  setDisk,
  setMachine,
  setModelKey,
  setModelSpent,
  setMove,
  setPlace,
  setReady,
  setSize,
  setVolume,
  shares,
  sharesOn,
  sharePort,
  type Computer,
  type Move,
  type PortShare,
  type SharedPort,
} from "@maslow/db/computers";

import { createHmac, timingSafeEqual } from "node:crypto";

import { deployment } from "./deployment.ts";
import {
  fly,
  type Backup,
  type Entry,
  type Machine,
  type Stats,
} from "./fly.ts";
import { openrouter } from "./openrouter.ts";
import { regionName, type Region } from "./region.ts";
import { list, presign, remove } from "./s3.ts";
import { sameSize, SIZES, type SizeKey } from "./sizes.ts";

// Every computer starts at the ladder's first rung, with this much disk.
const FLOOR = { ...SIZES.small, diskGb: 10 };

// The image every machine boots: apps/computer, built and pushed by hand.
const IMAGE = "registry.fly.io/maslow-computers-dev:fix-4";

// How far a computer has got: off, when this deployment makes none;
// then its disk, its machine, its first start, and ready when its door
// answers; moving while it is on its way to another region.
export type Progress =
  "off" | "disk" | "machine" | "starting" | "moving" | "ready";

// Where a move stands: the old machine stopping, its disk being copied,
// the copy being restored in the new region, the machine there starting
// and being checked, and the old machine and disk being cleared away.
export type MoveStep =
  "stopping" | "copying" | "restoring" | "starting" | "clearing";

// Where a computer stands, for the page: how far it has got, where it
// is, the move under way if any, and what a move that just failed said.
export type State = {
  progress: Progress;
  region: string | null;
  move: { to: string; step: MoveStep } | null;
  failed: string | null;
};

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

const progressOf = (c: Computer): Progress =>
  c.move
    ? "moving"
    : c.readyAt
      ? "ready"
      : !c.volumeId
        ? "disk"
        : !c.machineId
          ? "machine"
          : "starting";

const moveStepOf = (m: Move): MoveStep =>
  m.old
    ? "clearing"
    : m.machineId
      ? "starting"
      : m.volumeId
        ? "restoring"
        : m.snapshotId
          ? "copying"
          : "stopping";

export const stateOf = (c: Computer | null): State => ({
  progress: c ? progressOf(c) : "disk",
  region: c?.region ?? null,
  move: c?.move ? { to: c.move.to, step: moveStepOf(c.move) } : null,
  failed: null,
});

const OFF: State = { progress: "off", region: null, move: null, failed: null };

// Claims a computer for the member signing in, in the region their
// sign-in came from. Quick: nothing is made here.
export async function claim(p: Principal, region: string): Promise<void> {
  if (deployment.computers.kind === "none") return;
  await asOrg(p.orgId, (q) =>
    claimComputer(q, p.orgId, p.userId, region, FLOOR),
  );
}

// Moves the member's computer one step closer to ready, or a move of it
// one step on, and says where it stands: the page asks every few seconds
// until it is there. A row is claimed if sign-in did not; a request that
// finds another holding the computer answers with where it stands.
export async function advance(p: Principal, region: string): Promise<State> {
  if (deployment.computers.kind === "none") return OFF;
  return asOrg(p.orgId, async (q) => {
    let c = await computerOf(q, p.userId);
    if (!c) {
      await claimComputer(q, p.orgId, p.userId, region, FLOOR);
      c = (await computerOf(q, p.userId))!;
    }
    // Ready and not moving, there is nothing to do; a move is taken on
    // even once the row has turned to the new machine, to clear the old.
    if ((c.readyAt && !c.move) || !(await holdComputer(q, c.id)))
      return stateOf(c);
    let failed = null;
    if (c.move) failed = await moveOn(q, c, "the page asked");
    else await step(q, c, "sign-in");
    return { ...stateOf(await computerOf(q, p.userId)), failed };
  });
}

// One step: the disk, then the machine, then ready once its door answers.
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
    // A disk Fly no longer has — taken by the reap while no machine held
    // it, or by hand — is forgotten, and the next step makes another.
    if (!(await fly.volumes()).some((v) => v.id === c.volumeId)) {
      await clearVolume(q, c.id);
      await note(q, {
        orgId: c.orgId,
        userId: c.userId,
        resource: "disk",
        event: "destroyed",
        ref: c.volumeId,
        why: "Fly no longer has it; another is made",
      });
      return;
    }
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
        who: await whoOf(q, c),
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

// Who the person is on their machine, so a prompt reads wile@acme: their
// first name as the account's name and their org's slug as the machine's,
// each cut to what Linux takes for one.
async function whoOf(
  q: Query,
  c: Computer,
): Promise<{ person: string; org: string }> {
  const { firstName, orgSlug } = await ownerOf(q, c);
  const plain = (s: string, max: number) =>
    s
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^[^a-z]+|-+$/g, "")
      .slice(0, max);
  return {
    person: plain(firstName, 32) || "me",
    org: plain(orgSlug, 63) || "computer",
  };
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
// size, with the brain's session and the person's name, and probed again
// before it opens.
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
    who: await whoOf(q, c),
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
      // A move the person asked for is taken on, or put back, before
      // anything else, and nothing else touches the computer meanwhile.
      if (c.move) {
        const failed = await moveOn(q, c, "sweep");
        if (failed) console.error(`computer ${c.id}: ${failed}`);
        return;
      }
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
      // Every machine runs the image of the day at its row's size, in the
      // person's name: one on an older image, at another size, or made by
      // hand without the person and their org on it, is remade on the
      // same disk and probed again before it opens. Asked before anything
      // else, so a machine moves at the first sweep after the image does,
      // however it was left. Fly may name an image with its digest; the
      // tag is what is compared.
      const g = m.config?.guest ?? {};
      const sized =
        g.cpu_kind === c.cpuKind &&
        g.cpus === c.cpus &&
        g.memory_mb === c.memoryMb;
      const who = await whoOf(q, c);
      const named =
        m.config?.env?.PERSON === who.person && m.config?.env?.ORG === who.org;
      // A machine made before this deployment minted keys gets one too.
      const keyed =
        deployment.models.kind !== "openrouter" || c.modelKeyHash !== null;
      if (
        c.current &&
        (m.config?.image?.split("@")[0] !== IMAGE || !sized || !named || !keyed)
      ) {
        await remake(
          q,
          c,
          m,
          !named
            ? "the person was named"
            : !keyed
              ? "a key was minted"
              : sized
                ? "the image moved on"
                : "the size was changed",
        );
        return;
      }
      // A running machine not yet known to answer is probed at its door;
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
        if (s) await grow(q, c, s);
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

// A ticket the computer's door takes: its expiry and how much of the
// machine it opens, signed with the computer's secret, which only our
// server and that machine hold. Named a port, it opens that port alone, so
// what somebody was given a port for does not become the whole computer.
// Named nothing, it opens everything, and is minted only for the owner.
function ticket(c: Computer, seconds: number, port?: number): string {
  const exp = String(Math.floor(Date.now() / 1000) + seconds);
  const said = port === undefined ? exp : `${exp}.${port}`;
  return `${said}.${createHmac("sha256", c.secret).update(said).digest("hex")}`;
}

// The member's ready computer, or null.
async function ready(p: Principal): Promise<Computer | null> {
  if (deployment.computers.kind === "none") return null;
  const c = await asOrg(p.orgId, (q) => computerOf(q, p.userId));
  return c?.readyAt && c.machineId ? c : null;
}

// Where a ready computer opens: its machine's own address, with a ticket
// its door takes for a month, and the path on it to go on to, when that
// is a path. A port of the person's own has an address of its own under
// the same name, so the app answering there sits at the root of a host and
// nothing of its own has to be rewritten. Null until it is ready.
export async function openLink(
  p: Principal,
  to: string | null = null,
  port: number | null = null,
): Promise<string | null> {
  const d = deployment.computers;
  const c = await ready(p);
  if (!c || d.kind === "none") return null;
  // A path on the machine: one leading slash, and no backslash anywhere,
  // which a browser would read as a second slash.
  const onward =
    to && /^\/(?!\/)[^\\\s]*$/.test(to) ? `&to=${encodeURIComponent(to)}` : "";
  const one =
    port !== null && Number.isInteger(port) && port > 0 && port < 65536;
  const at = one ? `${port}-${c.machineId}` : c.machineId;
  const key = one ? ticket(c, SHARED_FOR, port) : ticket(c, 30 * 24 * 3600);
  return `https://${at}.${d.domain}/?ticket=${key}${onward}`;
}

// How long a ticket for one port lasts. Every visit to a shared port is a
// fresh one, minted only after the share is looked up again, so taking a
// share away stops somebody within the hour rather than whenever they
// happen to close the tab.
const SHARED_FOR = 3600;

// Where a port somebody else opened is reached, for a member the port was
// shared with: the machine's own address with a ticket for that port and
// nothing more. Null when the org holds no such machine, when the machine
// is not ready, or when this member was not given it.
export async function sharedLink(
  p: Principal,
  machineId: string,
  port: number,
): Promise<string | null> {
  const d = deployment.computers;
  if (d.kind === "none") return null;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return asPerson(p, async (q) => {
    const c = await computerByMachine(q, machineId);
    if (!c?.readyAt || !c.machineId) return null;
    const allowed = c.userId === p.userId || (await shares(q, c.id, port));
    if (!allowed) return null;
    return `https://${port}-${c.machineId}.${d.domain}/?ticket=${ticket(c, SHARED_FOR, port)}`;
  });
}

// The person's own machine and who they have given each of its ports to,
// for the Computer page. Null where they have no ready computer.
export async function sharingOf(
  p: Principal,
): Promise<{ machineId: string; shares: PortShare[] } | null> {
  return asPerson(p, async (q) => {
    const c = await computerOf(q, p.userId);
    if (!c?.readyAt || !c.machineId) return null;
    return { machineId: c.machineId, shares: await sharesOn(q, c.id) };
  });
}

// The ports other people have opened to this person, for the Computer page:
// each is a link on our own domain, the same one its owner hands out. Empty
// where this deployment has no computers.
export async function sharedWithMe(p: Principal): Promise<SharedPort[]> {
  if (deployment.computers.kind === "none") return [];
  return asPerson(p, portsReaching);
}

// Makes what one of the person's own ports reaches exactly this: everyone
// in the org, or some groups and some people. Nobody outside the org can be
// named, since the database refuses a member or a group of another org, and
// there is no level to give, only the port.
export async function share(
  p: Principal,
  port: number,
  to: { everyone: boolean; groupIds: string[]; memberIds: string[] },
): Promise<boolean> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  return asPerson(p, async (q) => {
    const c = await computerOf(q, p.userId);
    // A port is shared only once the computer is ready, so nothing is given
    // away before there is a machine to open at all.
    if (!c?.readyAt || !c.machineId) return false;
    await sharePort(q, c.id, port, to);
    return true;
  });
}

// Where signing out goes on its way home, so the ticket a browser keeps on
// the machine's own name is thrown away with the session. Our server cannot
// reach that cookie: it belongs to another name entirely. Where to go next
// is signed with the computer's secret, so the door carries the browser
// only where we sent it. Null when there is no machine to pass through, and
// sign-out then goes straight home.
export async function leaveLink(
  p: Principal,
  home: string,
): Promise<string | null> {
  const d = deployment.computers;
  const c = await ready(p);
  if (!c || d.kind === "none") return null;
  const sig = createHmac("sha256", c.secret)
    .update(`leave:${home}`)
    .digest("hex");
  return `https://${c.machineId}.${d.domain}/maslow/leave?to=${encodeURIComponent(home)}&sig=${sig}`;
}

// The person's files on their own computer, through its door with a
// ticket of the owner's: what a folder holds, a file's bytes, and a file
// written whole. Paths are relative to the home. Null where there is no
// ready computer.
export async function files(p: Principal): Promise<{
  list(at: string): Promise<Entry[]>;
  read(at: string, range?: string): Promise<Response>;
  preview(at: string): Promise<Response>;
  write(at: string, body: string): Promise<number>;
} | null> {
  const c = await ready(p);
  if (!c) return null;
  const m = c.machineId!;
  const t = () => ticket(c, 60);
  return {
    list: (at) => fly.files.list(m, t(), at),
    read: (at, range) => fly.files.read(m, t(), at, range),
    preview: (at) => fly.files.preview(m, t(), at),
    write: (at, body) => fly.files.write(m, t(), at, body),
  };
}

// Where the person's browser sends an upload: the machine's own door, with
// a ticket for the whole machine good for an hour, so a large file goes
// straight to the disk it lands on and never through us. Null where there
// is no ready computer.
export async function uploadTarget(
  p: Principal,
): Promise<{ door: string; ticket: string } | null> {
  const d = deployment.computers;
  const c = await ready(p);
  if (!c || d.kind === "none") return null;
  return {
    door: `https://${c.machineId}.${d.domain}/maslow/files`,
    ticket: ticket(c, 3600),
  };
}

// Where the person's browser opens its live sockets: the machine's own
// door, with a ticket for the whole machine good for an hour, so the
// terminal's keys, the browser's video and the files that changed pass
// straight between them and never through us. Null where there is no
// ready computer.
export async function liveTarget(
  p: Principal,
): Promise<{ door: string; ticket: string } | null> {
  const d = deployment.computers;
  const c = await ready(p);
  if (!c || d.kind === "none") return null;
  return {
    door: `wss://${c.machineId}.${d.domain}`,
    ticket: ticket(c, 3600),
  };
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
      who: await whoOf(q, c),
      modelKey: await modelKeyOf(q, c),
      metadata: m?.config?.metadata ?? tags(c),
    });
    return true;
  });
}

// A move that has run this long is put back, whatever step it is on.
const MOVE_LIMIT = 30 * 60 * 1000;

// Starts moving a ready computer to a region, at the person's own ask and
// never otherwise: the row says so, and the page then asks after it step
// by step until it runs there or is back where it was. False when there
// is no ready computer; true at once when it is there already.
export async function move(p: Principal, to: Region): Promise<boolean> {
  return asOrg(p.orgId, async (q) => {
    const c = await computerOf(q, p.userId);
    if (
      !c?.readyAt ||
      !c.machineId ||
      !c.volumeId ||
      !(await holdComputer(q, c.id))
    )
      return false;
    if (c.region === to) return true;
    await setMove(q, c.id, { to, askedAt: new Date().toISOString() });
    await setReady(q, c.id, false);
    return true;
  });
}

// Takes a move on from wherever it stands, one step a call, and says what
// a step that failed said, or null. The old disk is the only copy of the
// person's Linux until the new machine answers its door, so it is
// stopped, copied and left alone until then, and each id is written the
// moment Fly hands it back, so a call cut off anywhere is taken up by the
// next. A step that fails, or a move that has run half an hour, is put
// back to the machine they had.
async function moveOn(
  q: Query,
  c: Computer,
  why: string,
): Promise<string | null> {
  const m = c.move!;
  const to = regionName(m.to);
  const on = (more: Partial<Move>) => setMove(q, c.id, { ...m, ...more });
  const say = (
    resource: "machine" | "disk" | "snapshot",
    event: "made" | "stopped" | "destroyed",
    ref: string,
    detail?: Record<string, unknown>,
  ) =>
    note(q, {
      orgId: c.orgId,
      userId: c.userId,
      resource,
      event,
      ref,
      detail,
      why: `${why}: moving to ${to}`,
    });
  try {
    if (m.old) {
      await fly.destroyMachine(m.old.machineId);
      await say("machine", "destroyed", m.old.machineId);
      await fly.destroyVolume(m.old.volumeId);
      await say("disk", "destroyed", m.old.volumeId, {
        snapshot: m.snapshotId,
        keptDays: 1,
      });
      await setMove(q, c.id, null);
      return null;
    }
    if (Date.now() - Date.parse(m.askedAt) > MOVE_LIMIT)
      throw new Error("it took longer than half an hour");
    if (!m.snapshotId) {
      const old = await fly.machine(c.machineId!);
      if (!old) throw new Error("the machine is gone");
      if (old.state === "started") {
        await fly.stop(old.id);
        await say("machine", "stopped", old.id);
      }
      if (!(await fly.stopped(old.id, 20))) return null;
      await fly.keepSnapshots(c.volumeId!, 1);
      const s = await fly.snapshot(c.volumeId!);
      await on({ snapshotId: s.id });
      await say("snapshot", "made", s.id, {
        disk: c.volumeId,
        region: c.region,
        keptDays: 1,
      });
      return null;
    }
    if (!m.volumeId) {
      const s = (await fly.snapshots(c.volumeId!)).find(
        (s) => s.id === m.snapshotId,
      );
      if (!s) throw new Error("the snapshot is gone");
      if (s.status !== "created") return null;
      const v =
        (await fly.volumes()).find(
          (v) => v.name === volumeName(c) && v.region === m.to,
        ) ?? (await fly.restoreVolume(volumeName(c), m.to, c.diskGb, s.id));
      await on({ volumeId: v.id });
      await say("disk", "made", v.id, {
        region: m.to,
        gb: c.diskGb,
        snapshot: s.id,
      });
      return null;
    }
    if (!m.machineId) {
      const v = await fly.volume(m.volumeId);
      if (!v) throw new Error("the new disk is gone");
      if (v.state !== "created") return null;
      const name = `${machineName(c)}-${m.to}`;
      const made =
        (await fly.machines()).find(
          (x) => x.name === name && x.config?.metadata?.computer === c.id,
        ) ??
        (await fly.createMachine({
          name,
          region: m.to,
          image: IMAGE,
          volumeId: m.volumeId,
          cpuKind: c.cpuKind,
          cpus: c.cpus,
          memoryMb: c.memoryMb,
          secret: c.secret,
          brain: await brainOf(q, c),
          who: await whoOf(q, c),
          modelKey: await modelKeyOf(q, c),
          metadata: tags(c),
        }));
      await on({ machineId: made.id });
      await say("machine", "made", made.id, {
        region: m.to,
        cpuKind: c.cpuKind,
        cpus: c.cpus,
        memoryMb: c.memoryMb,
        image: IMAGE,
      });
      return null;
    }
    if (!(await fly.answers(m.machineId))) return null;
    await setPlace(q, c.id, {
      region: m.to,
      volumeId: m.volumeId,
      machineId: m.machineId,
    });
    await setReady(q, c.id, true);
    await on({ old: { machineId: c.machineId!, volumeId: c.volumeId! } });
    return null;
  } catch (err) {
    // Once the row has turned to the new machine the old one is owed to
    // Fly, and the next call pays it.
    if (m.old) throw err;
    const reason = (err as Error).message;
    await moveBack(q, c, reason);
    return `Could not move to ${to}: ${reason}. Your computer is running where it was.`;
  }
}

// Puts a move back: the machine and disk made in the new region go, the
// machine the person had is started again, and the snapshot stays its
// day.
async function moveBack(q: Query, c: Computer, reason: string): Promise<void> {
  const m = c.move!;
  const why = `the move to ${regionName(m.to)} failed: ${reason}`;
  const say = (
    resource: "machine" | "disk",
    event: "started" | "destroyed",
    ref: string,
  ) => note(q, { orgId: c.orgId, userId: c.userId, resource, event, ref, why });
  if (m.machineId) {
    await fly.destroyMachine(m.machineId);
    await say("machine", "destroyed", m.machineId);
  }
  if (m.volumeId) {
    await fly.destroyVolume(m.volumeId);
    await say("disk", "destroyed", m.volumeId);
  }
  await fly.start(c.machineId!);
  await say("machine", "started", c.machineId!);
  await setMove(q, c.id, null);
}

// Gives a ready computer's machine the keys that open it over SSH, as the
// row has them. Nothing when it is not ready; the sweep gives them then.
export async function pushKeys(p: Principal): Promise<void> {
  const c = await ready(p);
  if (!c) return;
  await fly.pushKeys(c.machineId!, ticket(c, 60), c.authorizedKeys);
}

// Whose account Claude Code on the computer runs on: ours, with the cap,
// where this deployment mints keys; the person's own elsewhere.
export function modelOf(): { kind: "ours"; capUsd: number } | { kind: "mine" } {
  const m = deployment.models;
  return m.kind === "openrouter"
    ? { kind: "ours", capUsd: m.capUsd }
    : { kind: "mine" };
}

// The way in from the person's own terminal: the computer's name, which
// is both its hostname and `ssh`'s word for it; the one command that
// sets a Mac up to reach it, carrying a ticket good for an hour so the
// script it fetches knows whose computer; and whether a key opens it
// yet. Null until it is ready.
export async function sshOf(
  p: Principal,
  site: string,
): Promise<{ name: string; command: string; keys: boolean } | null> {
  const c = await ready(p);
  if (!c) return null;
  const { org } = await asOrg(p.orgId, (q) => whoOf(q, c));
  const link = `${site}/ssh/setup?o=${c.orgId}&c=${c.machineId}&t=${ticket(c, 3600)}`;
  return {
    name: org,
    command: `curl -fsSL "${link}" | sh`,
    keys: c.authorizedKeys !== "",
  };
}

// The computer a setup link names, as the script it serves needs it: its
// name and where it answers SSH. Null when the link is stale, forged or
// names no machine.
export async function sshTarget(
  orgId: string,
  machineId: string,
  t: string,
): Promise<{ name: string; host: string } | null> {
  const d = deployment.computers;
  if (d.kind === "none" || !/^[0-9a-f-]{36}$/.test(orgId)) return null;
  const c = await asOrg(orgId, (q) => computerByMachine(q, machineId));
  if (!c || !honours(c, t)) return null;
  const { org } = await asOrg(orgId, (q) => whoOf(q, c));
  return { name: org, host: `${machineId}.${d.domain}` };
}

// Whether a ticket for the whole machine is one this computer's secret
// signed and its hour has not passed.
function honours(c: Computer, t: string): boolean {
  const [exp, sig] = t.split(".");
  if (!exp || !sig || Number(exp) * 1000 < Date.now()) return false;
  const want = createHmac("sha256", c.secret).update(exp).digest("hex");
  return (
    sig.length === want.length &&
    timingSafeEqual(Buffer.from(sig), Buffer.from(want))
  );
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
