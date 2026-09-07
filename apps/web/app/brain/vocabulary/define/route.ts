import {
  defineProperty,
  defineType,
  Invalid,
  NotFound,
  type Datatype,
} from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Adds a type, or a field on a type, to the signed-in person's vocabulary.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const what = text("what");

  try {
    await asPerson(p, async (db) => {
      if (what === "type") return defineType(db, { name: text("name") });
      if (what === "field") {
        const options = text("options")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);
        return defineProperty(db, text("type"), {
          name: text("name"),
          datatype: text("datatype") as Datatype,
          required: form.get("required") === "1",
          options: options.length ? options : undefined,
        });
      }
      throw new Invalid(`"${what}" is not something the vocabulary holds`);
    });
  } catch (err) {
    if (err instanceof Invalid || err instanceof NotFound) {
      return new Response(err.message, { status: 400 });
    }
    throw err;
  }
  return NextResponse.redirect(`${origin(request)}/brain/vocabulary`, 303);
}
