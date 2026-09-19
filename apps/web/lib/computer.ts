import { asMeter, asOrg, asPerson, type Query } from "@maslow/db";
import type { Principal } from "@maslow/db/auth";
import { notificationOf } from "@maslow/db/notifications";
import {
  allComputers,
  claimComputer,
  clearMachine,
  clearVolume,
  clearModelKey,
  addKey,
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
  setMemory,
  setShape,
  setMachine,
  setModelKey,
  setModelSpent,
  setMove,
  setPlace,
  setReady,
  setUpdate,
  setRegion,
  setVolume,
  shares,
  sharesOn,
  sharePort,
  publicPortsOn,
  spentByDay,
  appsOn,
  publishApp,
  unpublishApp,
  arrangeApps,
  type Computer,
  type Move,
  type PortShare,
  type PublishedApp,
  type SharedPort,
} from "@maslow/db/computers";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { deployment } from "./deployment.ts";
import { modelToken, modelUrl } from "./models.ts";
import { cloud } from "./cloud.ts";
import { CloudRefused, DiskGone, type Machine } from "./clouds.ts";
import {
  door,
  type Backup,
  type Entry,
  type Restore,
  type Stats,
} from "./door.ts";
import { ownerPrincipal, refreshShares } from "./shares.ts";
import { openrouter } from "./openrouter.ts";
import { isRegion, regionName } from "./region.ts";
import { list, presign, remove, s3 } from "./s3.ts";
import { SIZES } from "./sizes.ts";

// Every computer starts at the ladder's first rung, with this much disk:
// enough for a checkout of a Node project, its modules and its build,
// which ten was not.
const FLOOR = { ...SIZES.small, diskGb: 20 };

// The size a machine is shaped to: never under the floor, never under
// its row, and never under what it already has, so a size given by hand
// stands and nothing remade comes back smaller.
type Shape = Pick<Computer, "cpuKind" | "cpus" | "memoryMb">;
const atLeast = (c: Computer, has: Machine["size"]) => ({
  cpuKind: (has.cpuKind as Computer["cpuKind"] | undefined) ?? c.cpuKind,
  cpus: Math.max(FLOOR.cpus, c.cpus, has.cpus ?? 0),
  memoryMb: Math.max(FLOOR.memoryMb, c.memoryMb, has.memoryMb ?? 0),
});
const sameShape = (a: Shape, b: Shape) =>
  a.cpuKind === b.cpuKind && a.cpus === b.cpus && a.memoryMb === b.memoryMb;

// The image every machine boots, by its label: apps/computer, built and
// pushed by hand to where the cloud keeps images.
export const IMAGE = "door-82";

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
// is, the move under way if any, and what the last step that failed said
// — a move that went back, or a refusal from the cloud the next ask tries past.
export type State = {
  progress: Progress;
  region: string | null;
  // The region a move goes to, by its code and its name in words.
  move: { to: string; toName: string; step: MoveStep } | null;
  failed: string | null;
};

// Names at the cloud carry our ids, so any list from it traces back in one look,
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
    ...(d.kind !== "none" && d.checkout
      ? { checkout: d.checkout, lease: new Date().toISOString() }
      : {}),
  };
}

// The tags a machine keeps when it is remade: its own, with the lease
// marked now, since a machine being remade is one somebody wants this
// minute and the reap reads nothing else. One made by hand with no tags
// takes ours.
function wanted(c: Computer, m: Machine): Record<string, string> {
  const own = m.tags;
  if (Object.keys(own).length === 0) return tags(c);
  return own.lease ? { ...own, lease: new Date().toISOString() } : own;
}

// Where the person's computer stands, from the row alone: what the app
// last did to it, with no round trip to the door.
export async function standing(p: Principal): Promise<Progress> {
  if (deployment.computers.kind === "none") return "off";
  const c = await asOrg(p.orgId, (q) => computerOf(q, p.userId));
  return c ? progressOf(c) : "disk";
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

const stateOf = (c: Computer | null): State => ({
  progress: c ? progressOf(c) : "disk",
  region: c?.region ?? null,
  move: c?.move
    ? {
        to: c.move.to,
        toName: regionName(c.move.to),
        step: moveStepOf(c.move),
      }
    : null,
  failed: null,
});

// How long the door is given to answer a page about to draw the computer:
// enough for a machine that is up, little enough that a person is not held
// at a blank pane by one that is down.
const DOOR_WAIT = 4_000;

// Whether the computer's door answers now: what ready means, wherever it
// is asked. A row with no machine on it has no door to ask.
const doorAnswers = (c: Computer): Promise<boolean> =>
  c.machineId ? door.answers(c.machineId, DOOR_WAIT) : Promise.resolve(false);

// Where the person's computer stands, for a page about to draw it. Ready
// is the door answering and not a date on a row, so a computer whose door
// is silent is still on its way: the page shows the making, and asking
// after it puts it right.
export async function stateNow(c: Computer | null): Promise<State> {
  const state = stateOf(c);
  if (!c || state.progress !== "ready") return state;
  return (await doorAnswers(c)) ? state : { ...state, progress: "starting" };
}

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
  // The row first, in a transaction of its own. The door is a vendor
  // round trip of up to four seconds and the page asks every three, so no
  // pooled connection is held open across it.
  const known = await asOrg(p.orgId, async (q) => {
    const c = await computerOf(q, p.userId);
    if (c) return c;
    await claimComputer(q, p.orgId, p.userId, region, FLOOR);
    return (await computerOf(q, p.userId))!;
  });
  // Ready and answering its door, there is nothing to do; a move is
  // taken on even once the row has turned to the new machine, to clear
  // the old.
  if (known.readyAt && !known.move && (await doorAnswers(known)))
    return stateOf(known);
  return asOrg(p.orgId, async (q) => {
    // Read again under the hold: the door was asked outside this
    // transaction and the row may have moved on while it answered.
    const c = (await computerOf(q, p.userId)) ?? known;
    // A row that says ready over a silent door is a row that is wrong:
    // whoever holds the computer is putting it right, and until they have,
    // it is on its way and not there.
    if (!(await holdComputer(q, c.id)))
      return c.readyAt && !c.move
        ? { ...stateOf(c), progress: "starting" }
        : stateOf(c);
    let failed = null;
    try {
      // A row claimed in a region that is no longer one of ours, with
      // nothing made there yet, is made where this ask came from instead.
      if (!c.volumeId && !c.machineId && !isRegion(c.region)) {
        await setRegion(q, c.id, region);
        c.region = region;
      }
      if (c.move) failed = await moveOn(q, c, "the page asked");
      else if (c.readyAt) await revive(q, c, "the door did not answer");
      else await step(q, c, "sign-in");
    } catch (err) {
      // What the cloud refuses is never the page's to carry: the desktop keeps
      // drawing, the computer says it is still coming, and the refusal is
      // said in words, logged and written down, so the next ask tries
      // again. Anything else is ours and is thrown on.
      if (!(err instanceof CloudRefused)) throw err;
      console.error(`computer ${c.id}: ${err.message}`);
      await note(q, {
        orgId: c.orgId,
        userId: c.userId,
        resource: "machine",
        event: "refused",
        ref: c.machineId,
        // The status and the call, never the cloud's body: a rejected machine
        // config comes back with parts of itself in it, and that config
        // carries the door's secret, the brain's token and the person's
        // model key. The body is said to the log above and nowhere else.
        detail: { status: err.status, call: err.call },
        why: `${err.cloud} refused while the page asked after the computer`,
      });
      failed = `Your computer is taking longer than usual: ${err.cloud} answered ${err.status}. Trying again.`;
    }
    return { ...stateOf(await computerOf(q, p.userId)), failed };
  });
}

// Whether the cloud still has this disk to mount. One 404 is not enough to say
// a disk is gone — a running machine is destroyed on the answer — so the
// app's whole listing is asked before agreeing with it, and only two
// answers that agree count as gone.
async function diskThere(id: string): Promise<boolean> {
  const v =
    (await cloud.volume(id)) ??
    (await cloud.volumes()).find((x) => x.id === id) ??
    null;
  return v !== null && v.state !== "gone";
}

// Forgets a disk the cloud no longer has and makes another in its place: the
// person's Linux went with it, so their computer is made again from the
// disk up, as a first sign-in makes one.
async function forgetDisk(q: Query, c: Computer, why: string): Promise<void> {
  await clearVolume(q, c.id);
  await note(q, {
    orgId: c.orgId,
    userId: c.userId,
    resource: "disk",
    // Gone, not destroyed: the ledger says what we did, and we did not
    // take this one — the cloud no longer has it.
    event: "gone",
    ref: c.volumeId,
    why: "its disk was gone; a new one is made",
  });
  await step(q, { ...c, volumeId: null, machineId: null, readyAt: null }, why);
}

// One step: the disk, then the machine, then ready once its door answers.
// Each id is written the moment the cloud hands it back; one that cannot be
// written is destroyed on the spot, and one written but never committed
// is found again by its name, so nothing at the cloud goes unrecorded.
async function step(q: Query, c: Computer, why: string): Promise<void> {
  if (!c.volumeId) {
    const v =
      (await cloud.volumes()).find(
        (v) => v.name === volumeName(c) && v.state !== "gone",
      ) ?? (await cloud.createVolume(volumeName(c), c.region, c.diskGb));
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
      await cloud.destroyVolume(v.id).catch(() => {});
      throw err;
    }
    return;
  }
  if (!c.machineId) {
    // A disk the cloud no longer has — taken by the reap while no machine held
    // it, or by hand — is forgotten and another made in its place, before
    // a machine is asked for on a disk that is not there.
    if (!(await diskThere(c.volumeId))) return forgetDisk(q, c, why);
    let m: Machine;
    try {
      m =
        (await cloud.machines()).find(
          (m) =>
            m.name === machineName(c) &&
            m.tags.computer === c.id &&
            m.state !== "gone",
        ) ??
        (await cloud.createMachine({
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
          model: await modelOf(q, c),
          metadata: tags(c),
        }));
    } catch (err) {
      // The cloud refusing the disk says the same thing its list did not:
      // the disk is gone. Forgotten here, so the ask makes one rather than
      // asking again forever.
      if (err instanceof DiskGone) return forgetDisk(q, c, why);
      throw err;
    }
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
      await cloud.destroyMachine(m.id).catch(() => {});
      throw err;
    }
    return;
  }
  if (await door.answers(c.machineId)) await setReady(q, c.id, true);
}

// The name a computer's key carries at OpenRouter: the environment, the
// checkout, and the computer, so any list there traces back in one look
// and each deployment knows its own.
const keyPrefix = () => {
  const d = deployment.computers;
  return `maslow ${deployment.where} ${d.kind !== "none" ? (d.checkout ?? "production") : "off"} `;
};

// What the machine carries for its model calls: the gateway's address and
// a token of the computer's own. The OpenRouter key behind it is minted
// once per computer against a weekly cap in dollars, kept on its row so it
// can differ per person, and never leaves this server. Null where this
// deployment mints none; the person's own account then.
async function modelOf(
  q: Query,
  c: Computer,
): Promise<{ url: string; token: string } | null> {
  if (!(await modelKeyOf(q, c))) return null;
  return { url: modelUrl(), token: modelToken(c) };
}

async function modelKeyOf(q: Query, c: Computer): Promise<string | null> {
  const m = deployment.models;
  if (m.kind !== "openrouter") return null;
  if (c.modelKey) return c.modelKey;
  const capUsd = c.modelCapUsd ?? m.capUsd;
  const minted = await openrouter.mint(`${keyPrefix()}${c.id}`, capUsd);
  await setModelKey(q, c.id, minted.key, minted.hash, capUsd);
  await note(q, {
    orgId: c.orgId,
    userId: c.userId,
    resource: "key",
    event: "made",
    ref: minted.hash,
    detail: { capUsd, every: "week" },
    why: "the computer's Claude Code runs on it",
  });
  return minted.key;
}

// What Claude Code on the machine reaches the brain with: a session of
// the owner's, opened once for the computer and kept on its row, and an
// address. Where this deployment has one a machine can dial, that; where
// it has none, as on a laptop, the machine's own door, which the app dials
// in to and answers through.
const RELAYED = "http://127.0.0.1:8080/maslow/brain";
async function brainOf(
  q: Query,
  c: Computer,
): Promise<{ url: string; token: string } | null> {
  const d = deployment.computers;
  if (d.kind === "none") return null;
  const sessionId = c.sessionId ?? (await openComputerSession(q, c));
  return { url: d.brain ?? RELAYED, token: `${c.orgId}.${sessionId}` };
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
  const live = new Map((await cloud.machines()).map((m) => [m.id, m]));
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

// Whether the machine's door answers, asked again over the half minute a
// restart takes, so a machine is not called unready for want of waiting.
async function answersSoon(machineId: string, asks = 5): Promise<boolean> {
  for (let ask = 0; ask < asks; ask++) {
    if (await door.answers(machineId)) return true;
    await new Promise((wait) => setTimeout(wait, 4_000));
  }
  return false;
}

// How many asks a machine that is up gets before its Linux is thrown back
// onto the image of the day: about a minute, since a build pegging its
// CPU is not a machine that cannot run.
const PATIENT = 12;

// Whether the cloud still has the disk the machine boots from: the one on the
// row and the ones the machine says it mounts, since either may be the
// one that went. A machine with no disk at all mounts nothing of the
// person's and counts as without it.
async function holdsDisk(c: Computer, m: Machine): Promise<boolean> {
  const named = [c.volumeId, ...m.disks].filter((id): id is string =>
    Boolean(id),
  );
  if (named.length === 0) return false;
  for (const id of new Set(named)) if (!(await diskThere(id))) return false;
  return true;
}

// A computer the row calls ready whose door is silent, put back on its
// feet. The row says not ready until the door answers, so every other
// door of ours says so too. A machine the cloud no longer has is forgotten and
// another made; one the cloud has stopped is started again; and one behind the
// image of the day cannot run without the update — the door is in the
// image — so it takes it at once on its own disk, rather than waiting on
// a person who cannot reach it to say when. Its lease is renewed either
// way: somebody is asking after it, which outside production is the whole
// of what a lease says.
async function revive(q: Query, c: Computer, why: string): Promise<void> {
  await setReady(q, c.id, false);
  const m = c.machineId ? await cloud.machine(c.machineId) : null;
  // The cloud answers for a machine it has destroyed for a while after it is
  // gone, and a machine gone is a machine gone.
  if (!m || m.state === "gone") {
    if (c.machineId) {
      await clearMachine(q, c.id);
      await note(q, {
        orgId: c.orgId,
        userId: c.userId,
        resource: "machine",
        event: "gone",
        ref: c.machineId,
        why: "the cloud no longer has it; another is made",
      });
    }
    return;
  }
  // The disk is the person's whole Linux, and the reap takes one a day
  // after its lease lapses while the machine keeps its id. A machine
  // without its disk has nothing to boot and nothing to keep: it is a
  // machine the cloud no longer has, and is paid back so a fresh computer is
  // made as a first sign-in makes one.
  if (!(await holdsDisk(c, m))) {
    await cloud.destroyMachine(m.id);
    await note(q, {
      orgId: c.orgId,
      userId: c.userId,
      resource: "machine",
      event: "destroyed",
      ref: m.id,
      why: "its disk was gone, so it had nothing to run",
    });
    if (c.volumeId)
      await note(q, {
        orgId: c.orgId,
        userId: c.userId,
        resource: "disk",
        event: "gone",
        ref: c.volumeId,
        why: "the cloud no longer has it; another is made",
      });
    await clearVolume(q, c.id);
    return;
  }
  if (m.image !== IMAGE) {
    // A machine that is up and merely slow to answer is not a machine
    // that cannot run: it is asked again over the minute a build pegging
    // its CPU may take, since a remake restarts it and takes with it
    // everything running and any hour the person picked for the update.
    if (m.state === "running" && (await answersSoon(m.id, PATIENT))) {
      await setReady(q, c.id, true);
      return;
    }
    // The remake carries the lease on with it.
    await remake(q, c, m, `${why}, and the machine was behind the image`);
    await reopens(q, c, m.id);
    return;
  }
  if (m.tags.lease) await cloud.tag(m.id, "lease", new Date().toISOString());
  if (m.state !== "running") {
    await cloud.start(m.id);
    await note(q, {
      orgId: c.orgId,
      userId: c.userId,
      resource: "machine",
      event: "started",
      ref: m.id,
      why,
    });
  }
  if (await answersSoon(m.id)) await setReady(q, c.id, true);
}

// --- Updates -----------------------------------------------------------

// The update waiting on a person, as the menu bar, About and the Computer
// pane say it. Null when their machine is on the image of the day, and
// when an older update was overtaken by a newer image.
export type Update = { image: string; readyAt: string };

export const updateOn = (c: Computer | null): Update | null =>
  c?.updateImage === IMAGE && c.updateReadyAt
    ? { image: IMAGE, readyAt: c.updateReadyAt.toISOString() }
    : null;

// Whether a machine runs an image other than the one of the day.
const behindOn = (m: Machine) => m.image !== IMAGE;

// A new image is an update, not a restart: written on the person's row
// as ready and to which image, and waiting for them to take it. A newer
// image asks again, so nothing said about the last carries an unseen
// change on; a machine on the image of the day has nothing waiting.
async function offer(q: Query, c: Computer, m: Machine): Promise<Computer> {
  if (c.current && behindOn(m)) {
    if (c.updateImage === IMAGE) return c;
    await setUpdate(q, c.id, IMAGE);
    await note(q, {
      orgId: c.orgId,
      userId: c.userId,
      resource: "update",
      event: "ready",
      ref: IMAGE,
      detail: { was: m.image },
      why: "a new image was built",
    });
    return { ...c, updateImage: IMAGE, updateReadyAt: new Date() };
  }
  if (!c.updateImage) return c;
  await setUpdate(q, c.id, null);
  return { ...c, updateImage: null, updateReadyAt: null };
}

// The update waiting on this person, asked for by the page every few
// minutes: the machine is looked at each time, so a new image is offered
// within minutes of a deploy and nothing pushes it. The cloud is asked between
// two transactions, so no pooled connection waits on the round trip.
export async function updateOf(p: Principal): Promise<Update | null> {
  if (deployment.computers.kind === "none") return null;
  const c = await asOrg(p.orgId, (q) => computerOf(q, p.userId));
  if (!c?.readyAt || !c.machineId) return updateOn(c);
  const m = await cloud.machine(c.machineId);
  if (!m) return updateOn(c);
  return updateOn(await asOrg(p.orgId, (q) => offer(q, c, m)));
}

// The person taking the update waiting on their computer: remade onto
// the image of the day here and then. False when there is no ready
// computer or nothing waiting.
export async function take(p: Principal): Promise<boolean> {
  return asOrg(p.orgId, async (q) => {
    const c = await computerOf(q, p.userId);
    if (
      !c?.readyAt ||
      !c.machineId ||
      c.updateImage !== IMAGE ||
      !(await holdComputer(q, c.id))
    )
      return false;
    const m = await cloud.machine(c.machineId);
    if (!m) return false;
    // Reshaped and written down, and nothing waited on after it: the page
    // is already asking after the computer every few seconds and says it
    // is starting until its door answers. A route cut off mid-wait would
    // roll the row back and leave the person told to update a machine
    // that had already been.
    await remake(q, c, m, "the person pressed Update");
    return true;
  });
}

// The machine remade on its disk to the image of the day at its row's
// size, with the brain's session and the person's name.
async function remake(
  q: Query,
  c: Computer,
  m: Machine,
  why: string,
): Promise<void> {
  const shape = atLeast(c, m.size);
  await cloud.reshape(m.id, {
    image: IMAGE,
    volumeId: c.volumeId!,
    ...shape,
    secret: c.secret,
    brain: await brainOf(q, c),
    who: await whoOf(q, c),
    model: await modelOf(q, c),
    metadata: wanted(c, m),
  });
  // Written down once Fly has it, so a refused reshape leaves the row
  // saying what the machine still is.
  if (!sameShape(shape, c)) await setShape(q, c.id, shape);
  await setReady(q, c.id, false);
  // A machine remade is on the image of the day, whatever the reason, so
  // nothing is left waiting on the person for an update they now have.
  if (c.updateImage) await setUpdate(q, c.id, null);
  await note(q, {
    orgId: c.orgId,
    userId: c.userId,
    resource: "machine",
    event: "made",
    ref: m.id,
    detail: { image: IMAGE, ...shape },
    why,
  });
}

// A machine let back through once its door answers, so the person is
// blocked only while it is coming back and not until the next sweep.
// Asked after the reshape is written down, never before: a wait cut off
// mid-way leaves a row that says the machine is starting, which is true.
async function reopens(q: Query, c: Computer, machineId: string) {
  if (await answersSoon(machineId)) await setReady(q, c.id, true);
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

// The key's spend since the last sweep, into the ledger, and its ceiling
// set again where the key carries a different cap than the row's or still
// resets by the month. A key OpenRouter no longer has is forgotten and
// the machine remade with a fresh one.
async function spend(q: Query, c: Computer, m: Machine): Promise<void> {
  const models = deployment.models;
  if (models.kind !== "openrouter" || !c.modelKeyHash) return;
  const capUsd = c.modelCapUsd ?? models.capUsd;
  let total: number;
  try {
    const read = await openrouter.spent(c.modelKeyHash);
    total = read.usage;
    const off = read.limit !== capUsd;
    const monthly = read.every !== "weekly";
    if (off || monthly) {
      await openrouter.cap(c.modelKeyHash, capUsd);
      await note(q, {
        orgId: c.orgId,
        userId: c.userId,
        resource: "key",
        event: "capped",
        ref: c.modelKeyHash,
        detail: { capUsd, was: read.limit, wasEvery: read.every },
        why: monthly ? "the cap is weekly now" : "the cap changed",
      });
    }
  } catch (err) {
    if (/ answered 404:/.test((err as Error).message)) {
      await clearModelKey(q, c.id);
      await remake(
        q,
        { ...c, modelKey: null, modelKeyHash: null },
        m,
        "its key was gone",
      );
      await reopens(q, c, m.id);
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
      // The list from the cloud was made before the loop; a machine made since
      // is asked after by name before it is given up on.
      const m = c.machineId
        ? (live.get(c.machineId) ?? (await cloud.machine(c.machineId)))
        : null;
      // A machine the cloud no longer has is forgotten; a current member gets
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
      // however it was left.
      // A machine given more by hand than the row says keeps it, and one
      // under the floor is lifted to it: the row learns the size, so no
      // sweep or update shrinks it back.
      const shape = atLeast(c, m.size);
      if (!sameShape(shape, c)) {
        await setShape(q, c.id, shape);
        c = { ...c, ...shape };
      }
      const sized =
        m.size.cpuKind === c.cpuKind &&
        m.size.cpus === c.cpus &&
        m.size.memoryMb === c.memoryMb;
      const who = await whoOf(q, c);
      const named = m.env.PERSON === who.person && m.env.ORG === who.org;
      // And one made before it could reach the brain: where the address
      // comes or goes, the machine is remade holding the new one.
      const brained =
        (m.env.BRAIN_URL ?? null) === ((await brainOf(q, c))?.url ?? null);
      // A machine carries the way to our models, and never a key: remade
      // when it holds a key of ours, or a gateway address that is not the
      // one modelOf would give it now (none where this deployment mints no
      // keys). modelOf mints the row's key if it has none.
      const want = await modelOf(q, c);
      const modelled =
        m.env.MODEL_KEY === undefined &&
        (m.env.MODEL_URL ?? null) === (want?.url ?? null);
      // What the machine cannot run without is put right at once, and the
      // image of the day comes with the restart it already costs.
      if (c.current && (!sized || !named || !brained || !modelled)) {
        await remake(
          q,
          c,
          m,
          !named
            ? "the person was named"
            : !brained
              ? "the brain came within reach"
              : !modelled
                ? "the way to our models changed"
                : "the size was changed",
        );
        await reopens(q, c, m.id);
        return;
      }
      // A current member's machine that the cloud has stopped — the reap took it
      // while nobody was signed in, or the cloud did — is started again and its
      // lease renewed, since the member is here to be given it. One behind
      // the image takes the image with the start it already costs: nothing
      // is interrupted by it, and a stopped machine cannot be asked when
      // its person would like a restart.
      if (c.current && m.state === "stopped") {
        await revive(
          q,
          c,
          "the cloud had it stopped and the member is current",
        );
        return;
      }
      c = await offer(q, c, m);
      // A running machine not yet known to answer is probed at its door;
      // a stopped one was started above.
      if (!c.readyAt && c.current) {
        await step(q, c, "sweep");
        return;
      }
      if (!c.current && m.state === "running") {
        await cloud.stop(m.id);
        await note(q, {
          orgId,
          userId: c.userId,
          resource: "machine",
          event: "stopped",
          ref: m.id,
          why: "member is past",
        });
      }
      if (m.tags.lease)
        await cloud.tag(m.id, "lease", new Date().toISOString());
      if (c.readyAt && c.current && m.state === "running") {
        // The numbers once, for the disk and the size; a machine that
        // cannot be read this hour is left for the next.
        const s = await door
          .stats(c.machineId!, ticket(c, 60))
          .catch(() => null);
        if (s) {
          await grow(q, c, s);
          await remember(q, c, s);
        }
        await backUp(q, c);
        // Every copy of what they shared brought up to the disk, and a
        // colleague's save waiting on the machine taken onto it.
        try {
          await refreshShares(await ownerPrincipal(c), c);
        } catch (err) {
          console.error(`computer ${c.id}: shares: ${(err as Error).message}`);
        }
        // The keys and the public ports again every hour, so a machine
        // remade or reset has them.
        if (c.authorizedKeys)
          await door
            .pushKeys(c.machineId!, ticket(c, 60), c.authorizedKeys)
            .catch(() => {});
        await retellPublic(q, c).catch(() => {});
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
    last = await door.lastBackup(c.machineId!, ticket(c, 60));
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
  await door.askBackup(c.machineId!, ticket(c, 60), {
    url: presign(store, "PUT", key, 3 * 3600),
    key,
  });
}

// One backup of a home, as the Computer pane lists it: the object it is,
// the day it was made, and how big it is.
export type Kept = { key: string; at: string; bytes: number | null };

// A backup's key holds the moment it was made, with the colons and the dot
// a key cannot carry turned back into the ones a date has.
const madeAt = (key: string): string =>
  (key.split("/").at(-1) ?? "")
    .replace(/\.tgz$/, "")
    .replace(/-(\d\d)-(\d\d)-(\d\d\d)Z$/, ":$1:$2.$3Z");

// The backups kept of the person's home, newest first, and the restore
// under way if there is one. Null where this deployment has no bucket or
// there is no ready computer.
export async function backupsOf(
  p: Principal,
): Promise<{ kept: Kept[]; restoring: Restore | null } | null> {
  const store = deployment.storage;
  const c = await ready(p);
  if (!c || store.kind !== "s3") return null;
  const [keys, restoring] = await Promise.all([
    list(store, `${store.prefix}backups/${c.id}/`),
    door.lastRestore(c.machineId!, ticket(c, 60)).catch(() => null),
  ]);
  const kept = await Promise.all(
    keys.reverse().map(async (key) => {
      // How big it is is the store's to say; a HEAD costs nothing and
      // carries no bytes.
      const bytes = await s3(store, "HEAD", key)
        .then((r) => (r.ok ? Number(r.headers.get("content-length")) : null))
        .catch(() => null);
      return { key, at: madeAt(key), bytes };
    }),
  );
  return { kept, restoring };
}

// Fetches one backup back onto the machine, into a folder of its own in
// the home: our server signs an address to read it from, as it signs one
// to write it, and the door unpacks it there, never over what is there.
// The folder's name, or null when there is no computer, no such backup, or
// a restore is already running.
export async function restore(
  p: Principal,
  key: string,
): Promise<string | null> {
  const store = deployment.storage;
  const c = await ready(p);
  if (!c || store.kind !== "s3") return null;
  // Only their own: a key is a name anybody could type.
  const prefix = `${store.prefix}backups/${c.id}/`;
  if (!key.startsWith(prefix) || key.includes("..")) return null;
  if (!(await list(store, prefix)).includes(key)) return null;
  const name = await door.askRestore(c.machineId!, ticket(c, 60), {
    url: presign(store, "GET", key, 3 * 3600),
    key,
    into: madeAt(key).slice(0, 10),
  });
  if (name)
    await asOrg(p.orgId, (q) =>
      note(q, {
        orgId: c.orgId,
        userId: c.userId,
        resource: "backup",
        event: "restored",
        ref: key,
        detail: { into: name },
        why: "the person asked",
      }),
    );
  return name;
}

// The disk's ceiling: ours, high, never shown. Reaching it is said to us.
const DISK_CEILING_GB = 200;

// Grows a disk before it fills: past four fifths full, by half again, up
// to the ceiling, while the machine runs. The cloud says when a machine must be
// restarted to see the room, and then it is, as for a new image. A disk
// that cannot be read this time is left for the next. True when it grew.
async function grow(q: Query, c: Computer, s: Stats): Promise<boolean> {
  // The whole disk's room, ours on it included, not the person's bytes
  // alone; a machine that does not yet say is left alone.
  if (s.free == null || s.disk === null || s.free > s.disk * 0.2) return false;
  return extend(q, c, "the disk was nearly full");
}

// Memory written on the row, and a machine over four fifths of it at this
// sweep and the last is said to us: a ceiling of ours, which alerts us
// and never walls the person.
async function remember(q: Query, c: Computer, s: Stats): Promise<void> {
  const used = Math.round(s.memory.used / 1048576);
  const total = Math.round(s.memory.total / 1048576);
  await setMemory(q, c.id, used);
  const hot = (mb: number | null) => mb !== null && mb > total * 0.8;
  if (hot(used) && hot(c.memoryUsedMb))
    console.error(
      `computer ${c.id}: memory over four fifths for an hour, ${used} of ${total} MB`,
    );
  // The image is allowed two gigabytes before the person has done anything.
  if (s.idleMb !== undefined && s.idleMb > IDLE_MB)
    console.error(
      `computer ${c.id}: a fresh boot used ${s.idleMb} MB, over the ${IDLE_MB} the image is allowed`,
    );
}
const IDLE_MB = 2048;

// Grows the disk by half again, up to the ceiling; at the ceiling, says
// so to us and leaves it. True when it grew.
async function extend(q: Query, c: Computer, why: string): Promise<boolean> {
  // From the disk as the cloud has it, which is larger than the row says when
  // it was grown by hand; asking the cloud for a size it already has is refused.
  const have = Math.max(
    c.diskGb,
    (await cloud.volume(c.volumeId!))?.sizeGb ?? 0,
  );
  if (have >= DISK_CEILING_GB) {
    console.error(
      `computer ${c.id}: disk at the ceiling of ${DISK_CEILING_GB} GB, ${why}`,
    );
    return false;
  }
  const gb = Math.min(DISK_CEILING_GB, Math.ceil(have * 1.5));
  const { needsRestart } = await cloud.extendVolume(c.volumeId!, gb);
  await setDisk(q, c.id, gb);
  await note(q, {
    orgId: c.orgId,
    userId: c.userId,
    resource: "disk",
    event: "grown",
    ref: c.volumeId,
    detail: { from: have, gb, restarted: needsRestart },
    why,
  });
  if (needsRestart) {
    await cloud.restart(c.machineId!);
    await setReady(q, c.id, false);
  }
  return true;
}

// Every running computer's disk grown if it is nearly full, now: what the
// ten-minute cron asks, so a machine filling in the minutes a checkout and
// its build take is not left an hour for the sweep. Each computer is held
// as the sweep holds it, so the two never grow one disk at once; one that
// cannot be read is left for the next call. How many grew.
export async function growNow(): Promise<number> {
  if (deployment.computers.kind === "none") return 0;
  const orgs = await asMeter(async (q) =>
    (await q.query<{ id: string }>("select id from orgs")).rows.map(
      (r) => r.id,
    ),
  );
  let grown = 0;
  for (const orgId of orgs) {
    for (const c of await asOrg(orgId, allComputers)) {
      if (!c.current || !c.readyAt || !c.machineId || !c.volumeId) continue;
      try {
        await asOrg(orgId, async (q) => {
          if (!(await holdComputer(q, c.id))) return;
          const s = await door
            .stats(c.machineId!, ticket(c, 60))
            .catch(() => null);
          if (s && (await grow(q, c, s))) grown++;
        });
      } catch (err) {
        console.error(`computer ${c.id}: grow: ${(err as Error).message}`);
      }
    }
  }
  return grown;
}

// A ticket the computer's door takes: its expiry and how much of the
// machine it opens, signed with the computer's secret, which only our
// server and that machine hold. Named a port, it opens that port alone, so
// what somebody was given a port for does not become the whole computer.
// Named nothing, it opens everything, and is minted only for the owner.
export function ticket(c: Computer, seconds: number, port?: number): string {
  const exp = String(Math.floor(Date.now() / 1000) + seconds);
  const said = port === undefined ? exp : `${exp}.${port}`;
  return `${said}.${createHmac("sha256", c.secret).update(said).digest("hex")}`;
}

// The member's ready computer, or null.
export async function ready(p: Principal): Promise<Computer | null> {
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

// The person's own machine, the domain its ports are reached under, and
// who they have given each port to, for the Computer page. Null where they
// have no ready computer.
export async function sharingOf(
  p: Principal,
): Promise<{ machineId: string; domain: string; shares: PortShare[] } | null> {
  const d = deployment.computers;
  if (d.kind === "none") return null;
  return asPerson(p, async (q) => {
    const c = await computerOf(q, p.userId);
    if (!c?.readyAt || !c.machineId) return null;
    return {
      machineId: c.machineId,
      domain: d.domain,
      shares: await sharesOn(q, c.id),
    };
  });
}

// The ports other people have opened to this person, for the Computer page:
// each is a link on our own domain, the same one its owner hands out. Empty
// where this deployment has no computers.
export async function sharedWithMe(p: Principal): Promise<SharedPort[]> {
  if (deployment.computers.kind === "none") return [];
  return asPerson(p, portsReaching);
}

// Makes what one of the person's own ports reaches exactly this: anyone
// on the internet, everyone in the org, or some groups and some people.
// Nobody outside the org can be named, since the database refuses a member
// or a group of another org, and there is no level to give, only the port.
// The apps the person has published from their computer's ports, in the
// order of their shelf; none where they have no computer.
export async function publishedOf(p: Principal): Promise<PublishedApp[]> {
  if (deployment.computers.kind === "none") return [];
  return asPerson(p, async (q) => {
    const c = await computerOf(q, p.userId);
    return c ? appsOn(q, c.id) : [];
  });
}

// Publishes one of the person's ports as an app, with the name and face
// they settled on, or takes one off; arranges their shelf. Each refuses,
// in words, what it cannot do.
export async function publish(
  p: Principal,
  port: number,
  as: { name: string; icon: string | null } | null,
): Promise<string | null> {
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return "That is not a port.";
  const name = as?.name.trim().slice(0, 120) ?? "";
  if (as && !name) return "An app has a name.";
  if (as?.icon && (as.icon.length > 65536 || !/^data:image\//.test(as.icon)))
    return "That is not a picture an app can wear.";
  return asPerson(p, async (q) => {
    const c = await computerOf(q, p.userId);
    if (!c?.readyAt || !c.machineId) return "Your computer is not ready.";
    if (as) await publishApp(q, c.id, port, name, as.icon);
    else await unpublishApp(q, c.id, port);
    return null;
  });
}
export async function arrange(
  p: Principal,
  hrefs: string[],
): Promise<string | null> {
  return asPerson(p, async (q) => {
    const c = await computerOf(q, p.userId);
    if (!c?.machineId) return "You have no computer yet.";
    const own = new RegExp(`^/port/${c.machineId}/(\\d{1,5})$`);
    const ports = hrefs
      .map((h) => Number(own.exec(h)?.[1]))
      .filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
    await arrangeApps(q, c.id, ports);
    return null;
  });
}

export async function share(
  p: Principal,
  port: number,
  to: {
    public: boolean;
    everyone: boolean;
    groupIds: string[];
    memberIds: string[];
  },
  // Answers whether the share landed and, where the door could not be told
  // of a public port, says so, since the share stands and the door hears of
  // it within the hour.
): Promise<"told" | "untold" | false> {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  const shared = await asPerson(p, async (q) => {
    const c = await computerOf(q, p.userId);
    // A port is shared only once the computer is ready, so nothing is given
    // away before there is a machine to open at all.
    if (!c?.readyAt || !c.machineId) return false;
    await sharePort(q, c.id, port, to);
    return true;
  });
  if (!shared) return false;
  return (await tellPublic(p)) ? "told" : "untold";
}

// Tells the person's computer's door which of its ports are open to
// anyone: the door lets those through with no ticket, so it has to hear
// of every change, and hears the whole list each time, read after the
// change committed so a change still in flight is never told. Whether
// a door took it; one that could not be reached, or a computer with no
// machine to tell, hears within the hour.
export async function tellPublic(p: Principal): Promise<boolean> {
  try {
    return await asPerson(p, async (q) => {
      const c = await computerOf(q, p.userId);
      return c ? retellPublic(q, c) : false;
    });
  } catch (err) {
    console.error(`public ports: ${(err as Error).message}`);
    return false;
  }
}

// The whole list to the door, as the rows have it now, with its number;
// whether there was a machine to tell.
async function retellPublic(q: Query, c: Computer): Promise<boolean> {
  if (!c.machineId) return false;
  await door.publicPorts(
    c.machineId,
    ticket(c, 60),
    await publicPortsOn(q, c.id),
  );
  return true;
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
  pdf(at: string): Promise<Response>;
  // Written whole, or added to the end, which keeps what anyone wrote
  // to it meanwhile. Told when the file was last changed as it was
  // opened, a save of a file changed since is refused with Changed.
  write(
    at: string,
    body: string,
    append?: boolean,
    opened?: string,
  ): Promise<{ size: number; modified: string }>;
  // A new name, or a new place when the name is a path.
  rename(at: string, to: string): Promise<Entry>;
  // Into the Trash of the person's Linux.
  trash(at: string): Promise<{ name: string }>;
  // A folder in a folder, named as asked or as the Finder would.
  mkdir(at: string, name?: string): Promise<Entry>;
} | null> {
  const c = await ready(p);
  if (!c) return null;
  const m = c.machineId!;
  const t = () => ticket(c, 60);
  return {
    list: (at) => door.files.list(m, t(), at),
    read: (at, range) => door.files.read(m, t(), at, range),
    preview: (at) => door.files.preview(m, t(), at),
    pdf: (at) => door.files.pdf(m, t(), at),
    write: (at, body, append, opened) =>
      door.files.write(m, t(), at, body, append, opened),
    rename: (at, to) => door.files.rename(m, t(), at, to),
    trash: (at) => door.files.trash(m, t(), at),
    mkdir: (at, name) => door.files.mkdir(m, t(), at, name),
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
  if (d.kind === "none") return null;
  const c = (await ready(p)) ?? (await awoken(p));
  if (!c) return null;
  return {
    door: `wss://${c.machineId}.${d.domain}`,
    ticket: ticket(c, 3600),
  };
}

// A computer whose row an update or a restart reset, ready again the
// moment its door answers: the desktop alone asks nothing else that would
// find it, and a person's pets should not wait on a page that polls.
async function awoken(p: Principal): Promise<Computer | null> {
  const c = await asOrg(p.orgId, (q) => computerOf(q, p.userId));
  if (!c?.machineId || c.readyAt || c.move || !(await doorAnswers(c)))
    return null;
  await asOrg(p.orgId, (q) => setReady(q, c.id, true));
  return { ...c, readyAt: new Date() };
}

// Where the person's browser sends their location: the machine's own
// door, with a ticket for the whole machine good for an hour, so a
// position read every minute mints a fresh ticket only once the last one
// is spent. Null where there is no ready computer.
export async function locationTarget(
  p: Principal,
): Promise<{ door: string; ticket: string } | null> {
  const d = deployment.computers;
  const c = await ready(p);
  if (!c || d.kind === "none") return null;
  return {
    door: `https://${c.machineId}.${d.domain}/maslow/location`,
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
  await door.askReset(c.machineId!, ticket(c, 60));
  await cloud.restart(c.machineId!);
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

// A move that has run this long is put back, whatever step it is on.
const MOVE_LIMIT = 30 * 60 * 1000;

// Starts moving a ready computer to a region, at the person's own ask and
// never otherwise: the row says so, and the page then asks after it step
// by step until it runs there or is back where it was. False when there
// is no ready computer; true at once when it is there already.
export async function move(p: Principal, to: string): Promise<boolean> {
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
// moment the cloud hands it back, so a call cut off anywhere is taken up by the
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
      await cloud.destroyMachine(m.old.machineId);
      await say("machine", "destroyed", m.old.machineId);
      await cloud.destroyVolume(m.old.volumeId);
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
      const old = await cloud.machine(c.machineId!);
      if (!old) throw new Error("the machine is gone");
      if (old.state === "running") {
        await cloud.stop(old.id);
        await say("machine", "stopped", old.id);
      }
      if (!(await cloud.stopped(old.id, 20))) return null;
      await cloud.keepSnapshots(c.volumeId!, 1);
      const s = await cloud.snapshot(c.volumeId!);
      await on({ snapshotId: s.id });
      await say("snapshot", "made", s.id, {
        disk: c.volumeId,
        region: c.region,
        keptDays: 1,
      });
      return null;
    }
    if (!m.volumeId) {
      const s = (await cloud.snapshots(c.volumeId!)).find(
        (s) => s.id === m.snapshotId,
      );
      if (!s) throw new Error("the snapshot is gone");
      if (!s.ready) return null;
      const v =
        (await cloud.volumes()).find(
          (v) => v.name === volumeName(c) && v.region === m.to,
        ) ?? (await cloud.restoreVolume(volumeName(c), m.to, c.diskGb, s.id));
      await on({ volumeId: v.id });
      await say("disk", "made", v.id, {
        region: m.to,
        gb: c.diskGb,
        snapshot: s.id,
      });
      return null;
    }
    if (!m.machineId) {
      const v = await cloud.volume(m.volumeId);
      if (!v) throw new Error("the new disk is gone");
      if (v.state !== "ready") return null;
      const name = `${machineName(c)}-${m.to}`;
      const made =
        (await cloud.machines()).find(
          (x) => x.name === name && x.tags.computer === c.id,
        ) ??
        (await cloud.createMachine({
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
          model: await modelOf(q, c),
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
    if (!(await door.answers(m.machineId))) return null;
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
    // the cloud, and the next call pays it.
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
    await cloud.destroyMachine(m.machineId);
    await say("machine", "destroyed", m.machineId);
  }
  if (m.volumeId) {
    await cloud.destroyVolume(m.volumeId);
    await say("disk", "destroyed", m.volumeId);
  }
  await cloud.start(c.machineId!);
  await say("machine", "started", c.machineId!);
  await setMove(q, c.id, null);
}

// Gives a ready computer's machine the keys that open it over SSH, as the
// row has them. Nothing when it is not ready; the sweep gives them then.
export async function pushKeys(p: Principal): Promise<void> {
  const c = await ready(p);
  if (!c) return;
  await door.pushKeys(c.machineId!, ticket(c, 60), c.authorizedKeys);
}

// What a person has spent on models, in dollars: this week against their
// cap, the day it turns over, every day the ledger holds, and what each
// model took. Nothing here is faked; a deployment that mints no keys has
// no answer at all.
export type Usage = {
  spentUsd: number;
  capUsd: number;
  resetsAt: string;
  days: { day: string; usd: number }[];
  models: { model: string; usd: number }[];
};

// OpenRouter's weekly window turns on Monday at 00:00 UTC; the ceiling on
// the key resets with it.
function nextMonday(): Date {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d;
}

// The vendor is asked once a minute for each person; a pane opened twice
// in that minute reads the same answer.
const usages = new Map<string, { at: number; usage: Promise<Usage | null> }>();
export function usageOf(p: Principal): Promise<Usage | null> {
  const held = usages.get(p.userId);
  if (held && Date.now() - held.at < 60_000) return held.usage;
  const usage = readUsage(p).catch((err: Error) => {
    usages.delete(p.userId);
    throw err;
  });
  usages.set(p.userId, { at: Date.now(), usage });
  return usage;
}

async function readUsage(p: Principal): Promise<Usage | null> {
  const m = deployment.models;
  if (m.kind !== "openrouter") return null;
  const c =
    deployment.computers.kind === "none"
      ? null
      : await asOrg(p.orgId, (q) => computerOf(q, p.userId));
  const capUsd = c?.modelCapUsd ?? m.capUsd;
  const resetsAt = nextMonday().toISOString();
  if (!c?.modelKeyHash)
    return { spentUsd: 0, capUsd, resetsAt, days: [], models: [] };
  const year = new Date();
  year.setUTCFullYear(year.getUTCFullYear() - 1);
  const [read, days, called] = await Promise.all([
    openrouter.spent(c.modelKeyHash),
    asOrg(p.orgId, (q) => spentByDay(q, p.userId, year)),
    // The activity of one key, which OpenRouter answers per model per day.
    openrouter.activity(c.modelKeyHash).catch(() => []),
  ]);
  const byModel = new Map<string, number>();
  for (const a of called)
    byModel.set(a.model, (byModel.get(a.model) ?? 0) + a.usd);
  return {
    spentUsd: read.week,
    capUsd: read.limit ?? capUsd,
    resetsAt,
    days,
    models: [...byModel]
      .map(([model, usd]) => ({ model, usd }))
      .sort((a, b) => b.usd - a.usd),
  };
}

// The way in from the person's own terminal: the computer's name, which
// is both its hostname and `ssh`'s word for it; the one command that
// sets a Mac up to reach it, carrying a ticket good for an hour so the
// script it fetches knows whose computer; and whether a key opens it
// yet. Null until it is ready.
export async function sshOf(
  p: Principal,
  site: string,
): Promise<{ name: string; command: string } | null> {
  const c = await ready(p);
  if (!c) return null;
  const { org } = await asOrg(p.orgId, (q) => whoOf(q, c));
  const link = `${site}/ssh/setup?o=${c.orgId}&c=${c.machineId}&t=${ticket(c, 3600)}`;
  return { name: org, command: `curl -fsSL "${link}" | sh` };
}

// One public key per line, as ssh-keygen writes it: the kind, the key,
// and a comment if any.
const SSH_KEY =
  /^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+=*( [^\r\n]*)?$/;

// The keys that open a computer as the pane lists them: each named by the
// comment ssh-keygen wrote, the Mac's user and name, or by its kind, and
// told apart by the fingerprint ssh prints.
export function sshKeysOf(
  text: string,
): { line: string; name: string; fingerprint: string }[] {
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [kind, key, ...comment] = line.split(" ");
      const digest = createHash("sha256")
        .update(Buffer.from(key ?? "", "base64"))
        .digest("base64")
        .replace(/=+$/, "");
      return {
        line,
        name: comment.join(" ") || kind!,
        fingerprint: `SHA256:${digest}`,
      };
    });
}

// Adds a Mac's public key to the ones that open the computer, on the same
// link its setup script was fetched with, and gives the machine the keys
// as the database now holds them. A key already there is left as it is.
// Says what went wrong when the key is not on the machine: a machine that
// did not answer keeps the key in Settings and takes it the next time
// keys are pushed, at its next start or on the next run of the script.
export async function addSshKey(
  orgId: string,
  machineId: string,
  t: string,
  key: string,
): Promise<"added" | "stale" | "invalid" | "full" | "unreached"> {
  const d = deployment.computers;
  if (d.kind === "none" || !/^[0-9a-f-]{36}$/.test(orgId)) return "stale";
  const c = await asOrg(orgId, (q) => computerByMachine(q, machineId));
  if (!c || !honours(c, t)) return "stale";
  const line = key.trim();
  if (!SSH_KEY.test(line)) return "invalid";
  const keys = await asOrg(orgId, (q) => addKey(q, c.id, line));
  if (!keys.includes(line.split(" ").slice(0, 2).join(" "))) return "full";
  try {
    await door.pushKeys(c.machineId!, ticket(c, 60), keys);
  } catch (err) {
    console.error(`keys: ${(err as Error).message}`);
    return "unreached";
  }
  return "added";
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

// An ask answered, said back into the conversation it came from on the
// person's computer, where it named one: the question and the answer, as
// the next word of that conversation. Nothing waits on it; a computer
// that is not ready, or a door that does not answer, leaves the answer
// for the agent's own notifications tool to read.
export async function tellAnswer(p: Principal, id: string): Promise<void> {
  const n = await asPerson(p, (q) => notificationOf(q, id));
  if (!n?.replyTo || n.answer === null) return;
  const c = await ready(p);
  if (!c) return;
  await door
    .say(c.machineId!, ticket(c, 60), {
      chat: n.replyTo,
      text: `You asked "${n.title}"; the person answered: ${n.answer}`,
      answered: n.id,
    })
    .catch((err: Error) => console.error(`say ${c.id}: ${err.message}`));
}

// The computer's numbers this moment, asked of its door with a ticket
// good for a minute. Null until it is ready.
export async function statsOf(p: Principal): Promise<Stats | null> {
  const c = await ready(p);
  if (!c) return null;
  return door.stats(c.machineId!, ticket(c, 60));
}

// How long Maslow takes to reach the computer's door and back, in
// milliseconds. Null until it is ready.
export async function pingOf(p: Principal): Promise<number | null> {
  const c = await ready(p);
  if (!c) return null;
  return door.ping(c.machineId!);
}

// Pays a purged member's or a deleted org's computer back to the cloud: the
// machine, then the disk, each written to the ledger as it goes. The ref
// names both; the member is gone, so the row says the org alone.
export async function destroy(orgId: string, ref: string): Promise<void> {
  const [machineId, volumeId] = ref.split(":");
  if (machineId) {
    await cloud.destroyMachine(machineId);
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
    await cloud.destroyVolume(volumeId);
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
