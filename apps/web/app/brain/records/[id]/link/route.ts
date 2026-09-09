import { Forbidden, Invalid, isId, NotFound, write } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

import { recordHref } from "../../../format";
import { confidenceFrom } from "../../../props";

// Links this record to another, in the direction the form chose, as a link
// the signed-in person made. Linking the same pair the same way again
// changes nothing.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!isId(id)) return new Response(null, { status: 404 });
  const form = await request.formData();
  const other = String(form.get("other") ?? "");
  const verb = String(form.get("verb") ?? "");
  const out = form.get("direction") !== "in";
  if (!isId(other)) return new Response("Choose a record.", { status: 400 });

  try {
    await asPerson(p, (db) =>
      write(db, {
        edges: [
          {
            from: { id: out ? id : other },
            verb,
            to: { id: out ? other : id },
            confidence: confidenceFrom(form.get("confidence")),
          },
        ],
      }),
    );
  } catch (err) {
    if (err instanceof Invalid || err instanceof NotFound) {
      return new Response(err.message, { status: 400 });
    }
    if (err instanceof Forbidden) {
      return new Response(err.message, { status: 403 });
    }
    throw err;
  }
  return NextResponse.redirect(`${origin(request)}${recordHref(id)}`, 303);
}
