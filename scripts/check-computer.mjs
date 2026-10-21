// Makes one real computer on the cloud this environment names, waits for
// its door, asks it what it is, restarts it, and takes it away again. It
// costs money and needs a deployment to reach the door through, so it is
// run deliberately rather than by `pnpm check`:
//
//   node scripts/check-computer.mjs
//
// On AWS the environment is what the installer's `computers` output says,
// with the front door's listener beside it; on Fly it is the app's token,
// its app and its domain. What it makes it destroys, even where a step
// fails, and it says what it left if it could not.
import { createHmac } from "node:crypto";

import { cloud } from "../apps/web/lib/cloud.ts";
import { IMAGE } from "../apps/web/lib/computer.ts";

const say = (ok, what, detail = "") =>
  console.log(`${ok ? "ok  " : "FAIL"}  ${what.padEnd(44)} ${detail}`);
let failed = 0;
const is = (ok, what, detail) => {
  if (!ok) failed++;
  say(ok, what, detail);
};

const SECRET = `check-${Math.random().toString(36).slice(2)}`;
const READY_WITHIN = 15 * 60_000;
const BACK_WITHIN = 5 * 60_000;

// The door answers a ticket signed with the secret the machine was made
// with, as the app's own does.
const ticket = (seconds) => {
  const exp = String(Math.floor(Date.now() / 1000) + seconds);
  return `${exp}.${createHmac("sha256", SECRET).update(exp).digest("hex")}`;
};

async function door(id, path, seconds = 60) {
  const where = cloud.door(id);
  return fetch(`${where.url}${path}`, {
    headers: { ...where.headers, "x-maslow-ticket": ticket(seconds) },
    signal: AbortSignal.timeout(20_000),
  });
}

// The door answering is what ready means, as it is for the product.
async function ready(id, within) {
  const until = Date.now() + within;
  let last = "";
  while (Date.now() < until) {
    try {
      const r = await door(id, "/maslow/health");
      if (r.status === 200)
        return { ready: true, after: within - (until - Date.now()) };
      last = String(r.status);
    } catch (err) {
      last = err.name ?? "no answer";
    }
    await new Promise((r) => setTimeout(r, 10_000));
  }
  return { ready: false, last };
}

// The door gone quiet, which a restart is known by.
async function gone(id, within = 2 * 60_000) {
  const until = Date.now() + within;
  while (Date.now() < until) {
    try {
      const r = await door(id, "/maslow/health");
      if (r.status !== 200) return true;
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

const region = (await cloud.edge()) ?? Object.keys(cloud.regions)[0];
let volume = null;
let machine = null;

try {
  const disk = await cloud.createVolume(
    `check-${Date.now().toString(36)}`,
    region,
    20,
  );
  volume = disk.id;
  const made = await cloud.createMachine({
    name: `check-${Date.now().toString(36)}`,
    region,
    image: IMAGE,
    volumeId: volume,
    cpuKind: "shared",
    cpus: 4,
    memoryMb: 8192,
    secret: SECRET,
    brain: null,
    who: { person: "check", org: "check" },
    model: null,
    metadata: {
      env: "check",
      computer: "check",
      lease: new Date().toISOString(),
    },
  });
  machine = made.id;
  is(
    made.state === "running",
    "a computer is made on the image of the day",
    `${machine} on ${IMAGE}`,
  );

  const first = await ready(machine, READY_WITHIN);
  is(
    first.ready,
    "its door answers",
    first.ready
      ? `after ${Math.round(first.after / 1000)}s`
      : `last ${first.last}`,
  );
  if (!first.ready) throw new Error("the door never answered");

  const stats = await (await door(machine, "/maslow/stats")).json();
  is(
    stats.memory?.total > 4e9,
    "it has the memory it was made with",
    `${Math.round(stats.memory.total / 1e9)} GB`,
  );
  is(
    stats.disk > 15e9,
    "the person's disk is on it",
    `${Math.round(stats.disk / 1e9)} GB`,
  );

  // A restart puts the machine back on the same disk, and the door comes
  // back with it; nothing of the person's is copied again. The door going
  // quiet is waited for first, since one that never stopped answering
  // proves nothing about coming back.
  const before = stats.free;
  await cloud.restart(machine);
  is(await gone(machine), "it goes down when restarted");
  const again = await ready(machine, BACK_WITHIN);
  is(
    again.ready,
    "it comes back from a restart",
    again.ready
      ? `after ${Math.round(again.after / 1000)}s`
      : `last ${again.last}`,
  );
  if (again.ready) {
    const after = await (await door(machine, "/maslow/stats")).json();
    is(
      Math.abs(after.free - before) < 2e9,
      "its disk came back as it was",
      `${Math.round(after.free / 1e9)} GB free`,
    );
  }
} catch (err) {
  failed++;
  console.error(
    "FAIL  the walk stopped:",
    err instanceof Error ? err.message : err,
  );
} finally {
  if (machine) {
    await cloud.destroyMachine(machine).catch((err) => {
      failed++;
      console.error(
        `FAIL  the machine ${machine} is still there: ${err.message}`,
      );
    });
    // Taking a machine away is asked for and not waited on, so the answer
    // is asked for again until AWS has caught up with it.
    let m = await cloud.machine(machine).catch(() => null);
    for (let i = 0; i < 60 && m && m.state !== "gone"; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      m = await cloud.machine(machine).catch(() => null);
    }
    is(m === null || m.state === "gone", "the machine is gone", m?.state ?? "");
  }
  if (volume) {
    await cloud.destroyVolume(volume).catch((err) => {
      failed++;
      console.error(`FAIL  the disk ${volume} is still there: ${err.message}`);
    });
    const v = await cloud.volume(volume).catch(() => null);
    is(v === null || v.state === "gone", "the disk is gone", v?.state ?? "");
  }
}

process.exit(failed ? 1 : 0);
