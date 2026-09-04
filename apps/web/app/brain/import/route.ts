import { Invalid, importBrain, isSnapshot } from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Adds an exported file to the signed-in person's brain. A file that is not a
// brain, or a record in it that does not fit its kind's form, is refused.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });

  let snapshot: unknown;
  try {
    snapshot = JSON.parse(String((await request.formData()).get("snapshot")));
  } catch {
    snapshot = null;
  }
  if (!isSnapshot(snapshot)) {
    return new Response("That is not a brain file.", { status: 400 });
  }
  try {
    const imported = await asPerson(p, (db) =>
      importBrain(db, `person:${p.userId}`, snapshot),
    );
    return NextResponse.redirect(
      `${origin(request)}/brain?imported=${imported.records}`,
      303,
    );
  } catch (err) {
    if (err instanceof Invalid)
      return new Response(err.message, { status: 400 });
    throw err;
  }
}
