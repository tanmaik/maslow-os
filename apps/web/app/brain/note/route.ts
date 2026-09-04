import { Invalid, defineKind, write } from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Writes a note into the signed-in person's brain, defining what a note is
// the first time this brain sees one.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const title = String(form.get("title") ?? "").trim();
  const body = String(form.get("body") ?? "").trim();
  if (!title) return new Response("A note needs a title.", { status: 400 });

  const author = `person:${p.userId}`;
  try {
    await asPerson(p.orgId, p.userId, async (db) => {
      await defineKind(db, author, {
        name: "note",
        description: "Something you wrote down yourself.",
      });
      await write(db, author, {
        records: [
          {
            kind: "note",
            layer: "source",
            source: "person",
            sourceRef: randomUUID(),
            title,
            body,
            occurredAt: new Date(),
          },
        ],
      });
    });
  } catch (err) {
    if (err instanceof Invalid)
      return new Response(err.message, { status: 400 });
    throw err;
  }
  return NextResponse.redirect(`${origin(request)}/brain`, 303);
}
