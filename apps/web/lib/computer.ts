import type { Principal } from "@placeholder/db/auth";
import {
  clearMachine,
  clearVolume,
  computerOf,
  computerOfIn,
  computersAllowed,
  computersAllowedIn,
  growthsToday,
  KEPT,
  lastResizeIn,
  lease,
  leaseIn,
  noteEvent,
  noteEventsIn,
  noteState,
  principalIn,
  release,
  reserveComputer,
  resize,
  secretOf,
  setDiskGb,
  setMachine,
  setOff,
  setVolume,
  type Cause,
  type Computer,
} from "@placeholder/db/computers";
import { randomBytes, randomUUID } from "node:crypto";

import { deployment } from "./deployment.ts";
import {
  autostops,
  DISK_GB,
  fly,
  IMAGE,
  MAX_DISK_GB,
  volumeName,
  type Machine,
} from "./fly.ts";
import { LADDER } from "./prices.ts";

export type Built =
  "built" | "gone" | "exists" | "off" | "not-allowed" | "powered-off";

// What a change of size came to: done; the new size could not be placed
// and the machine is back at the one that worked; already at the top of
// the ladder; the row held by another change; powered off; or an org with
// no computers.
export type Resized =
  | "done"
  | "gone"
  | "unplaceable"
  | "top"
  | "busy"
  | "powered-off"
  | "not-allowed";

// A Fly thing made and then not recorded, that Fly would not take back:
// it is billed until the sweep's reconcile finds it, and that is said.
export const unpaid = (what: "machine" | "volume") => (err: Error) =>
  console.error(`fly: an unrecorded ${what} would not go: ${err.message}`);

// A person has a filesystem from the moment they have an account: the
// volume is the computer. The row is claimed first, so two requests at
// once make one; each Fly id is written as soon as it exists; a step that
// failed is resumed by the next look.
export async function ensureFilesystem(p: Principal): Promise<Computer | null> {
  if (deployment.computers.kind === "none") return null;
  if (!(await computersAllowed(p))) return null;
  let c = await computerOf(p);
  if (!c) {
    await reserveComputer(p, {
      id: randomUUID(),
      region: deployment.computers.region,
      size: LADDER[0]!,
      diskGb: DISK_GB,
      secret: randomBytes(24).toString("base64url"),
    });
    c = (await computerOf(p))!;
  }
  const held = c.volumeId ? null : await lease(p, c.id);
  if (held) {
    try {
      // Read again under the lease: another request may have made it.
      c = (await computerOf(p))!;
      if (!c.volumeId) {
        const size = c.diskGb;
        const volume = await fly.createVolume(volumeName(c.id), size);
        try {
          await setVolume(p, c, volume.id, size);
        } catch (err) {
          // Unrecorded is unbilled by us and billed by Fly: it goes at once.
          await fly.destroyVolume(volume.id).catch(unpaid("volume"));
          throw err;
        }
        c.volumeId = volume.id;
        c.diskGb = size;
      }
    } finally {
      await release(p.orgId, c.id, held);
    }
  }
  return c;
}

// Attaches compute to the filesystem and starts it: a machine on the
// volume at the row's size, recorded, placed, then started, since a
// person's machine runs from the moment it is made until they power it
// off. Looks that race wait for the one that holds the lease.
export async function build(p: Principal): Promise<Built> {
  if (deployment.computers.kind === "none") return "off";
  let c = await ensureFilesystem(p);
  if (!c) return "not-allowed";
  if (c.offAt) return "powered-off";
  if (!c.volumeId) return "exists";
  if (c.machineId && c.state !== "failed") return "exists";
  const held = await lease(p, c.id);
  if (!held) return "exists";
  try {
    c = (await computerOf(p))!;
    if (c.offAt) return "powered-off";
    // The org's switch as it is under the lease: one turned off while this
    // look was deciding must not be given a machine by it.
    if (!(await computersAllowed(p))) return "not-allowed";
    if (c.machineId && c.state !== "failed") return "exists";
    // A machine whose build failed is let go of, and a new one made; one
    // that will not go stays on the row, and the next look tries again.
    if (c.machineId) {
      await fly.destroyMachine(c.machineId);
      await noteState(p.orgId, c, "destroyed");
      await clearMachine(p.orgId, c.id, c.machineId);
      c.machineId = null;
    }
    let machine;
    try {
      machine = await fly.createMachine(
        c.id,
        c.volumeId!,
        await secretOf(p, c.id),
        c.size,
      );
    } catch (err) {
      // A volume Fly no longer has: the row forgets it, and the next
      // look makes a new filesystem. A laptop's is purged every night.
      if (
        /volume[^"]*(not found|does not exist|no such)/i.test(
          (err as Error).message,
        )
      ) {
        await noteState(p.orgId, c, "volume-gone");
        await clearVolume(p.orgId, c.id, c.volumeId!);
        return "exists";
      }
      throw err;
    }
    let recorded = false;
    try {
      recorded = await setMachine(p.orgId, c.id, machine.id);
    } finally {
      // Unrecorded is unbilled by us and billed by Fly: it goes at once.
      if (!recorded)
        await fly.destroyMachine(machine.id).catch(unpaid("machine"));
    }
    if (!recorded) return "exists";
    c.machineId = machine.id;
    await fly.placed(c.machineId);
    await noteEvent(p.orgId, c, "start");
    await fly.start(c.machineId);
    await settledState(p.orgId, c);
    // Settling forgets a machine Fly no longer has: made and gone is not
    // built, and the caller says so rather than reporting a computer that
    // is not there. The next look makes another on the same disk.
    return c.machineId ? "built" : "gone";
  } catch (err) {
    // A machine that exists and failed is on the record as such, for the
    // meter and the next look; a build that made none leaves no state.
    if (c.machineId) await noteState(p.orgId, c, "failed");
    throw err;
  } finally {
    await release(p.orgId, c.id, held);
  }
}

// At sign-in, behind the response: the filesystem and a running machine,
// where this deployment and org have computers and the person has not
// powered theirs off; one Fly stopped is started. Fly being down never
// keeps anyone out; the next look tries again.
export async function computerAtSignIn(p: Principal): Promise<void> {
  try {
    const c = await ensureFilesystem(p);
    if (c) await upholdIn(p.orgId, c);
  } catch (err) {
    console.error(`computer at sign-in: ${(err as Error).message}`);
  }
}

// A machine that is not running and could be started: made and never
// started, stopped, or suspended.
const isOff = (m: Machine) =>
  m.state === "created" || m.state === "stopped" || m.state === "suspended";

// Starts a machine Fly stopped, the ask on the record first.
async function start(orgId: string, c: Computer): Promise<void> {
  const held = await leaseIn(orgId, c.id);
  if (!held) return;
  try {
    const fresh = await computerOfIn(orgId, c.id);
    if (!fresh?.machineId || fresh.offAt) return;
    if (!(await computersAllowedIn(orgId))) return;
    // One Fly has not placed yet cannot be started until it is.
    await fly.placed(fresh.machineId);
    await noteEvent(orgId, fresh, "start");
    await fly.start(fresh.machineId);
    await settledState(orgId, fresh);
  } finally {
    await release(orgId, c.id, held);
  }
}

// What Fly settles on, on the record. A state Fly is still moving through
// is neither on nor off, so it is waited for rather than written; a machine
// Fly no longer has is destroyed, never invented as running.
const SETTLING = new Set([
  "created",
  "starting",
  "stopping",
  "suspending",
  "replacing",
  "destroying",
]);
async function settledState(orgId: string, c: Computer): Promise<void> {
  let m = await fly.machine(c.machineId!);
  for (let i = 0; i < 20 && m && SETTLING.has(m.state); i++) {
    await new Promise((r) => setTimeout(r, 500));
    m = await fly.machine(c.machineId!);
  }
  if (m?.events) await noteEventsIn(orgId, c, m.events);
  if (m && SETTLING.has(m.state)) return;
  if (m) return noteState(orgId, c, m.state);
  // Gone: the row forgets it, so the next look makes compute again on the
  // same filesystem rather than believing in a machine that is not there.
  const gone = c.machineId!;
  await clearMachine(orgId, c.id, gone);
  c.machineId = null;
  await noteState(orgId, c, "destroyed");
}

// Powers the person's computer off: the machine goes, at once and for as
// long as they like, and the disk stays. Busy when a build or a resize
// holds the row; asked again in a moment, it goes.
export async function powerOff(p: Principal): Promise<"off" | "busy"> {
  let c = await computerOf(p);
  if (!c) return "off";
  const held = await lease(p, c.id);
  if (!held) return "busy";
  try {
    c = (await computerOf(p))!;
    await noteEvent(p.orgId, c, "powered-off");
    // The row says off before the machine goes. A destroy that fails
    // leaves a machine the sweep finishes off within the hour; a row that
    // was never marked off would have the sweep build a new machine and
    // undo the person's word.
    await setOff(p, c.id, true);
    if (c.machineId) await letGo(p.orgId, c);
  } finally {
    await release(p.orgId, c.id, held);
  }
  return "off";
}

// What the row says of the person's computer, and the only rule powerOn
// answers by: powered off is off, whoever set it; a row with no machine is
// one that did not come up; a machine on a row that is not off is on.
async function standing(p: Principal): Promise<"on" | "gone" | "off"> {
  const c = await computerOf(p);
  if (!c || c.offAt) return "off";
  return c.machineId ? "on" : "gone";
}

// Powers it on again: compute on the same disk, running.
export async function powerOn(
  p: Principal,
): Promise<"on" | "gone" | "busy" | "not-allowed" | "off"> {
  if (deployment.computers.kind === "none") return "not-allowed";
  if (!(await computersAllowed(p))) return "not-allowed";
  const c = await computerOf(p);
  if (c?.offAt) {
    const held = await lease(p, c.id);
    // Somebody else holds the row. A person who pressed twice is told it
    // is on once the row says so — powered on, with a machine; whichever
    // other way it is being taken, they are asked to try again rather than
    // told anything the row does not say.
    if (!held) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if ((await standing(p)) === "on") return "on";
      }
      return "busy";
    }
    try {
      const fresh = (await computerOf(p))!;
      if (fresh.offAt) {
        await noteEvent(p.orgId, fresh, "powered-on");
        await setOff(p, fresh.id, false);
      }
    } finally {
      await release(p.orgId, c.id, held);
    }
  }
  // Made if it is missing, started if Fly stopped it: the same answer the
  // sweep gives.
  const fresh = (await computerOf(p)) ?? (await ensureFilesystem(p));
  if (!fresh) return "not-allowed";
  await upholdIn(p.orgId, fresh);
  // The look is the one that decides, and it reads the switch itself: an
  // org turned off meanwhile has its machine stopped by that same look, so
  // the answer is the switch's, not the press's.
  if (!(await computersAllowed(p))) return "not-allowed";
  return standing(p);
}

// The machine goes, its stops on the record at Fly's own time first, so
// the meter stops where it stopped. Under the lease.
async function letGo(orgId: string, c: Computer): Promise<void> {
  const machineId = c.machineId!;
  const m = await fly.machine(machineId);
  if (m?.events) await noteEventsIn(orgId, c, m.events);
  await fly.destroyMachine(machineId);
  // The row forgets it before the destroy is recorded, so a report already
  // in flight cannot land after it and turn the meter back on.
  await clearMachine(orgId, c.id, machineId);
  c.machineId = null;
  await noteState(orgId, c, "destroyed");
}

// The ladder's word on a machine, from its last reports. Up is aggressive:
// one report with under a quarter of memory free, or load over the cores
// at two in a row, or anything killed for want of memory, wants the next
// rung — two rungs when under a tenth was free — at the next quiet moment,
// and at once after a kill. Down is conservative: three hours in which
// every report had over seven tenths free and load under a fifth, none of
// them within three hours of the last change of size, allows the rung
// below, one at a time, never below the first. A quiet moment is a fresh
// report with no terminal open and load under a half for its minute.
export type Sizing = {
  up: string | null;
  down: string | null;
  urgent: boolean;
  quiet: boolean;
};
const SHORT = 0.25;
const STARVED = 0.1;
const BUSY = 1;
const SPARE = 0.7;
const IDLE = 0.2;
const QUIET = 0.5;
const SETTLED = 3 * 3600_000;
// A machine may not be sized twice inside this, whatever it reports.
const COOLDOWN = 30 * 60_000;
const FRESH = 10 * 60_000;
export function sizing(
  c: Pick<Computer, "size" | "need" | "seenAt">,
  lastResizeAt: Date | null,
  now = new Date(),
): Sizing {
  const rung = LADDER.indexOf(c.size);
  const free = c.need?.memory?.free ?? [];
  const load = c.need?.load ?? [];
  const reports = c.need?.reports ?? [];
  const freeAt = c.need?.memory?.at ?? [];
  const loadAt = c.need?.loadAt ?? [];
  const since = (ms: number) =>
    !lastResizeAt || now.getTime() - lastResizeAt.getTime() >= ms;
  const lastFree = free.at(-1) ?? 1;
  const urgent = (c.need?.oom ?? 0) > 0;
  const short =
    urgent || lastFree < SHORT || (load.at(-1)! > BUSY && load.at(-2)! > BUSY);
  const up =
    rung >= 0 && rung < LADDER.length - 1 && short && since(COOLDOWN)
      ? LADDER[
          Math.min(rung + (lastFree < STARVED ? 2 : 1), LADDER.length - 1)
        ]!
      : null;
  // Three hours of them, and three hours of each figure the way down rests
  // on: a burst of reports in a minute says nothing about the hours it
  // claims to speak for, and neither does a figure the last hours' reports
  // left out.
  const spans = (at: string[]) =>
    at.length >= KEPT && now.getTime() - new Date(at[0]!).getTime() >= SETTLED;
  const spare =
    spans(reports) &&
    spans(freeAt) &&
    free.every((f) => f > SPARE) &&
    spans(loadAt) &&
    load.every((l) => l < IDLE);
  const down =
    rung > 0 && !urgent && since(SETTLED) && spare ? LADDER[rung - 1]! : null;
  const fresh = c.seenAt !== null && now.getTime() - c.seenAt.getTime() < FRESH;
  // A machine that has not said how many terminals are open is not known
  // to be quiet, and one with a file still landing is not quiet: a cold
  // boot would take the pull with it.
  const quiet =
    fresh &&
    c.need?.terminals === 0 &&
    (c.need?.landings ?? 0) === 0 &&
    (load.at(-1) ?? 0) < QUIET;
  return { up, down, urgent, quiet };
}

// Acts on the ladder's word after a report, or for the sweep: up at a
// quiet moment or at once after a kill, down at a quiet moment.
export async function sizeIn(orgId: string, c: Computer): Promise<void> {
  if (deployment.computers.kind === "none" || !c.machineId || c.offAt) return;
  const last = await lastResizeIn(orgId, c.id);
  const s = sizing(c, last?.at ?? null);
  const size = s.up ?? s.down;
  // Nothing about a machine being short of memory justifies taking memory
  // away from it while it is busy, so only a rung up may skip the wait.
  if (!size || !(s.up ? s.urgent || s.quiet : s.quiet)) return;
  const p = await principalIn(orgId, c.userId);
  if (!p) return;
  await replace(
    p,
    c,
    size,
    s.up ? (s.urgent ? "out-of-memory" : "short-of-memory") : "room-to-spare",
    c.size,
  );
}

// The person asked for more memory now: the next rung, at once.
export async function askBigger(p: Principal): Promise<Resized> {
  const c = await computerOf(p);
  if (!c) return "powered-off";
  const rung = LADDER.indexOf(c.size);
  const size = LADDER[rung + 1];
  if (!size) return "top";
  return replace(p, c, size, "asked-bigger", c.size);
}

// A cold boot at another size on the same disk: the reason on the record,
// the machine let go of with its stops at Fly's own time, the new size
// written, then a machine made at it and started. Never while the org's
// computers are off or the person's is powered off.
async function replace(
  p: Principal,
  c: Computer,
  size: string,
  why: Cause,
  from: string,
): Promise<Resized> {
  if (!(await computersAllowed(p))) return "not-allowed";
  const held = await lease(p, c.id);
  if (!held) return "busy";
  try {
    c = (await computerOf(p))!;
    if (c.offAt) return "powered-off";
    // The size the change was decided at: someone else changing it
    // meanwhile drops this decision rather than undoing theirs.
    if (c.size !== from || c.size === size) return "busy";
    await noteEvent(p.orgId, c, why);
    if (c.machineId) await letGo(p.orgId, c);
    await resize(p, c, size);
  } finally {
    await release(p.orgId, c.id, held);
  }
  let built: Built;
  try {
    built = await build(p);
  } catch (err) {
    // A rung Fly cannot give us must not take the person's computer away:
    // the row goes back to the size that worked and is built at it, and
    // the person is told which size they are on. Anything else — Fly
    // down, a start that failed — leaves the new size for the next look
    // to build, and is not swallowed.
    if (!unplaceable(err as Error)) throw err;
    console.error(
      `resize ${c.id} to ${size}: ${(err as Error).message}; back to ${from}`,
    );
    await rollBack(p, c.id, size, from);
    return "unplaceable";
  }
  return built === "gone" ? "gone" : "done";
}

// What Fly says when it has no machine of that size to give.
const unplaceable = (err: Error) =>
  /capacity|no such volume|not placed within a minute|unavailable|exhausted/i.test(
    err.message,
  );

// Back to the size that worked, under the lease and only while the row is
// still on the size that failed, so a newer change of size is not undone.
async function rollBack(
  p: Principal,
  id: string,
  size: string,
  from: string,
): Promise<void> {
  const held = await leaseIn(p.orgId, id);
  if (!held) return;
  try {
    const back = await computerOfIn(p.orgId, id);
    if (back?.size !== size) return;
    await resize(p, back, from);
  } finally {
    await release(p.orgId, id, held);
  }
  await build(p);
}

// The sweep's word on one computer. What Fly did to the machine since goes
// on the record, and one Fly no longer has is forgotten. One that should
// be running — the org's computers on, the person's not powered off, the
// membership live — is made if it is missing, replaced if it is on an old
// image or, once off, if it would stop itself for idleness, started if Fly
// stopped it, and sized if its reports say so. One that should not be
// running is stopped, and one powered off is let go of.
export async function upholdIn(orgId: string, c: Computer): Promise<void> {
  // Read again: the copy the sweep is walking may be minutes old, and the
  // person may have powered theirs off since, or the owner turned the
  // org's computers off.
  c = (await computerOfIn(orgId, c.id)) ?? c;
  const orgOn = await computersAllowedIn(orgId);
  let m = c.machineId ? await fly.machine(c.machineId) : null;
  if (m?.events) await noteEventsIn(orgId, c, m.events);
  if (c.machineId && !m) {
    await clearMachine(orgId, c.id, c.machineId);
    c.machineId = null;
    await noteState(orgId, c, "destroyed");
  }
  const p = await principalIn(orgId, c.userId);
  if (!(orgOn && !c.offAt && p)) {
    // Powered off by the person, yet a machine still stands: a power-off
    // that failed partway finishes here.
    if (m && c.offAt) {
      const held = await leaseIn(orgId, c.id);
      if (!held) return;
      try {
        // The row as it is under the lease decides: a power-on that landed
        // while this look was reading Fly is not undone by it.
        const fresh = await computerOfIn(orgId, c.id);
        if (fresh?.offAt && fresh.machineId === m.id) await letGo(orgId, fresh);
      } finally {
        await release(orgId, c.id, held);
      }
      return;
    }
    // The stop goes on the record as it is taken, so the meter closes the
    // stretch there rather than where Fly's own record of it is first
    // read, an hour later.
    if (m && (m.state === "started" || m.state === "starting")) {
      await fly.stop(m.id);
      // Recorded once Fly has taken the stop, so a refusal never closes
      // the ledger on a machine that is still running.
      await noteEvent(orgId, c, "stop");
      await settledState(orgId, c);
    } else if (m) await noteState(orgId, c, m.state);
    return;
  }
  const off = m !== null && isOff(m);
  // One on an image that is not the image answers no link of ours, so it
  // goes whatever it is doing; one that would stop itself for idleness
  // goes once it has; one Fly has failed will never run again. One that
  // will not go stays on the row, and the next sweep tries again.
  const stale =
    m !== null &&
    ((m.config?.image !== undefined && m.config.image !== IMAGE) ||
      m.state === "failed" ||
      (autostops(m) && off));
  if (m && stale) {
    console.log(
      `machine ${m.id} is ${m.state} on ${m.config?.image}; replaced`,
    );
    // Under the lease, so a build or a resize in flight is never left
    // holding a machine this look destroyed.
    const held = await leaseIn(orgId, c.id);
    if (!held) return;
    try {
      const fresh = await computerOfIn(orgId, c.id);
      if (fresh?.machineId !== m.id) return;
      await fly.destroyMachine(m.id);
      await clearMachine(orgId, c.id, m.id);
      c.machineId = null;
      await noteState(orgId, c, "destroyed");
    } finally {
      await release(orgId, c.id, held);
    }
    m = null;
  }
  if (!m) {
    await build(p);
  } else if (off) {
    await start(orgId, c);
  } else {
    await noteState(orgId, c, m.state);
    await sizeIn(orgId, c);
  }
}

// The size a filesystem holding `bytes` should be: room to spare, doubling
// at least, never past Fly's limit.
export function sizeFor(bytes: number, diskGb: number): number {
  if (bytes <= 0.8 * diskGb * 1e9) return diskGb;
  return Math.min(
    MAX_DISK_GB,
    Math.max(diskGb * 2, Math.ceil((bytes * 1.25) / 1e9)),
  );
}

// Growth steps one disk may take in a day. A disk that is genuinely
// filling doubles a few times and stops; a machine answering "full" to
// everything hits this and says so.
const GROWTHS_A_DAY = 3;
// A disk that answers "full" while what it holds and what it was asked to
// hold would still leave room to spare is not full, whatever it says.
const FULL = 0.8;

// Grows the disk one step when it is full, under the lease so two uploads
// at once extend it once. Growth answers a disk that is full — the
// machine's refusal, corroborated by what it last reported holding — and
// never a number the machine reported alone: what the machine says of
// itself cannot buy it room, and neither can saying it often.
export async function growFor(p: Principal, bytes: number): Promise<boolean> {
  const c = await computerOf(p);
  if (!c?.volumeId) return false;
  return growStep(p.orgId, c, bytes);
}

async function growStep(
  orgId: string,
  c: Computer,
  bytes: number,
): Promise<boolean> {
  if (sizeFor(c.diskGb * 1e9 + 1, c.diskGb) === c.diskGb) return false;
  // Another request may hold the row for a moment; the growth is not lost.
  let held = await leaseIn(orgId, c.id);
  for (let i = 0; i < 5 && !held; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    held = await leaseIn(orgId, c.id);
  }
  if (!held) return false;
  try {
    return await growHeld(orgId, c.id, bytes);
  } finally {
    await release(orgId, c.id, held);
  }
}

// The growth itself, for a caller that already holds the row's lease: the
// lease is not reentrant, so a sweep reaching a machine under it grows the
// disk here rather than taking a lease it is holding.
export async function growHeld(
  orgId: string,
  id: string,
  bytes: number,
): Promise<boolean> {
  // Every test of whether this disk may grow is made on the row as it is
  // under the lease, so two uploads that both found room to grow do not
  // both take a step.
  const fresh = (await computerOfIn(orgId, id))!;
  const size = sizeFor(fresh.diskGb * 1e9 + 1, fresh.diskGb);
  if (size === fresh.diskGb) return false;
  if (
    fresh.diskUsed === null ||
    fresh.diskUsed + bytes < FULL * fresh.diskGb * 1e9
  ) {
    console.error(
      `incident: computer ${fresh.id} refused ${bytes} bytes for want of room with ${fresh.diskUsed ?? "nothing"} of ${fresh.diskGb} GB reported used`,
    );
    return false;
  }
  if ((await growthsToday(orgId, fresh.id)) >= GROWTHS_A_DAY) {
    console.error(
      `incident: computer ${fresh.id} has grown ${GROWTHS_A_DAY} times today; no further`,
    );
    return false;
  }
  const { needs_restart } = await fly.extendVolume(fresh.volumeId!, size);
  // The room shows at the next boot, so a running machine boots now; the
  // size is written last, so a restart that failed is tried again.
  if (needs_restart && fresh.machineId) {
    const m = await fly.machine(fresh.machineId);
    if (m?.state === "started") {
      await noteEvent(orgId, fresh, "restart");
      await fly.restart(fresh.machineId);
    }
  }
  await setDiskGb(orgId, fresh, size);
  return true;
}

export type Status = { computer: Computer; state: string };

// The computer as Fly sees it right now, remembered if it changed.
export async function status(p: Principal): Promise<Status | null> {
  const computer = await computerOf(p);
  if (!computer) return null;
  if (!computer.machineId)
    return {
      computer,
      state: computer.offAt
        ? "powered-off"
        : computer.volumeId
          ? "no-compute"
          : "building",
    };
  let machine;
  try {
    machine = await fly.machine(computer.machineId);
  } catch (err) {
    // Fly not answering is not a page that cannot render.
    console.error(`fly: ${(err as Error).message}`);
    return { computer, state: "unknown" };
  }
  // What was seen is remembered only when nothing is changing it: a look
  // never overwrites a start or stop in flight.
  const held = await lease(p, computer.id);
  if (held) {
    try {
      // One on an image that is not the image goes whatever it is doing,
      // and here rather than at the next sweep: it answers no link of
      // ours, so the first look after a deploy is the one that replaces
      // it, and the build below makes one from the image on the same
      // filesystem. Its stops go on the record first, at Fly's own time,
      // so the meter stops there.
      const stale =
        machine?.config?.image !== undefined && machine.config.image !== IMAGE;
      if (machine && !stale) await noteState(p.orgId, computer, machine.state);
      else {
        if (machine) {
          await noteEventsIn(p.orgId, computer, machine.events ?? []);
          await fly.destroyMachine(computer.machineId);
        }
        // Gone, behind our back or by our hand: the row forgets it and
        // compute can be attached again on the same filesystem.
        await clearMachine(p.orgId, computer.id, computer.machineId);
        await noteState(p.orgId, { ...computer, machineId: null }, "destroyed");
        machine = null;
      }
    } finally {
      await release(p.orgId, computer.id, held);
    }
  }
  if (!machine)
    return { computer: { ...computer, machineId: null }, state: "no-compute" };
  return { computer, state: machine.state };
}
