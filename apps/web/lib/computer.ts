import type { Principal } from "@placeholder/db/auth";
import {
  clearMachine,
  clearVolume,
  computerOf,
  computerOfIn,
  computersAllowed,
  lease,
  leaseIn,
  noteEventsIn,
  noteRequest,
  noteState,
  release,
  releaseIn,
  reserveComputer,
  resize,
  secretIn,
  secretOf,
  setDiskGb,
  setMachine,
  setVolume,
  type Computer,
} from "@placeholder/db/computers";
import { randomBytes, randomUUID } from "node:crypto";

import { deployment } from "./deployment.ts";
import { DISK_GB, fly, machineName, MAX_DISK_GB, volumeName } from "./fly.ts";
import { LADDER } from "./prices.ts";

export type Built = "built" | "exists" | "off" | "not-allowed";

// A person has a filesystem from the moment they have an account: the
// volume is the computer, and it is made at sign-in. Compute is a machine
// attached to it on demand. The row is claimed first, so two requests at
// once make one; each Fly id is written as soon as it exists; a step that
// failed is resumed by the next look.
// Whether this org has computers: its own switch in Settings says. An org
// founded outside production starts with them on, so a preview or a
// laptop shows the whole product; one founded in production starts off.
export async function computersOn(p: Principal): Promise<boolean> {
  return computersAllowed(p);
}

export async function ensureFilesystem(p: Principal): Promise<Computer | null> {
  if (deployment.computers.kind === "none") return null;
  if (!(await computersOn(p))) return null;
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
          await fly.destroyVolume(volume.id).catch(() => {});
          throw err;
        }
        c.volumeId = volume.id;
        c.diskGb = size;
      }
    } finally {
      await release(p, c.id, held);
    }
  }
  return c;
}

// The size a computer wants: the rung above its own when memory has been
// short at each of the last three reports or anything was killed for want
// of it, null when what it has is enough or there is no rung above.
const SHORT = 0.15;
const REPORTS = 3;
export function wanted(c: Pick<Computer, "size" | "need">): string | null {
  const free = c.need?.memory?.free ?? [];
  const short =
    free.length >= REPORTS && free.slice(-REPORTS).every((f) => f < SHORT);
  if (!short && !((c.need?.oom ?? 0) > 0)) return null;
  const rung = LADDER.indexOf(c.size);
  return rung < 0 ? null : (LADDER[rung + 1] ?? null);
}

// Attaches compute to the filesystem: a machine on the volume, recorded
// and placed, at the size wanted if the last one was outgrown. Fly's proxy
// starts it at the first request that names it. The first look at the
// computer is the first need; looks that race wait for the one that holds
// the lease.
export async function build(p: Principal): Promise<Built> {
  if (deployment.computers.kind === "none") return "off";
  let c = await ensureFilesystem(p);
  if (!c) return "not-allowed";
  if (!c.volumeId) return "exists";
  if (c.machineId && c.state !== "failed") return "exists";
  const held = await lease(p, c.id);
  if (!held) return "exists";
  try {
    c = (await computerOf(p))!;
    if (c.machineId && c.state !== "failed") return "exists";
    // A machine whose build failed is let go of, and a new one made.
    if (c.machineId) {
      await fly.destroyMachine(c.machineId).catch(() => {});
      await noteState(p, c, "destroyed");
      await clearMachine(p, c.id, c.machineId);
      c.machineId = null;
    }
    if (!c.machineId) {
      const size = wanted(c);
      if (size) {
        await resize(p, c, size);
        c.size = size;
      }
      let machine;
      try {
        machine = await fly.createMachine(
          machineName(c.id),
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
          await noteState(p, c, "volume-gone");
          await clearVolume(p, c.id, c.volumeId!);
          return "exists";
        }
        throw err;
      }
      let recorded = false;
      try {
        recorded = await setMachine(p, c.id, machine.id);
      } finally {
        // Unrecorded is unbilled by us and billed by Fly: it goes at once.
        if (!recorded) await fly.destroyMachine(machine.id).catch(() => {});
      }
      if (!recorded) return "exists";
      c.machineId = machine.id;
    }
    const placed = await fly.placed(c.machineId);
    await noteState(p, c, placed.state);
    return "built";
  } catch (err) {
    // A machine that exists and failed is on the record as such, for the
    // meter and the next look; a build that made none leaves no state.
    if (c.machineId) await noteState(p, c, "failed");
    throw err;
  } finally {
    await release(p, c.id, held);
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
        await noteRequest(p, fresh, "restart");
        await fly.restart(fresh.machineId);
      }
    }
    await setDiskGb(p, fresh, size);
    return true;
  } finally {
    await releaseIn(p.orgId, c.id, held);
  }
}

// At sign-in: the filesystem, if this deployment and org have computers.
// Fly being down never keeps anyone out; the next look tries again.
export async function filesystemAtSignIn(p: Principal): Promise<void> {
  try {
    await ensureFilesystem(p);
  } catch (err) {
    console.error(`filesystem at sign-in: ${(err as Error).message}`);
  }
}

export type Status = { computer: Computer; state: string };

// The computer as Fly sees it right now, remembered if it changed.
export async function status(p: Principal): Promise<Status | null> {
  const computer = await computerOf(p);
  if (!computer) return null;
  if (!computer.machineId)
    return { computer, state: computer.volumeId ? "no-compute" : "building" };
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
      // One that is off and has been outgrown is let go of here, at a
      // step boundary and never while it runs; the next attach makes one
      // at the size wanted, on the same filesystem. Its stop goes on the
      // record first, at Fly's own time, so the meter stops there; one
      // that will not go stays on the row, and the next look tries again.
      const outgrown =
        (machine?.state === "stopped" || machine?.state === "suspended") &&
        wanted(computer) !== null;
      if (machine && !outgrown) await noteState(p, computer, machine.state);
      else {
        if (outgrown) {
          await noteEventsIn(p.orgId, computer, machine?.events ?? []);
          await fly.destroyMachine(computer.machineId);
        }
        // Gone, behind our back or by our hand: the row forgets it and
        // compute can be attached again on the same filesystem.
        await noteState(p, computer, "destroyed");
        await clearMachine(p, computer.id, computer.machineId);
        machine = null;
      }
    } finally {
      await release(p, computer.id, held);
    }
  }
  if (!machine)
    return { computer: { ...computer, machineId: null }, state: "no-compute" };
  return { computer, state: machine.state };
}
