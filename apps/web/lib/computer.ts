import type { Principal } from "@placeholder/db/auth";
import {
  clearMachine,
  computerOf,
  computersAllowed,
  lease,
  noteRequest,
  noteState,
  release,
  reserveComputer,
  setDiskGb,
  setMachine,
  setVolume,
  type Computer,
} from "@placeholder/db/computers";
import { filesOf } from "@placeholder/db/files";
import { randomBytes, randomUUID } from "node:crypto";

import { deployment } from "./deployment.ts";
import {
  DISK_GB,
  fly,
  machineName,
  MAX_DISK_GB,
  SIZE,
  volumeName,
} from "./fly.ts";

export type Built = "built" | "exists" | "off" | "not-allowed";

// A person has a filesystem from the moment they have an account: the
// volume is the computer, and it is made at sign-in. Compute is a machine
// attached to it on demand. The row is claimed first, so two requests at
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
      size: SIZE,
      diskGb: DISK_GB,
      secret: randomBytes(24).toString("base64url"),
    });
    c = (await computerOf(p))!;
  }
  const held = c.volumeId ? null : await lease(p, c.id);
  if (held) {
    try {
      // Read again under the lease: another request may have made it. The
      // volume is made big enough for what the person's files already hold.
      c = (await computerOf(p))!;
      if (!c.volumeId) {
        const size = sizeFor((await filesOf(p)).bytes, c.diskGb);
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

// Attaches compute to the filesystem: a machine on the volume, recorded,
// placed, then started. The first look at the computer is the first need;
// looks that race wait for the one that holds the lease.
export async function build(p: Principal): Promise<Built> {
  if (deployment.computers.kind === "none") return "off";
  let c = await ensureFilesystem(p);
  if (!c) return "not-allowed";
  if (!c.volumeId) return "exists";
  if (c.machineId && c.state !== "failed") return "exists";
  let started = false;
  const held = await lease(p, c.id);
  if (!held) return "exists";
  try {
    c = (await computerOf(p))!;
    if (c.machineId && c.state !== "failed") return "exists";
    if (!c.machineId) {
      const machine = await fly.createMachine(
        machineName(c.id),
        c.volumeId!,
        c.secret,
      );
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
    await noteRequest(p, c, "start");
    await fly.start(c.machineId);
    started = true;
    // Fly answers once it runs; the meter starts here, not at the next look.
    await noteState(p, c, "started");
    return "built";
  } catch (err) {
    // A machine that did start is not a failed build, whatever came after.
    if (!started) await noteState(p, c, "failed");
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

// Grows the filesystem to fit `bytes`, under the lease so two uploads at
// once extend it once. A filesystem not yet made grows when it is.
export async function growFor(p: Principal, bytes: number): Promise<void> {
  const c = await computerOf(p);
  if (!c?.volumeId) return;
  const target = sizeFor(bytes, c.diskGb);
  if (target === c.diskGb) return;
  // Another request may hold the row for a moment; the growth is not lost.
  let held = await lease(p, c.id);
  for (let i = 0; i < 5 && !held; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    held = await lease(p, c.id);
  }
  if (!held) return;
  try {
    const fresh = (await computerOf(p))!;
    const size = sizeFor(bytes, fresh.diskGb);
    if (size === fresh.diskGb) return;
    await fly.extendVolume(fresh.volumeId!, size);
    await setDiskGb(p, fresh, size);
  } finally {
    await release(p, c.id, held);
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
      if (!machine) {
        // Gone behind our back: the row forgets it and compute can be
        // attached again on the same filesystem.
        await noteState(p, computer, "destroyed");
        await clearMachine(p, computer.id, computer.machineId);
      } else await noteState(p, computer, machine.state);
    } finally {
      await release(p, computer.id, held);
    }
  }
  if (!machine)
    return { computer: { ...computer, machineId: null }, state: "no-compute" };
  return { computer, state: machine.state };
}

// Starting is new use, so the org must still be allowed it; stopping never
// needs permission.
export async function start(p: Principal): Promise<boolean> {
  const c = await computerOf(p);
  if (!c || !(await computersAllowed(p))) return false;
  if (!c.machineId || c.state === "failed") return (await build(p)) === "built";
  // Under the lease, after placement: a start that races a build waits for
  // it instead of failing against a machine not yet placed.
  const held = await lease(p, c.id);
  if (!held) return false;
  try {
    await fly.placed(c.machineId);
    await noteRequest(p, c, "start");
    await fly.start(c.machineId);
    await noteState(p, c, "started");
    return true;
  } finally {
    await release(p, c.id, held);
  }
}

export async function stop(p: Principal): Promise<boolean> {
  const c = await computerOf(p);
  if (!c?.machineId) return false;
  // Under the lease, so a stop cannot land inside a build's start.
  const held = await lease(p, c.id);
  if (!held) return false;
  try {
    await noteRequest(p, c, "stop");
    await fly.stop(c.machineId);
    // Fly answers once it is stopped; the meter stops here.
    await noteState(p, c, "stopped");
    return true;
  } finally {
    await release(p, c.id, held);
  }
}
