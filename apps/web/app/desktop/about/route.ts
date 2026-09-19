import { asOrg } from "@maslow/db";
import { computerOf } from "@maslow/db/computers";

import { IMAGE, statsOf, updateOn } from "@/lib/computer";
import { regionName } from "@/lib/region";
import { principal } from "@/lib/session";
import { specs } from "@/lib/sizes";

// What About This Computer says: the machine, where it is, its size and
// image, what it is using this moment, when it answers, and the update
// waiting on the person, if one is.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const [c, stats] = await Promise.all([
    asOrg(p.orgId, (q) => computerOf(q, p.userId)),
    statsOf(p).catch(() => null),
  ]);
  return Response.json({
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    image: IMAGE,
    machine: c?.machineId ?? null,
    where: c ? regionName(c.region) : null,
    size: c ? specs(c) : null,
    diskGb: c?.diskGb ?? null,
    update: updateOn(c),
    stats: stats && {
      cpu: stats.cpu,
      memory: stats.memory,
      disk: stats.disk,
      free: stats.free ?? null,
    },
  });
}
