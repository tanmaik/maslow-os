import {
  catalog,
  defineType,
  Invalid,
  NotFound,
  write,
} from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

import { recordHref, typeHref } from "../format";
import { instantFrom, propsFrom } from "../props";

// The one type the product itself knows, defined the first time it is used.
const NOTE = "note";

// Writes a record the signed-in person typed in, fitted to its type's form.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const type = String(form.get("type") ?? "");
  const title = String(form.get("title") ?? "").trim();
  if (!title) return new Response("A record needs a title.", { status: 400 });

  try {
    const id = await asPerson(p, async (db) => {
      if (type === NOTE) await defineType(db, { name: NOTE });
      const declared = (await catalog(db)).types.find(
        (t) => t.name === type && t.own,
      );
      if (!declared) throw new NotFound(`no type "${type}" in your vocabulary`);
      const written = await write(db, {
        records: [
          {
            type,
            title,
            body: String(form.get("body") ?? "").trim(),
            props: propsFrom(form, declared.properties),
            occurredAt: instantFrom(form.get("occurred_at")) ?? new Date(),
          },
        ],
      });
      return written.records[0]!;
    });
    return NextResponse.redirect(
      `${origin(request)}${type === NOTE ? typeHref() : recordHref(id)}`,
      303,
    );
  } catch (err) {
    if (err instanceof Invalid || err instanceof NotFound) {
      return new Response(err.message, { status: 400 });
    }
    throw err;
  }
}
