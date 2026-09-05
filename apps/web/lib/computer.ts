import type { Principal } from "@placeholder/db/auth";
import {
  clearMachine,
  clearVolume,
  computerOf,
  computerOfIn,
  computersAllowed,
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

export type Built = "built" | "exists" | "off" | "not-allowed" | "powered-off";

// A Fly thing made and then not recorded, that Fly would not take back:
// it is billed until the sweep's reconcile finds it, and that is said.
const unpaid = (what: "machine" | "volume") => (err: Error) =>
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
      recorded = await setMachine(p, c.id, machine.id);
    } finally {
      // Unrecorded is unbilled by us and billed by Fly: it goes at once.
      if (!recorded)
        await fly.destroyMachine(machine.id).catch(unpaid("machine"));
    }
    if (!recorded) return "exists";
    c.machineId = machine.id;
    await fly.placed(c.machineId);
    await start(p, c);
    return "built";
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
    if ((await build(p)) !== "exists") return;
    const c = await computerOf(p);
    if (!c?.machineId || c.offAt) return;
    const m = await fly.machine(c.machineId);
    if (m && isOff(m)) await start(p, c);
  } catch (err) {
    console.error(`computer at sign-in: ${(err as Error).message}`);
  }
}

// A machine that is not running and could be started: made and never
// started, stopped, or suspended.
const isOff = (m: Machine) =>
  m.state === "created" || m.state === "stopped" || m.state === "suspended";

// Starts a machine Fly stopped, the ask on the record first.
async function start(p: Principal, c: Computer): Promise<void> {
  await noteEvent(p.orgId, c, "start");
  await fly.start(c.machineId!);
  await noteState(
    p.orgId,
    c,
    (await fly.machine(c.machineId!))?.state ?? "started",
  );
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
    await setOff(p, c.id, true);
    if (c.machineId) await letGo(p.orgId, c);
  } finally {
    await release(p.orgId, c.id, held);
  }
  return "off";
}

// Powers it on again: compute on the same disk, running.
export async function powerOn(p: Principal): Promise<Built> {
  const c = await computerOf(p);
  const held = c?.offAt ? await lease(p, c.id) : null;
  if (c && held) {
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
  return build(p);
}

// The machine goes, its stops on the record at Fly's own time first, so
// the meter stops where it stopped. Under the lease.
async function letGo(orgId: string, c: Computer): Promise<void> {
  const m = await fly.machine(c.machineId!);
  if (m?.events) await noteEventsIn(orgId, c, m.events);
  await fly.destroyMachine(c.machineId!);
  await noteState(orgId, c, "destroyed");
  await clearMachine(orgId, c.id, c.machineId!);
  c.machineId = null;
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
const FRESH = 10 * 60_000;
export function sizing(
  c: Pick<Computer, "size" | "need" | "seenAt">,
  lastResizeAt: Date | null,
  now = new Date(),
): Sizing {
  const rung = LADDER.indexOf(c.size);
  const free = c.need?.memory?.free ?? [];
  const load = c.need?.load ?? [];
  const lastFree = free.at(-1) ?? 1;
  const urgent = (c.need?.oom ?? 0) > 0;
  const short =
    urgent || lastFree < SHORT || (load.at(-1)! > BUSY && load.at(-2)! > BUSY);
  const up =
    rung >= 0 && rung < LADDER.length - 1 && short
      ? LADDER[
          Math.min(rung + (lastFree < STARVED ? 2 : 1), LADDER.length - 1)
        ]!
      : null;
  const settled =
    !lastResizeAt || now.getTime() - lastResizeAt.getTime() >= SETTLED;
  const spare =
    free.length >= KEPT &&
    free.every((f) => f > SPARE) &&
    load.length >= KEPT &&
    load.every((l) => l < IDLE);
  const down = rung > 0 && settled && spare ? LADDER[rung - 1]! : null;
  const fresh = c.seenAt !== null && now.getTime() - c.seenAt.getTime() < FRESH;
  const quiet =
    fresh && (c.need?.terminals ?? 0) === 0 && (load.at(-1) ?? 0) < QUIET;
  return { up, down, urgent, quiet };
}

// Acts on the ladder's word after a report, or for the sweep: up at a
// quiet moment or at once after a kill, down at a quiet moment.
export async function sizeIn(orgId: string, c: Computer): Promise<void> {
  if (deployment.computers.kind === "none" || !c.machineId || c.offAt) return;
  const last = await lastResizeIn(orgId, c.id);
  const s = sizing(c, last?.at ?? null);
  const size = s.up ?? s.down;
  if (!size || !(s.urgent || s.quiet)) return;
  const p = await principalIn(orgId, c.userId);
  if (!p) return;
  await replace(
    p,
    c,
    size,
    s.up ? (s.urgent ? "out-of-memory" : "short-of-memory") : "room-to-spare",
  );
}

// The person asked for more memory now: the next rung, at once.
export async function askBigger(p: Principal): Promise<Built | "top"> {
  const c = await computerOf(p);
  if (!c) return "exists";
  const rung = LADDER.indexOf(c.size);
  const size = LADDER[rung + 1];
  if (!size) return "top";
  return replace(p, c, size, "asked-bigger");
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
): Promise<Built> {
  if (!(await computersAllowed(p))) return "not-allowed";
  const held = await lease(p, c.id);
  if (!held) return "exists";
  try {
    c = (await computerOf(p))!;
    if (c.offAt) return "powered-off";
    if (c.size === size) return "exists";
    await noteEvent(p.orgId, c, why);
    if (c.machineId) await letGo(p.orgId, c);
    await resize(p, c, size);
  } finally {
    await release(p.orgId, c.id, held);
  }
  return build(p);
}

// The sweep's word on one computer. What Fly did to the machine since goes
// on the record, and one Fly no longer has is forgotten. One that should
// be running — the org's computers on, the person's not powered off, the
// membership live — is made if it is missing, replaced if it is on an old
// image or, once off, if it would stop itself for idleness, started if Fly
// stopped it, and sized if its reports say so. One that should not be
// running is stopped, and one powered off is let go of.
export async function upholdIn(
  orgId: string,
  c: Computer,
  orgOn: boolean,
): Promise<void> {
  let m = c.machineId ? await fly.machine(c.machineId) : null;
  if (m?.events) await noteEventsIn(orgId, c, m.events);
  if (c.machineId && !m) {
    await noteState(orgId, c, "destroyed");
    await clearMachine(orgId, c.id, c.machineId);
    c.machineId = null;
  }
  const p = await principalIn(orgId, c.userId);
  if (!(orgOn && !c.offAt && p)) {
    // Powered off by the person, yet a machine still stands: a power-off
    // that failed partway finishes here.
    if (m && c.offAt) {
      const held = await leaseIn(orgId, c.id);
      if (!held) return;
      try {
        await letGo(orgId, c);
      } finally {
        await release(orgId, c.id, held);
      }
      return;
    }
    if (m && (m.state === "started" || m.state === "starting")) {
      await fly.stop(m.id);
      m = await fly.machine(m.id);
      if (m?.events) await noteEventsIn(orgId, c, m.events);
    }
    if (m) await noteState(orgId, c, m.state);
    return;
  }
  const off = m !== null && isOff(m);
  // One on an image that is not the image answers no link of ours, so it
  // goes whatever it is doing; one that would stop itself for idleness
  // goes once it has. One that will not go stays on the row, and the next
  // sweep tries again.
  const stale =
    m !== null &&
    ((m.config?.image !== undefined && m.config.image !== IMAGE) ||
      (autostops(m) && off));
  if (m && stale) {
    console.log(`machine ${m.id} is on ${m.config?.image}; replaced`);
    await fly.destroyMachine(m.id);
    await noteState(orgId, c, "destroyed");
    await clearMachine(orgId, c.id, m.id);
    m = null;
    c.machineId = null;
  }
  if (!m) {
    await build(p);
  } else if (off) {
    await start(p, c);
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

// Grows the disk one step when it is full, under the lease so two uploads
// at once extend it once. Growth answers a disk that is full, never a
// number the machine reported: what the machine says of itself cannot
// buy it room.
export async function growFor(p: Principal): Promise<boolean> {
  const c = await computerOf(p);
  if (!c?.volumeId) return false;
  return growStep(p, c);
}

// The same for the sweep, which has no person.
export async function growIn(orgId: string, c: Computer): Promise<boolean> {
  if (!c.volumeId) return false;
  return growStep({ orgId, userId: c.userId } as Principal, c);
}

async function growStep(p: Principal, c: Computer): Promise<boolean> {
  const target = sizeFor(c.diskGb * 1e9 + 1, c.diskGb);
  if (target === c.diskGb) return false;
  // Another request may hold the row for a moment; the growth is not lost.
  let held = await leaseIn(p.orgId, c.id);
  for (let i = 0; i < 5 && !held; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    held = await leaseIn(p.orgId, c.id);
  }
  if (!held) return false;
  try {
    const fresh = (await computerOfIn(p.orgId, c.id))!;
    const size = sizeFor(fresh.diskGb * 1e9 + 1, fresh.diskGb);
    if (size === fresh.diskGb) return false;
    const { needs_restart } = await fly.extendVolume(fresh.volumeId!, size);
    // The room shows at the next boot, so a running machine boots now; the
    // size is written last, so a restart that failed is tried again.
    if (needs_restart && fresh.machineId) {
      const m = await fly.machine(fresh.machineId);
      if (m?.state === "started") {
        await noteEvent(p.orgId, fresh, "restart");
        await fly.restart(fresh.machineId);
      }
    }
    await setDiskGb(p, fresh, size);
    return true;
  } finally {
    await release(p.orgId, c.id, held);
  }
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
        await noteState(p.orgId, computer, "destroyed");
        await clearMachine(p.orgId, computer.id, computer.machineId);
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
