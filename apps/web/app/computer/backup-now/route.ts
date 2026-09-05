import { lastBackupOf } from "@placeholder/db/backups";
import { computerOf } from "@placeholder/db/computers";

import { act } from "@/lib/act";
import { backUp } from "@/lib/backups";
import { deployment } from "@/lib/deployment";
import { DiskError } from "@/lib/disk";
import { principal } from "@/lib/session";

// Vercel gives this request this long.
export const maxDuration = 60;

// A backup of the home, now: at most one an hour, whoever asked for the
// last one. The machine carries on alone and the bar says when it is done.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return act(request, async () => {
    if (deployment.storage.kind === "none")
      throw new DiskError(503, "There is nowhere to keep a backup here.");
    const c = await computerOf(p);
    if (!c?.machineId)
      throw new DiskError(409, "Your computer has no machine yet to back up.");
    const last = await lastBackupOf(p);
    const since = (at: Date) => Math.floor((Date.now() - at.getTime()) / 60000);
    // One that never finished within a day is not on its way.
    if (last && !last.finishedAt && since(last.startedAt) < 1440)
      throw new DiskError(409, "A backup is on its way already.");
    const minutes = last?.finishedAt ? since(last.finishedAt) : 60;
    if (minutes < 60)
      throw new DiskError(
        429,
        `The last backup was taken ${minutes} min ago; one an hour is the limit. Another can be taken in ${60 - minutes} min.`,
      );
    await backUp(p.orgId, c);
    return "backup=started";
  });
}
