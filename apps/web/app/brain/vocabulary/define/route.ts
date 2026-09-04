import {
  defineKind,
  defineProperty,
  defineVerb,
  Invalid,
  NotFound,
  type PropertyType,
} from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

// Adds a kind, a field on a kind, or a verb to the org's vocabulary, as the
// signed-in person.
export async function POST(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const form = await request.formData();
  const text = (k: string) => String(form.get(k) ?? "").trim();
  const what = text("what");
  const author = `person:${p.userId}`;

  try {
    await asPerson(p, async (db) => {
      const definition = {
        name: text("name"),
        description: text("description"),
      };
      if (what === "kind") return defineKind(db, author, definition);
      if (what === "verb") return defineVerb(db, author, definition);
      if (what === "field") {
        const options = text("options")
          .split(",")
          .map((o) => o.trim())
          .filter(Boolean);
        return defineProperty(db, author, text("kind"), {
          ...definition,
          type: text("type") as PropertyType,
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
