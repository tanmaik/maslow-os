// Walks the AWS cloud against a real account: a disk, a machine on it, its
// listing, a stop, a start, a tag, and both taken away again. Run by hand
// against a test account, since it makes what it checks and costs money:
//
//   AWS_COMPUTERS_NAME=maslow-test \
//   AWS_COMPUTERS_REGION=us-east-2 AWS_COMPUTERS_SUBNETS=subnet-… \
//   AWS_COMPUTERS_FIREWALL=sg-… AWS_COMPUTERS_OS=ami-… \
//   AWS_COMPUTERS_REGISTRY=…/maslow-test/computer \
//   AWS_MACHINES_DOMAIN=aws.maslow.tech APP_URL=https://aws.maslow.tech \
//   node scripts/check-aws.mjs
//
// It leaves nothing behind: what it makes it destroys, even where a step
// fails.
import { execFileSync } from "node:child_process";

import { cloud } from "../apps/web/lib/cloud.ts";

const say = (ok, what, detail = "") =>
  console.log(`${ok ? "ok  " : "FAIL"}  ${what.padEnd(46)} ${detail}`);

let failed = 0;
const is = (ok, what, detail) => {
  if (!ok) failed++;
  say(ok, what, detail);
};

// A copy's day put in the past, so what happens after its day can be
// checked without waiting one.
function expire(id) {
  execFileSync("aws", [
    "ec2",
    "create-tags",
    "--region",
    process.env.AWS_COMPUTERS_REGION,
    "--resources",
    id.replace(/^[a-z-]+\d-/, ""),
    "--tags",
    "Key=maslow-cloud:expires,Value=2020-01-01",
  ]);
}

const stamp = Date.now().toString(36);
const name = `check-${stamp}`;
const region = process.env.AWS_COMPUTERS_REGION;
let volume = null;
let machine = null;

try {
  const disk = await cloud.createVolume(name, region, 10);
  volume = disk.id;
  is(disk.id.startsWith(`${region}-vol-`), "a disk is made", disk.id);

  const made = await cloud.createMachine({
    name,
    region,
    image: "none",
    volumeId: volume,
    cpuKind: "shared",
    cpus: 4,
    memoryMb: 8192,
    secret: "check",
    brain: null,
    who: { person: "check", org: "check" },
    metadata: { environment: "check", lease: stamp },
  });
  machine = made.id;
  is(machine.startsWith(`${region}-i-`), "a machine is made on it", machine);
  is(
    made.disks.includes(volume),
    "what is made answers with its disk",
    made.disks.join(","),
  );

  const m = await cloud.machine(machine);
  is(m?.state === "running", "it is running", m?.state);
  is(m?.name === name, "it carries its name", m?.name);
  is(m?.image === "none", "it knows its image", m?.image ?? "");
  is(
    m?.size.cpus === 4 && m?.size.memoryMb === 8192,
    "it answers with the size asked for",
    `${m?.size.cpuKind}/${m?.size.cpus}/${m?.size.memoryMb}`,
  );
  is(m?.disks.includes(volume), "its disk is attached", m?.disks.join(","));
  is(
    m?.tags.lease === stamp,
    "its tags are the app's own",
    m?.tags.lease ?? "",
  );
  is(
    m?.env.DOOR_SECRET === "check" && m?.env.PERSON === "check",
    "what it was told is read back",
    Object.keys(m?.env ?? {}).join(","),
  );

  is(
    (await cloud.machines()).some((x) => x.id === machine),
    "it is in the listing",
  );
  is(
    (await cloud.volumes()).some((x) => x.id === volume),
    "its disk is in the listing",
  );

  await cloud.tag(machine, "lease", "renewed");
  is(
    (await cloud.machine(machine))?.tags.lease === "renewed",
    "a tag is written without a restart",
  );

  await cloud.stop(machine);
  is(await cloud.stopped(machine, 180), "it stops when asked");
  await cloud.start(machine);
  is(
    (await cloud.machine(machine))?.state !== "gone",
    "it starts again on the same disk",
  );

  // A copy of the disk, and one past its day taken away when the next is
  // made: AWS keeps a copy until it is asked to let go.
  await cloud.keepSnapshots(volume, 1);
  const first = await cloud.snapshot(volume);
  is(
    first.id.startsWith(`${region}-snap-`),
    "a copy of the disk is made",
    first.id,
  );
  is(
    (await cloud.snapshots(volume)).some((s) => s.id === first.id),
    "the copy is in the disk's listing",
  );
  expire(first.id);
  // AWS refuses a second copy of one disk within a quarter minute.
  await new Promise((r) => setTimeout(r, 20_000));
  await cloud.snapshot(volume);
  is(
    !(await cloud.snapshots(volume)).some((s) => s.id === first.id),
    "a copy past its day is taken away",
  );

  is(
    (await cloud.extendVolume(volume, 12)).needsRestart,
    "the disk grows, and says it needs a restart",
  );
  is(
    (await cloud.volume(volume))?.sizeGb === 12,
    "the disk answers with its new size",
    String((await cloud.volume(volume))?.sizeGb),
  );

  is(
    cloud.door(machine).url ===
      `https://${machine}.${process.env.AWS_MACHINES_DOMAIN}`,
    "its door is its own name under the domain",
    cloud.door(machine).url,
  );
} catch (err) {
  failed++;
  console.error(
    "FAIL  the walk stopped:",
    err instanceof Error ? err.message : err,
  );
} finally {
  // Taking a thing away is asked for and not waited on: AWS answers with
  // one on its way out until it is out.
  if (machine) {
    await cloud.destroyMachine(machine);
    let m = await cloud.machine(machine);
    for (let i = 0; i < 30 && m && m.state !== "gone"; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      m = await cloud.machine(machine);
    }
    is(m === null || m.state === "gone", "the machine is gone", m?.state ?? "");
  }
  if (volume) {
    // Every copy this walk made is put past its day first, so taking the
    // disk away takes them with it and the account is left as it was.
    for (const s of await cloud.snapshots(volume).catch(() => [])) expire(s.id);
    await cloud.destroyVolume(volume);
    is(
      (await cloud.snapshots(volume).catch(() => [])).length === 0,
      "the copies go with the disk",
    );
    const v = await cloud.volume(volume);
    is(v === null || v.state === "gone", "the disk is gone", v?.state ?? "");
  }
}

process.exit(failed ? 1 : 0);
