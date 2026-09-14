import { opened } from "@maslow/brain";
import { asPerson } from "@maslow/db";

import { principal } from "@/lib/session";

// Records by their words, for the command bar: a handful of titles and
// opening lines the signed-in person may see, through the brain's read
// door.
export async function GET(req: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) return Response.json([]);
  const page = await asPerson(p, (db) => opened(db, { query: q, limit: 8 }));
  return Response.json(
    page.records.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      opening: r.body.split("\n")[0],
    })),
  );
}
