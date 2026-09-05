import {
  catalog,
  defineKind,
  Invalid,
  NotFound,
  write,
} from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

import { kindHref, recordHref } from "../format";
import { instantFrom, propsFrom } from "../props";

// The one kind the product itself knows, defined the first time it is used.
const NOTE = {
  name: "note",
  description: "Something you wrote down yourself.",
};

// Writes a record the signed-in person typed in: a source record from them,
// fitted to its kind's form.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const kind = String(form.get("kind") ?? "");
  const title = String(form.get("title") ?? "").trim();
  if (!title) return new Response("A record needs a title.", { status: 400 });

  const author = `person:${p.userId}`;
  try {
    const id = await asPerson(p, async (db) => {
      if (kind === NOTE.name) await defineKind(db, author, NOTE);
      const declared = (await catalog(db)).kinds.find(
        (k) => k.name === kind && !k.via,
      );
      if (!declared) throw new NotFound(`no kind "${kind}" in your vocabulary`);
      const written = await write(db, author, {
        records: [
          {
            kind,
            layer: "source",
            source: "person",
            sourceRef: randomUUID(),
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
      `${origin(request)}${kind === NOTE.name ? kindHref() : recordHref(id)}`,
      303,
    );
  } catch (err) {
    if (err instanceof Invalid || err instanceof NotFound) {
      return new Response(err.message, { status: 400 });
    }
    throw err;
  }
}
