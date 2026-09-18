import { groupsOf } from "@maslow/db/groups";
import { NextResponse } from "next/server";

import { principal } from "@/lib/session";

// Whom a share can be given to: every current member of the org and every
// group in it. Everyone is not a row and is not listed; a share names it by
// name.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const groups = await groupsOf(p);
  const everyone = groups.find((g) => g.everyone);
  return NextResponse.json(
    {
      members: (everyone?.members ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        me: m.id === p.userId,
      })),
      groups: groups
        .filter((g) => !g.everyone)
        .map((g) => ({ id: g.id, name: g.name })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
