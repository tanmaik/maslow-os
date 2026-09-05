import { lastBackupOf } from "@placeholder/db/backups";

import { act } from "@/lib/act";
import { disk } from "@/lib/disk";
import { principal } from "@/lib/session";

// Vercel gives this request this long.
export const maxDuration = 60;

// A fresh operating system around the home as it is; the machine backs
// the home up first — a backup finished within the hour stands, since
// none can be taken within an hour of it — carries on alone, and the
// page says how it is going.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  return act(request, async () => {
    const last = await lastBackupOf(p);
    const fresh = Boolean(
      last?.finishedAt && Date.now() - last.finishedAt.getTime() < 3600_000,
    );
    await disk.reset(p, fresh);
    return "reset=started";
  });
}
