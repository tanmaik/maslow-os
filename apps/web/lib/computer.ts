import { asMeter, asOrg, type Query } from "@placeholder/db";
import type { Principal } from "@placeholder/db/auth";
import {
  allComputers,
  claimComputer,
  clearMachine,
  computerOf,
  holdComputer,
  membersWithoutComputers,
  note,
  openComputerSession,
  setMachine,
  setReady,
  setVolume,
  type Computer,
} from "@placeholder/db/computers";

import { createHmac } from "node:crypto";

import { deployment } from "./deployment.ts";
import { fly, type Machine, type Stats } from "./fly.ts";

// Every computer starts here; sizes above it come later.
const FLOOR = { cpus: 2, memoryMb: 2048, diskGb: 10 };

// The image every machine boots: apps/computer, built and pushed by hand.
const IMAGE = "registry.fly.io/maslow-computers-dev:v24";

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

const progressOf = (c: Computer): Progress =>
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
        cpus: c.cpus,
        memoryMb: c.memoryMb,
        secret: c.secret,
        brain: await brainOf(q, c),
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
  for (const orgId of orgs) {
    try {
      await reconcileOrg(orgId, live);
    } catch (err) {
      console.error(`computers ${orgId}: ${(err as Error).message}`);
    }
  }
}

async function reconcileOrg(orgId: string, live: Map<string, Machine>) {
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
      // Every machine runs the image of the day: one on an older image is
      // remade to it, on the same disk, and probed again before it opens.
      // Asked before anything else, so a machine moves at the first sweep
      // after the image does, however it was left. Fly may name an image
      // with its digest; the tag is what is compared.
      if (c.current && m.config?.image?.split("@")[0] !== IMAGE) {
        await fly.reshape(m.id, {
          image: IMAGE,
          volumeId: c.volumeId!,
          cpus: c.cpus,
          memoryMb: c.memoryMb,
          secret: c.secret,
          brain: await brainOf(q, c),
          metadata: m.config?.metadata ?? tags(c),
        });
        await setReady(q, c.id, false);
        await note(q, {
          orgId,
          userId: c.userId,
          resource: "machine",
          event: "made",
          ref: m.id,
          detail: { image: IMAGE },
          why: "the image moved on",
        });
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
    });
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
