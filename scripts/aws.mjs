// AWS as the scripts need it: the account's machines and disks, their
// leases, stopping and destroying what lapsed, and what AWS alone leaves
// behind — a way through the front door to a machine that is gone. The
// SDK finds the credentials as it does anywhere: a role where one runs,
// the environment's keys otherwise.
import {
  CreateTagsCommand,
  DeleteVolumeCommand,
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  EC2Client,
  StopInstancesCommand,
  TerminateInstancesCommand,
} from "@aws-sdk/client-ec2";
import {
  DeleteRuleCommand,
  DeleteTargetGroupCommand,
  DescribeRulesCommand,
  DescribeTagsCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  ElasticLoadBalancingV2Client,
} from "@aws-sdk/client-elastic-load-balancing-v2";

const MINE = "maslow-cloud:";
const THEIRS = "maslow:";

// Whether this environment names an AWS account to sweep.
export const on = (env = process.env) => Boolean(env.AWS_COMPUTERS_REGION);

const region = (env) => {
  if (!env.AWS_COMPUTERS_REGION)
    throw new Error("AWS_COMPUTERS_REGION is not set");
  return env.AWS_COMPUTERS_REGION;
};
// The deployment whose machines and disks these are: everything the app
// makes carries its name, and only that is listed, so another deployment
// in the same account is never this one's to reap.
const ofDeployment = (env) => {
  if (!env.AWS_COMPUTERS_NAME) throw new Error("AWS_COMPUTERS_NAME is not set");
  return { Name: `tag:${MINE}deployment`, Values: [env.AWS_COMPUTERS_NAME] };
};
const ec2 = (env) => new EC2Client({ region: region(env) });
const elb = (env) => new ElasticLoadBalancingV2Client({ region: region(env) });

// An id as the app has it, region first, and back to AWS's own.
const named = (env, id) => `${region(env)}-${id}`;
const bare = (full) => full.replace(/^[a-z]{2}(?:-[a-z]+)+-\d-/, "");

function read(tags) {
  const mine = {};
  const theirs = {};
  let name = "";
  for (const { Key, Value } of tags ?? []) {
    if (Key === "Name") name = Value;
    else if (Key?.startsWith(MINE)) mine[Key.slice(MINE.length)] = Value;
    else if (Key?.startsWith(THEIRS)) theirs[Key.slice(THEIRS.length)] = Value;
  }
  return { name, mine, theirs };
}

// A listing read to its last page, since a decision made on the first
// page alone would take what a later page still holds. EC2 carries its
// place in the listing as a token and the front door as a marker.
async function pages(client, Command, input, key, by = "token") {
  const all = [];
  let place;
  do {
    const asked = by === "token" ? { NextToken: place } : { Marker: place };
    const r = await client.send(new Command({ ...input, ...asked }));
    all.push(...(r[key] ?? []));
    place = by === "token" ? r.NextToken : r.NextMarker;
  } while (place);
  return all;
}

// Every machine of ours: what it is called, whether it runs, the tags the
// app gave it, the disks it holds, and when it was made.
export async function machines(env = process.env) {
  const found = await pages(
    ec2(env),
    DescribeInstancesCommand,
    {
      Filters: [
        { Name: "tag-key", Values: [`${MINE}image`] },
        ofDeployment(env),
      ],
    },
    "Reservations",
  );
  return found
    .flatMap((r) => r.Instances ?? [])
    .filter((i) => i.State?.Name !== "terminated")
    .map((i) => {
      const { name, theirs } = read(i.Tags);
      return {
        id: named(env, i.InstanceId),
        name,
        running: i.State?.Name === "running",
        tags: theirs,
        disks: (i.BlockDeviceMappings ?? [])
          .filter((b) => b.DeviceName === "/dev/sdf" && b.Ebs?.VolumeId)
          .map((b) => named(env, b.Ebs.VolumeId)),
        madeAt: i.LaunchTime ?? new Date(0),
      };
    });
}

// Every disk of ours, with whether a machine holds it.
export async function volumes(env = process.env) {
  const found = await pages(
    ec2(env),
    DescribeVolumesCommand,
    {
      Filters: [
        { Name: `tag:${MINE}disk`, Values: ["data"] },
        ofDeployment(env),
      ],
    },
    "Volumes",
  );
  return found.map((v) => ({
    id: named(env, v.VolumeId),
    name: read(v.Tags).name,
    tags: read(v.Tags).theirs,
    madeAt: v.CreateTime ?? new Date(0),
    held: Boolean(v.Attachments?.length),
  }));
}

// Marks every machine of a checkout as wanted now.
export async function renewLeases(checkout, env = process.env) {
  let n = 0;
  for (const m of await machines(env)) {
    if (m.tags.checkout !== checkout) continue;
    await ec2(env).send(
      new CreateTagsCommand({
        Resources: [bare(m.id)],
        Tags: [{ Key: `${THEIRS}lease`, Value: new Date().toISOString() }],
      }),
    );
    n++;
  }
  return n;
}

// A machine of production is never the reap's to touch, and neither is a
// disk that was ever a production machine's, which says so on itself.
export const untouchable = (m) => m.tags?.env === "production";

export async function stop(id, env = process.env) {
  await ec2(env).send(new StopInstancesCommand({ InstanceIds: [bare(id)] }));
}

// The machine, its way through the front door, then its disks.
export async function destroy(m, env = process.env) {
  await ec2(env).send(
    new TerminateInstancesCommand({ InstanceIds: [bare(m.id)] }),
  );
  await unroute(bare(m.id), env);
  for (const disk of m.disks) await destroyVolume(disk, env);
}

// A disk, tried while AWS still counts it as held: one stays attached for
// a while after its machine has gone.
export async function destroyVolume(id, env = process.env) {
  for (let i = 0; i < 30; i++) {
    try {
      await ec2(env).send(new DeleteVolumeCommand({ VolumeId: bare(id) }));
      return;
    } catch (err) {
      if (/NotFound/.test(err.name ?? "")) return;
      if (!/VolumeInUse/.test(err.name ?? "") || i === 29) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

// The front door's list, where a computer's own way in stands: the group
// holding that one machine and the rule naming it.
async function doorways(env) {
  const listener = env.AWS_COMPUTERS_LISTENER;
  if (!listener) return { listener: null, rules: [], groups: [] };
  const rules = await pages(
    elb(env),
    DescribeRulesCommand,
    { ListenerArn: listener },
    "Rules",
    "marker",
  );
  const named = (
    await pages(
      elb(env),
      DescribeTargetGroupsCommand,
      {},
      "TargetGroups",
      "marker",
    )
  ).filter((g) => g.TargetGroupName?.startsWith("c-i-"));
  // Only this deployment's own: another's in the same account is named the
  // same way, and is not this one's to call abandoned. Tags are asked for
  // twenty groups at a time, which is as many as AWS answers for.
  const own = ofDeployment(env).Values[0];
  const groups = [];
  for (let i = 0; i < named.length; i += 20) {
    const batch = named.slice(i, i + 20);
    const r = await elb(env).send(
      new DescribeTagsCommand({
        ResourceArns: batch.map((g) => g.TargetGroupArn),
      }),
    );
    const ours = new Set(
      (r.TagDescriptions ?? [])
        .filter((d) =>
          (d.Tags ?? []).some(
            (t) => t.Key === `${MINE}deployment` && t.Value === own,
          ),
        )
        .map((d) => d.ResourceArn),
    );
    groups.push(...batch.filter((g) => ours.has(g.TargetGroupArn)));
  }
  return { listener, rules, groups };
}

async function unroute(id, env) {
  const { rules, groups } = await doorways(env);
  const group = groups.find((g) => g.TargetGroupName === `c-${id}`);
  if (!group) return;
  for (const rule of rules)
    if (
      (rule.Actions ?? []).some(
        (a) => a.TargetGroupArn === group.TargetGroupArn,
      )
    )
      await elb(env).send(new DeleteRuleCommand({ RuleArn: rule.RuleArn }));
  await elb(env).send(
    new DeleteTargetGroupCommand({ TargetGroupArn: group.TargetGroupArn }),
  );
}

// What AWS alone leaves behind: a way through the front door to a machine
// that is gone, which a destroy cut short leaves standing. Each is named
// with how it goes, so the reap says what it took.
export async function leftovers(env = process.env) {
  const { groups, rules } = await doorways(env);
  if (!groups.length) return [];
  const live = new Set((await machines(env)).map((m) => bare(m.id)));
  const stale = [];
  for (const g of groups) {
    const held = await elb(env).send(
      new DescribeTargetHealthCommand({ TargetGroupArn: g.TargetGroupArn }),
    );
    // A group is named after the machine it holds, so one made a moment
    // ago, before its machine was put in it, is still that machine's and
    // not a leftover.
    const machine =
      held.TargetHealthDescriptions?.[0]?.Target?.Id ??
      g.TargetGroupName.slice("c-".length);
    if (machine && live.has(machine)) continue;
    stale.push({
      what: `the way through the front door to ${machine ?? g.TargetGroupName}`,
      take: async () => {
        for (const rule of rules)
          if (
            (rule.Actions ?? []).some(
              (a) => a.TargetGroupArn === g.TargetGroupArn,
            )
          )
            await elb(env).send(
              new DeleteRuleCommand({ RuleArn: rule.RuleArn }),
            );
        await elb(env).send(
          new DeleteTargetGroupCommand({ TargetGroupArn: g.TargetGroupArn }),
        );
      },
    });
  }
  return stale;
}
