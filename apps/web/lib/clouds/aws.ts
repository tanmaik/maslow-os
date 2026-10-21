import {
  AttachVolumeCommand,
  CreateSnapshotCommand,
  CreateTagsCommand,
  CreateVolumeCommand,
  DeleteSnapshotCommand,
  DeleteVolumeCommand,
  DescribeInstanceAttributeCommand,
  DescribeInstancesCommand,
  DescribeSnapshotsCommand,
  DescribeVolumesModificationsCommand,
  DescribeSubnetsCommand,
  DescribeVolumesCommand,
  EC2Client,
  ModifyInstanceAttributeCommand,
  ModifyVolumeCommand,
  RebootInstancesCommand,
  RunInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  TerminateInstancesCommand,
  type Instance,
  type _InstanceType,
  type Tag,
} from "@aws-sdk/client-ec2";
import {
  CreateRuleCommand,
  CreateTargetGroupCommand,
  DeleteRuleCommand,
  DeleteTargetGroupCommand,
  DescribeRulesCommand,
  DescribeTargetGroupsCommand,
  ElasticLoadBalancingV2Client,
  RegisterTargetsCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";

import {
  CloudRefused,
  DiskGone,
  type Cloud,
  type Machine,
  type Place,
  type Shape,
} from "../clouds.ts";
import { deployment } from "../deployment.ts";

// Computers on AWS: an EC2 instance per person, its disk an EBS volume,
// its copies EBS snapshots, all inside the network the installer built.
// Nothing of ours faces the internet: a machine is reached at its own name
// under the deployment's domain, through the one front door, as on Fly.
// AWS names things within a region and the interface names them alone, so
// an id here carries its region in front: `us-east-2-i-0abc`. What a
// machine is made of is written into its startup script, which runs at
// every boot and is read back when the machine is listed, so nothing of it
// is kept anywhere else.

function config() {
  const c = deployment.computers;
  if (c.kind !== "aws")
    throw new Error("This deployment has no AWS computers.");
  return c;
}

// The SDK finds the credentials: the role the app runs as where it runs on
// AWS, and the environment's keys anywhere else.
let client: EC2Client | null = null;
const ec2 = () => (client ??= new EC2Client({ region: config().region }));
let doors: ElasticLoadBalancingV2Client | null = null;
const elb = () =>
  (doors ??= new ElasticLoadBalancingV2Client({ region: config().region }));

// One call to AWS, its refusal as the interface's own kind. A disk that is
// not there to boot from is refused as such, since a machine may be remade
// around it.
async function run<T>(cmd: unknown, op: string): Promise<T> {
  try {
    return (await ec2().send(cmd as never)) as T;
  } catch (err) {
    const e = err as {
      name?: string;
      message?: string;
      $metadata?: { httpStatusCode?: number };
    };
    const said = `${e.name ?? "Error"}: ${e.message ?? ""}`.slice(0, 300);
    const status = e.$metadata?.httpStatusCode ?? 0;
    if (/InvalidVolume\.NotFound/.test(said))
      throw new DiskGone("AWS", status, said, op);
    throw new CloudRefused("AWS", status, said, op);
  }
}

// One call to the front door, refused in the interface's own words.
async function ask<T>(cmd: unknown, op: string): Promise<T> {
  try {
    return (await elb().send(cmd as never)) as T;
  } catch (err) {
    const e = err as {
      name?: string;
      message?: string;
      $metadata?: { httpStatusCode?: number };
    };
    throw new CloudRefused(
      "AWS",
      e.$metadata?.httpStatusCode ?? 0,
      `${e.name ?? "Error"}: ${e.message ?? ""}`.slice(0, 300),
      op,
    );
  }
}

const missing = (err: unknown) =>
  err instanceof CloudRefused && /NotFound|\.Malformed/.test(err.said);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// An id as the interface has it, and back to AWS's own with its region.
// Every partition's regions are spelled the same way but for how many
// words they carry, so GovCloud's `us-gov-west-1` parses as readily as
// `us-east-2`.
const named = (region: string, id: string) => `${region}-${id}`;
const ours = (full: string) => {
  const m = /^([a-z]{2}(?:-[a-z]+)+-\d)-((?:i|vol|snap)-[0-9a-f]+)$/.exec(full);
  return m ? { region: m[1]!, id: m[2]! } : null;
};
// A row carried over from another cloud names a machine this one never
// had, and is answered as one that is gone.
function split(full: string): { region: string; id: string } {
  const own = ours(full);
  if (!own) throw new DiskGone("AWS", 404, `not an id of ours: ${full}`, "id");
  return own;
}

// Tags: what the app calls its own, under one prefix, and what this
// implementation keeps for itself, under another, so the two never meet.
// Everything made here carries the deployment it was made for: the app's
// identity may touch only what carries it, and a listing reads only that,
// so two deployments in one account never take each other's.
const THEIRS = "maslow:";
const MINE = "maslow-cloud:";
const DEPLOYMENT = MINE + "deployment";
const tagsFor = (
  name: string,
  mine: Record<string, string>,
  theirs: Record<string, string>,
): Tag[] => [
  { Key: "Name", Value: name },
  { Key: DEPLOYMENT, Value: config().name },
  ...Object.entries(mine).map(([k, v]) => ({ Key: MINE + k, Value: v })),
  ...Object.entries(theirs).map(([k, v]) => ({ Key: THEIRS + k, Value: v })),
];
function read(t: Tag[] | undefined) {
  const mine: Record<string, string> = {};
  const theirs: Record<string, string> = {};
  let name = "";
  for (const { Key, Value } of t ?? []) {
    if (!Key || Value === undefined) continue;
    if (Key === "Name") name = Value;
    else if (Key === DEPLOYMENT) continue;
    else if (Key.startsWith(MINE)) mine[Key.slice(MINE.length)] = Value;
    else if (Key.startsWith(THEIRS)) theirs[Key.slice(THEIRS.length)] = Value;
  }
  return { name, mine, theirs };
}

// The instance type each size stands for. Memory is what a person runs out
// of and the processors sit idle, so a size is met on memory first: today's
// computer is eight gigabytes, which is t3.large. The size asked for is
// kept on the instance, so a listing answers with what was asked and not
// with what AWS rounded it up to.
const TYPES: [Pick<Shape, "cpuKind" | "cpus" | "memoryMb">, string][] = [
  [{ cpuKind: "shared", cpus: 2, memoryMb: 2048 }, "t3.small"],
  [{ cpuKind: "shared", cpus: 2, memoryMb: 4096 }, "t3.medium"],
  [{ cpuKind: "shared", cpus: 4, memoryMb: 8192 }, "t3.large"],
  [{ cpuKind: "shared", cpus: 4, memoryMb: 16384 }, "t3.xlarge"],
  [{ cpuKind: "performance", cpus: 4, memoryMb: 8192 }, "c6i.xlarge"],
  [{ cpuKind: "performance", cpus: 4, memoryMb: 16384 }, "m6i.xlarge"],
];
function instanceType(s: Pick<Shape, "cpuKind" | "cpus" | "memoryMb">): string {
  const kind = TYPES.filter(([t]) => t.cpuKind === s.cpuKind);
  const enough = (kind.length ? kind : TYPES).find(
    ([t]) => t.memoryMb >= s.memoryMb,
  );
  return (enough ?? TYPES[TYPES.length - 1]!)[1];
}
const sizeTag = (s: Pick<Shape, "cpuKind" | "cpus" | "memoryMb">) =>
  `${s.cpuKind}/${s.cpus}/${s.memoryMb}`;
function sizeOf(tag: string | undefined): Machine["size"] {
  const [cpuKind, cpus, memoryMb] = (tag ?? "").split("/");
  if (!cpuKind) return {};
  return { cpuKind, cpus: Number(cpus), memoryMb: Number(memoryMb) };
}

// A machine's state in the interface's words: anything on its way from one
// state to another is changing, and a terminated one is gone.
function stateOf(name: string | undefined): Machine["state"] {
  if (name === "running") return "running";
  if (name === "stopped") return "stopped";
  if (name === "terminated" || name === "shutting-down") return "gone";
  return "changing";
}

// The image, by its label, where this deployment keeps its images.
const image = (label: string) => `${config().registry}:${label}`;

// What a machine is made of, as the environment its door is given.
const machineEnv = (m: Shape) => ({
  DOOR_SECRET: m.secret,
  DOMAIN: config().domain,
  PERSON: m.who.person,
  ORG: m.who.org,
  ...(m.brain ? { BRAIN_URL: m.brain.url, BRAIN_TOKEN: m.brain.token } : {}),
});

// Two gigabytes of disk standing in for memory, as every machine on Fly
// carries, so one that outgrows its memory slows down rather than losing
// what it was running.
const SWAP_MB = 2048;

// The script an instance runs at every boot, carrying what the machine is
// made of: the person's disk at /data, two gigabytes of swap, and the door
// as one container on the host's network, remade each boot from the image
// and environment the script names. So a reshape is a new script and a
// restart. The environment rides along once more as a comment, for a
// listing to read back.
function startup(env: Record<string, string>, label: string): string {
  const c = config();
  const registry = c.registry.split("/")[0]!;
  const region = /\.dkr\.ecr\.([a-z0-9-]+)\./.exec(c.registry)?.[1] ?? c.region;
  const script = `#!/bin/bash
set -euo pipefail
# maslow-env: ${Buffer.from(JSON.stringify(env)).toString("base64")}
command -v docker >/dev/null || dnf install -y docker
systemctl enable --now docker
install -m 600 /dev/null /etc/maslow.env
cat > /etc/maslow.env <<'MASLOW_ENV'
${Object.entries(env)
  .map(([k, v]) => `${k}=${v}`)
  .join("\n")}
MASLOW_ENV
# The machine's own name, asked of the machine itself, as the interface
# spells it.
T=$(curl -sX PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
M() { curl -s -H "X-aws-ec2-metadata-token: $T" "http://169.254.169.254/latest/meta-data/$1"; }
echo "MACHINE_ID=$(M placement/region)-$(M instance-id)" >> /etc/maslow.env
# The person's disk, made a filesystem the first time and grown after.
until [ -e /dev/sdf ]; do sleep 2; done
blkid /dev/sdf >/dev/null || mkfs.ext4 -L data /dev/sdf
grep -q ' /data ' /etc/fstab || echo 'LABEL=data /data ext4 defaults,nofail 0 2' >> /etc/fstab
mkdir -p /data
mountpoint -q /data || mount /data
resize2fs /dev/sdf || true
if [ ! -e /swapfile ]; then
  fallocate -l ${SWAP_MB}M /swapfile && chmod 600 /swapfile && mkswap /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon --show=NAME | grep -q '^/swapfile$' || swapon /swapfile
aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}
docker pull ${image(label)}
docker rm -f door >/dev/null 2>&1 || true
docker run -d --name door --restart always --privileged --network host \\
  -v /data:/data --env-file /etc/maslow.env ${image(label)}
`;
  // A cloud-init multipart, so the script runs at every boot and not only
  // the first.
  const boundary = "maslow-boundary";
  return [
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "MIME-Version: 1.0",
    "",
    `--${boundary}`,
    'Content-Type: text/cloud-config; charset="us-ascii"',
    "",
    "#cloud-config",
    "cloud_final_modules:",
    "  - [scripts-user, always]",
    "",
    `--${boundary}`,
    'Content-Type: text/x-shellscript; charset="us-ascii"',
    "",
    script,
    `--${boundary}--`,
    "",
  ].join("\n");
}

// The environment a startup script carries, read back from it.
function envOf(userData: string | undefined): Record<string, string> {
  if (!userData) return {};
  const m = /# maslow-env: ([A-Za-z0-9+/=]+)/.exec(
    Buffer.from(userData, "base64").toString("utf8"),
  );
  if (!m) return {};
  try {
    return JSON.parse(Buffer.from(m[1]!, "base64").toString("utf8")) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

// The deployment's subnets by the zone each stands in, asked once: a
// machine must stand in the same zone as the disk it boots from.
let zonesAsked: Promise<Record<string, string>> | null = null;
function zones(): Promise<Record<string, string>> {
  zonesAsked ??= run<{
    Subnets?: { SubnetId?: string; AvailabilityZone?: string }[];
  }>(
    new DescribeSubnetsCommand({ SubnetIds: config().subnets }),
    "DescribeSubnets",
  ).then((r) => {
    const by: Record<string, string> = {};
    for (const s of r.Subnets ?? [])
      if (s.AvailabilityZone && s.SubnetId) by[s.AvailabilityZone] = s.SubnetId;
    if (!Object.keys(by).length)
      throw new Error("the deployment names no subnets to stand a machine in");
    return by;
  });
  zonesAsked.catch(() => (zonesAsked = null));
  return zonesAsked;
}
const firstZone = async () => Object.keys(await zones()).sort()[0]!;

type AwsVolume = {
  VolumeId?: string;
  State?: string;
  Size?: number;
  AvailabilityZone?: string;
  Tags?: Tag[];
};

const volumeOf = (v: AwsVolume) => ({
  id: named(config().region, v.VolumeId!),
  name: read(v.Tags).name,
  region: config().region,
  state:
    v.State === "available" || v.State === "in-use"
      ? ("ready" as const)
      : v.State === "deleting" || v.State === "deleted" || v.State === "error"
        ? ("gone" as const)
        : ("filling" as const),
  sizeGb: v.Size ?? 0,
});

// A machine as the product reads it. A disk the machine was made for but
// has not been given yet is attached here, since a making cut short leaves
// one behind; a machine's script is read back for what it was told.
async function machineOf(i: Instance): Promise<Machine> {
  const region = config().region;
  const id = named(region, i.InstanceId!);
  const { name, mine, theirs } = read(i.Tags);
  const mounted = (i.BlockDeviceMappings ?? []).filter(
    (b) => b.DeviceName === "/dev/sdf" && b.Ebs?.VolumeId,
  );
  if (i.State?.Name === "running" && mine["disk"] && !mounted.length)
    await run(
      new AttachVolumeCommand({
        VolumeId: mine["disk"],
        InstanceId: i.InstanceId,
        Device: "/dev/sdf",
      }),
      "AttachVolume",
    ).catch((err: unknown) => {
      if (!(err instanceof CloudRefused && /attached|InUse/i.test(err.said)))
        throw err;
    });
  const attr = await run<{ UserData?: { Value?: string } }>(
    new DescribeInstanceAttributeCommand({
      InstanceId: i.InstanceId,
      Attribute: "userData",
    }),
    "DescribeInstanceAttribute",
  );
  return {
    id,
    name,
    state: stateOf(i.State?.Name),
    region,
    image: mine["image"] ?? null,
    size: sizeOf(mine["size"]),
    env: envOf(attr.UserData?.Value),
    tags: theirs,
    disks: mounted.map((b) => named(region, b.Ebs!.VolumeId!)),
    madeAt: i.LaunchTime ?? new Date(),
  };
}

const instanceOf = async (id: string): Promise<Instance | null> => {
  const r = await run<{ Reservations?: { Instances?: Instance[] }[] }>(
    new DescribeInstancesCommand({ InstanceIds: [id] }),
    "DescribeInstances",
  ).catch((err: unknown) => {
    if (missing(err)) return { Reservations: [] };
    throw err;
  });
  return (r.Reservations ?? []).flatMap((x) => x.Instances ?? [])[0] ?? null;
};

// A machine waited for until it runs, so what is made is whole before it
// is answered for. For a moment after AWS makes a machine it may answer
// that there is no such machine, so one not found yet is waited for like
// one not running yet, and never taken for one that is gone.
async function running(id: string, seconds: number): Promise<Instance | null> {
  for (let i = 0; i < seconds; i++) {
    const m = await instanceOf(id);
    if (m?.State?.Name === "running" || m?.State?.Name === "terminated")
      return m;
    await sleep(1000);
  }
  return instanceOf(id);
}

// Copies of a disk past the day they were to be kept until. AWS keeps a
// copy until it is taken away, and keeps it after its disk is gone, so
// what was made with a day on it is taken away here.
async function prune(full: string): Promise<void> {
  const { id } = split(full);
  const r = await run<{
    Snapshots?: { SnapshotId?: string; Tags?: Tag[] }[];
  }>(
    new DescribeSnapshotsCommand({
      OwnerIds: ["self"],
      Filters: [{ Name: "volume-id", Values: [id] }],
    }),
    "DescribeSnapshots",
  );
  const today = new Date().toISOString().slice(0, 10);
  for (const s of r.Snapshots ?? []) {
    const expires = read(s.Tags).mine["expires"];
    if (!expires || expires > today || !s.SnapshotId) continue;
    await run(
      new DeleteSnapshotCommand({ SnapshotId: s.SnapshotId }),
      "DeleteSnapshot",
    ).catch((err: unknown) => {
      if (!missing(err)) throw err;
    });
  }
}

// How a computer is reached: the front door carries every name of its own
// to it. One rule names the machine and every port under it — `8080-<id>`
// beside `<id>` — and sends both to a group holding that one machine, by
// its own name rather than its address, since an address changes when a
// machine stops and starts. Made with the machine and taken away with it,
// so the door never carries a name to a machine that is gone.
const groupName = (id: string) => `c-${id}`.slice(0, 32);

async function groupOf(id: string): Promise<string | null> {
  const r = await ask<{ TargetGroups?: { TargetGroupArn?: string }[] }>(
    new DescribeTargetGroupsCommand({ Names: [groupName(id)] }),
    "DescribeTargetGroups",
  ).catch((err: unknown) => {
    if (err instanceof CloudRefused && /NotFound/.test(err.said))
      return { TargetGroups: [] };
    throw err;
  });
  return r.TargetGroups?.[0]?.TargetGroupArn ?? null;
}

// One front door holds a hundred groups and no more — AWS does not raise
// that one — and the app and the relay hold two of them, so a deployment
// reaches ninety-eight computers before it needs a second door. Said
// plainly where it happens, since nothing about the machine is wrong.
const FULL = /TooManyTargetGroups|TooManyRules|TooManyRegistrationsForTargetId/;
const doorFull = () =>
  new Error(
    "This deployment's front door is full: it carries ninety-eight computers, and AWS does not raise that. Another front door is what takes more.",
  );

// A place in the front door's list that nothing else holds. The app's own
// name and the relay's come first; computers stand after them.
async function place(): Promise<number> {
  const r = await ask<{ Rules?: { Priority?: string }[] }>(
    new DescribeRulesCommand({ ListenerArn: config().listener }),
    "DescribeRules",
  );
  const taken = new Set(
    (r.Rules ?? [])
      .map((x) => Number(x.Priority))
      .filter((n) => Number.isFinite(n)),
  );
  for (let p = 100; p < 50_000; p++) if (!taken.has(p)) return p;
  throw doorFull();
}

async function carry(full: string): Promise<void> {
  const c = config();
  const { id } = split(full);
  const group =
    (await groupOf(id)) ??
    (
      await ask<{ TargetGroups?: { TargetGroupArn?: string }[] }>(
        new CreateTargetGroupCommand({
          Name: groupName(id),
          VpcId: c.vpc,
          TargetType: "instance",
          Protocol: "HTTP",
          Port: 8080,
          Tags: [{ Key: DEPLOYMENT, Value: c.name }],
          HealthCheckPath: "/maslow/health",
          HealthCheckIntervalSeconds: 15,
          HealthyThresholdCount: 2,
          UnhealthyThresholdCount: 5,
          Matcher: { HttpCode: "200" },
        }),
        "CreateTargetGroup",
      ).catch((err: unknown) => {
        if (err instanceof CloudRefused && FULL.test(err.said))
          throw doorFull();
        throw err;
      })
    ).TargetGroups?.[0]?.TargetGroupArn;
  if (!group) throw new Error("AWS made a group but did not name it.");
  await ask(
    new RegisterTargetsCommand({
      TargetGroupArn: group,
      Targets: [{ Id: id }],
    }),
    "RegisterTargets",
  );
  const names = [`${full}.${c.domain}`, `*-${full}.${c.domain}`];
  for (let tries = 0; tries < 5; tries++) {
    try {
      await ask(
        new CreateRuleCommand({
          ListenerArn: c.listener,
          Priority: await place(),
          Conditions: [{ Field: "host-header", Values: names }],
          Actions: [{ Type: "forward", TargetGroupArn: group }],
          Tags: [{ Key: DEPLOYMENT, Value: c.name }],
        }),
        "CreateRule",
      );
      return;
    } catch (err) {
      // Two computers made at once may reach for one place; the next ask
      // finds another.
      if (err instanceof CloudRefused && /PriorityInUse/.test(err.said))
        continue;
      if (err instanceof CloudRefused && FULL.test(err.said)) throw doorFull();
      throw err;
    }
  }
  throw doorFull();
}

async function stopCarrying(full: string): Promise<void> {
  const own = ours(full);
  if (!own) return;
  const group = await groupOf(own.id);
  if (!group) return;
  const r = await ask<{
    Rules?: { RuleArn?: string; Actions?: { TargetGroupArn?: string }[] }[];
  }>(
    new DescribeRulesCommand({ ListenerArn: config().listener }),
    "DescribeRules",
  );
  for (const rule of r.Rules ?? [])
    if (
      rule.RuleArn &&
      (rule.Actions ?? []).some((a) => a.TargetGroupArn === group)
    )
      await ask(new DeleteRuleCommand({ RuleArn: rule.RuleArn }), "DeleteRule");
  await ask(
    new DeleteTargetGroupCommand({ TargetGroupArn: group }),
    "DeleteTargetGroup",
  );
}

export const aws: Cloud = {
  // One region: the one the deployment was installed in. Computers
  // elsewhere would need a network and a front door there, so a deployment
  // makes them where it stands.
  get regions(): Readonly<Record<string, Place>> {
    const region = config().region;
    return { [region]: PLACES[region] ?? { name: region, at: [39.8, -98.6] } };
  },

  async edge() {
    return config().region;
  },

  async createVolume(name, region, sizeGb) {
    const r = await run<{ VolumeId?: string }>(
      new CreateVolumeCommand({
        AvailabilityZone: await firstZone(),
        Size: sizeGb,
        VolumeType: "gp3",
        Encrypted: true,
        TagSpecifications: [
          {
            ResourceType: "volume",
            Tags: tagsFor(name, { disk: "data" }, {}),
          },
        ],
      }),
      "CreateVolume",
    );
    if (!r.VolumeId) throw new Error("AWS made a disk but did not name it.");
    return { id: named(region, r.VolumeId) };
  },

  // The instance stands in the zone its disk is in, is given the disk once
  // it runs, and is taken down again if either fails, so the next ask makes
  // a whole machine rather than finding half of one.
  async createMachine(m) {
    const c = config();
    const { id: volume } = split(m.volumeId);
    const disk = await run<{ Volumes?: AwsVolume[] }>(
      new DescribeVolumesCommand({ VolumeIds: [volume] }),
      "DescribeVolumes",
    );
    const zone = disk.Volumes?.[0]?.AvailabilityZone;
    if (!zone) throw new DiskGone("AWS", 404, `no disk ${m.volumeId}`, "disk");
    const subnet = (await zones())[zone];
    if (!subnet)
      throw new Error(`the deployment has no subnet in ${zone} to stand in`);
    const made = await run<{ Instances?: Instance[] }>(
      new RunInstancesCommand({
        ImageId: c.os,
        InstanceType: instanceType(m) as _InstanceType,
        MinCount: 1,
        MaxCount: 1,
        SubnetId: subnet,
        SecurityGroupIds: [c.firewall],
        ...(c.profile ? { IamInstanceProfile: { Name: c.profile } } : {}),
        // The door runs on the machine's own network, so a person with
        // administrator rights on their own machine can read what the
        // machine boots with: its identity reaches the registry and
        // nothing else, and everything else it is told is that person's
        // own. A token is still required, so nothing off the machine can
        // ask.
        MetadataOptions: { HttpTokens: "required", HttpPutResponseHopLimit: 1 },
        BlockDeviceMappings: [
          {
            DeviceName: "/dev/xvda",
            Ebs: { DeleteOnTermination: true, Encrypted: true },
          },
        ],
        UserData: Buffer.from(startup(machineEnv(m), m.image)).toString(
          "base64",
        ),
        TagSpecifications: [
          {
            ResourceType: "instance",
            Tags: tagsFor(
              m.name,
              { image: m.image, size: sizeTag(m), disk: volume },
              m.metadata,
            ),
          },
          {
            ResourceType: "volume",
            Tags: tagsFor(m.name, { disk: "root" }, m.metadata),
          },
        ],
      }),
      "RunInstances",
    );
    const id = made.Instances?.[0]?.InstanceId;
    if (!id) throw new Error("AWS made a machine but did not name it.");
    try {
      const i = await running(id, 60);
      await run(
        new AttachVolumeCommand({
          VolumeId: volume,
          InstanceId: id,
          Device: "/dev/sdf",
        }),
        "AttachVolume",
      );
      // The disk says whose it is, as its machine does, so a disk found on
      // no machine later is still known for production's and left alone.
      if (Object.keys(m.metadata).length)
        await run(
          new CreateTagsCommand({
            Resources: [volume],
            Tags: Object.entries(m.metadata).map(([k, v]) => ({
              Key: THEIRS + k,
              Value: v,
            })),
          }),
          "CreateTags",
        );
      // Described again, so what is answered carries the disk just
      // attached rather than the machine as it was before.
      await carry(named(c.region, id));
      return await machineOf(
        (await instanceOf(id)) ?? i ?? made.Instances![0]!,
      );
    } catch (err) {
      await aws.destroyMachine(named(c.region, id)).catch(() => {});
      throw err;
    }
  },

  // A machine remade to a shape: stopped, given its new size and script,
  // started again on the same disk.
  async reshape(full, m) {
    const { id } = split(full);
    await aws.stop(full);
    await aws.stopped(full, 120);
    await run(
      new ModifyInstanceAttributeCommand({
        InstanceId: id,
        InstanceType: { Value: instanceType(m) as _InstanceType },
      }),
      "ModifyInstanceAttribute",
    );
    await run(
      new ModifyInstanceAttributeCommand({
        InstanceId: id,
        UserData: { Value: Buffer.from(startup(machineEnv(m), m.image)) },
      }),
      "ModifyInstanceAttribute",
    );
    await run(
      new CreateTagsCommand({
        Resources: [id],
        Tags: tagsFor(
          read((await instanceOf(id))?.Tags).name,
          { image: m.image, size: sizeTag(m) },
          m.metadata,
        ),
      }),
      "CreateTags",
    );
    await aws.start(full);
  },

  // The relay is not a machine here: it runs beside the app as its own
  // container, which the installer starts, and the app is given its
  // address outright.
  createRelay() {
    return Promise.reject(
      new Error("On AWS the relay runs beside the app, not as a machine."),
    );
  },
  reshapeRelay() {
    return Promise.reject(
      new Error("On AWS the relay runs beside the app, not as a machine."),
    );
  },

  async machines() {
    const r = await run<{ Reservations?: { Instances?: Instance[] }[] }>(
      new DescribeInstancesCommand({
        Filters: [
          { Name: "tag-key", Values: [MINE + "image"] },
          { Name: `tag:${DEPLOYMENT}`, Values: [config().name] },
        ],
      }),
      "DescribeInstances",
    );
    const found = (r.Reservations ?? [])
      .flatMap((x) => x.Instances ?? [])
      .filter((i) => i.State?.Name !== "terminated");
    return Promise.all(found.map(machineOf));
  },

  async machine(full) {
    const own = ours(full);
    if (!own) return null;
    const i = await instanceOf(own.id);
    if (!i || i.State?.Name === "terminated") return null;
    return machineOf(i);
  },

  async volumes() {
    const r = await run<{ Volumes?: AwsVolume[] }>(
      new DescribeVolumesCommand({
        Filters: [
          { Name: `tag:${MINE}disk`, Values: ["data"] },
          { Name: `tag:${DEPLOYMENT}`, Values: [config().name] },
        ],
      }),
      "DescribeVolumes",
    );
    return (r.Volumes ?? []).map(volumeOf);
  },

  async volume(full) {
    const own = ours(full);
    if (!own) return null;
    const r = await run<{ Volumes?: AwsVolume[] }>(
      new DescribeVolumesCommand({ VolumeIds: [own.id] }),
      "DescribeVolumes",
    ).catch((err: unknown) => {
      if (missing(err) || err instanceof DiskGone) return { Volumes: [] };
      throw err;
    });
    const v = r.Volumes?.[0];
    return v ? volumeOf(v) : null;
  },

  // AWS keeps a copy until it is taken away, so how long one is kept is
  // written on the disk and read when a copy of it is made.
  async keepSnapshots(full, days) {
    const { id } = split(full);
    await run(
      new CreateTagsCommand({
        Resources: [id],
        Tags: [{ Key: MINE + "keep-days", Value: String(days) }],
      }),
      "CreateTags",
    );
  },

  async snapshot(full) {
    await prune(full);
    const { region, id } = split(full);
    const disk = await run<{ Volumes?: AwsVolume[] }>(
      new DescribeVolumesCommand({ VolumeIds: [id] }),
      "DescribeVolumes",
    );
    const { name, mine, theirs } = read(disk.Volumes?.[0]?.Tags);
    const days = Number(mine["keep-days"] ?? 1) || 1;
    const expires = new Date(Date.now() + days * 86400_000)
      .toISOString()
      .slice(0, 10);
    const r = await run<{ SnapshotId?: string }>(
      new CreateSnapshotCommand({
        VolumeId: id,
        Description: `Maslow ${name}`,
        TagSpecifications: [
          {
            ResourceType: "snapshot",
            Tags: tagsFor(name, { of: full, expires }, theirs),
          },
        ],
      }),
      "CreateSnapshot",
    );
    if (!r.SnapshotId) throw new Error("AWS made a copy but did not name it.");
    return { id: named(region, r.SnapshotId), ready: false };
  },

  async snapshots(full) {
    const { region, id } = split(full);
    const r = await run<{
      Snapshots?: { SnapshotId?: string; State?: string }[];
    }>(
      new DescribeSnapshotsCommand({
        OwnerIds: ["self"],
        Filters: [{ Name: "volume-id", Values: [id] }],
      }),
      "DescribeSnapshots",
    );
    return (r.Snapshots ?? []).map((s) => ({
      id: named(region, s.SnapshotId!),
      ready: s.State === "completed",
    }));
  },

  // A disk filled from a copy. A deployment makes computers in one region,
  // so a copy is restored where it was made.
  async restoreVolume(name, region, sizeGb, snapshotId) {
    const snap = split(snapshotId);
    if (region !== snap.region || region !== config().region)
      throw new Error(
        `this deployment makes computers in ${config().region} alone`,
      );
    const r = await run<{ VolumeId?: string }>(
      new CreateVolumeCommand({
        AvailabilityZone: await firstZone(),
        Size: sizeGb,
        VolumeType: "gp3",
        Encrypted: true,
        SnapshotId: snap.id,
        TagSpecifications: [
          { ResourceType: "volume", Tags: tagsFor(name, { disk: "data" }, {}) },
        ],
      }),
      "CreateVolume",
    );
    if (!r.VolumeId) throw new Error("AWS made a disk but did not name it.");
    return { id: named(region, r.VolumeId) };
  },

  // The disk grows while the machine runs, and AWS grows it in the
  // background: this waits until the room is really there, since the
  // filesystem grows at the next boot and a restart that beat the disk to
  // it would find nothing new.
  async extendVolume(full, sizeGb) {
    const { id } = split(full);
    await run(
      new ModifyVolumeCommand({ VolumeId: id, Size: sizeGb }),
      "ModifyVolume",
    );
    for (let i = 0; i < 60; i++) {
      const r = await run<{
        VolumesModifications?: { ModificationState?: string }[];
      }>(
        new DescribeVolumesModificationsCommand({ VolumeIds: [id] }),
        "DescribeVolumesModifications",
      );
      const state = r.VolumesModifications?.[0]?.ModificationState;
      if (state === "optimizing" || state === "completed")
        return { needsRestart: true };
      if (state === "failed") throw new Error(`the disk ${full} did not grow`);
      await sleep(2000);
    }
    throw new Error(`the disk ${full} is still growing after two minutes`);
  },

  async start(full) {
    const { id } = split(full);
    await run(
      new StartInstancesCommand({ InstanceIds: [id] }),
      "StartInstances",
    );
  },

  async stop(full) {
    const { id } = split(full);
    await run(new StopInstancesCommand({ InstanceIds: [id] }), "StopInstances");
  },

  async stopped(full, seconds) {
    const { id } = split(full);
    for (let i = 0; i < seconds; i++) {
      const m = await instanceOf(id);
      if (!m || m.State?.Name === "stopped" || m.State?.Name === "terminated")
        return true;
      await sleep(1000);
    }
    return false;
  },

  async restart(full) {
    const { id } = split(full);
    await run(
      new RebootInstancesCommand({ InstanceIds: [id] }),
      "RebootInstances",
    );
  },

  async tag(full, key, value) {
    const { id } = split(full);
    await run(
      new CreateTagsCommand({
        Resources: [id],
        Tags: [{ Key: THEIRS + key, Value: value }],
      }),
      "CreateTags",
    );
  },

  async destroyMachine(full) {
    const own = ours(full);
    if (!own) return;
    await stopCarrying(full);
    await run(
      new TerminateInstancesCommand({ InstanceIds: [own.id] }),
      "TerminateInstances",
    ).catch((err: unknown) => {
      if (!missing(err)) throw err;
    });
  },

  // A disk still held by a machine on its way down is asked for again
  // while AWS says it is in use.
  async destroyVolume(full) {
    const own = ours(full);
    if (!own) return;
    await prune(full).catch(() => {});
    for (let i = 0; i < 30; i++) {
      try {
        await run(
          new DeleteVolumeCommand({ VolumeId: own.id }),
          "DeleteVolume",
        );
        return;
      } catch (err) {
        if (missing(err) || err instanceof DiskGone) return;
        if (!(err instanceof CloudRefused && /VolumeInUse/.test(err.said)))
          throw err;
        await sleep(2000);
      }
    }
    throw new Error(`the disk ${full} is still held after a minute`);
  },

  // Reached at its own name under the deployment's domain, through the one
  // front door, which holds the certificate for every name under it.
  door(machineId) {
    return { url: `https://${machineId}.${config().domain}`, headers: {} };
  },
};

// Where AWS's regions are, for the page to name the one a computer stands
// in. A region this does not know is named by its own code.
const PLACES: Record<string, Place> = {
  "us-east-1": { name: "Northern Virginia", at: [38.95, -77.45] },
  "us-east-2": { name: "Ohio", at: [39.96, -83.0] },
  "us-west-1": { name: "Northern California", at: [37.35, -121.96] },
  "us-west-2": { name: "Oregon", at: [45.84, -119.7] },
  "ca-central-1": { name: "Montreal", at: [45.5, -73.57] },
  "us-gov-west-1": { name: "Oregon (GovCloud)", at: [45.84, -119.7] },
  "us-gov-east-1": { name: "Ohio (GovCloud)", at: [39.96, -83.0] },
};
