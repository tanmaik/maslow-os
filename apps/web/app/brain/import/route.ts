import { Invalid, importBrain, isSnapshot } from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Adds an exported file to the signed-in person's brain. A file that is not
// a brain, or a record in it that does not fit its kind's form, is refused
// and the page says so.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const back = (query: string) =>
    NextResponse.redirect(`${origin(request)}/brain/transfer?${query}`, 303);

  const form = await request.formData();
  const file = form.get("file");
  let snapshot: unknown;
  try {
    snapshot = file instanceof File ? JSON.parse(await file.text()) : null;
  } catch {
    snapshot = null;
  }
  if (!isSnapshot(snapshot)) return back("error=file");

  try {
    const done = await asPerson(p, (db) =>
      importBrain(db, `person:${p.userId}`, snapshot),
    );
    return back(
      new URLSearchParams({
        records: String(done.records),
        edges: String(done.edges),
        kinds: String(done.kinds),
        properties: String(done.properties),
        verbs: String(done.verbs),
      }).toString(),
    );
  } catch (err) {
    if (err instanceof Invalid) return back("error=refused");
    throw err;
  }
}
