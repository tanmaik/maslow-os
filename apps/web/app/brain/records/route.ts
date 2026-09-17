import { catalog, Invalid, NotFound, write } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

import { recordHref } from "../format";
import { backTo, refused } from "../refuse";
import { definitionsFrom, propsFrom } from "../props";

// The one type the product itself knows, defined the first time it is used.
const NOTE = "note";

// Writes a record the signed-in person typed in, fitted to its type's form.
// A type made up in the same form is defined in the same call.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  // A type being made up is named as typed, without stray spaces; one that
  // exists is looked up by the name it has.
  const fresh = form.get("new") === "1";
  const given = String(form.get("type") ?? "");
  const type = fresh ? given.trim() : given;
  const title = String(form.get("title") ?? "").trim();
  // The view the record was written from, which a refusal goes back to.
  const back = backTo(form.get("back"), "/brain");
  if (!title) return refused(request, back, "A record needs a title.");

  try {
    const id = await asPerson(p, async (db) => {
      const known = (await catalog(db)).types.find(
        (t) => t.name === type && t.own,
      );
      if (fresh && known) {
        throw new Invalid(`you already have a type called "${type}"`);
      }
      if (!fresh && !known && type !== NOTE) {
        throw new NotFound(`no type "${type}" in your vocabulary`);
      }
      // A type made up in this form is declared in the same call that
      // writes its first record, which is what the write door is for.
      const declaring = known ? undefined : definitionsFrom(form);
      const written = await write(db, {
        types: declaring && [{ name: type, properties: declaring }],
        records: [
          {
            type,
            title,
            body: String(form.get("body") ?? "").trim(),
            // The fields the record is fitted to: the ones being declared
            // here, or the ones the type already has.
            props: propsFrom(form, known?.properties ?? declaring ?? []),
          },
        ],
      });
      return written.records[0]!;
    });
    // Always the record just written, whatever its type.
    return NextResponse.redirect(`${origin(request)}${recordHref(id)}`, 303);
  } catch (err) {
    if (err instanceof Invalid || err instanceof NotFound) {
      return refused(request, back, err.message);
    }
    throw err;
  }
}
