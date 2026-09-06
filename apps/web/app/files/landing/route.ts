import { NextResponse } from "next/server";

import { filesOf, whole } from "@/lib/files";
import { principal } from "@/lib/session";

// The person's uploads whole in the store and not yet on the disk: each
// landing, staged again with why the machine could not land it, or lost
// to the store. One not listed has landed. For a page waiting to show
// them.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const { files } = await filesOf(p);
  return NextResponse.json(
    {
      files: files
        .filter((f) => whole(f) || f.state === "lost")
        .map((f) => ({ id: f.id, state: f.state, said: f.said })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
