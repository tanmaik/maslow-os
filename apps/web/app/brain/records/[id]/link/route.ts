import { Forbidden, Invalid, isId, NotFound, write } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

import { recordHref } from "../../../format";
import { refused } from "../../../refuse";

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
  const back = recordHref(id);
  if (!isId(other)) {
    return refused(request, back, "A link needs the other record.");
  }

  try {
    await asPerson(p, (db) =>
      write(db, {
        edges: [
          {
            from: { id: out ? id : other },
            verb,
            to: { id: out ? other : id },
          },
        ],
      }),
    );
  } catch (err) {
    if (
      err instanceof Invalid ||
      err instanceof NotFound ||
      err instanceof Forbidden
    ) {
      return refused(request, back, err.message);
    }
    throw err;
  }
  return NextResponse.redirect(`${origin(request)}${back}`, 303);
}
