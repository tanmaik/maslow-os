import {
  catalog,
  edit,
  Forbidden,
  get,
  Invalid,
  isId,
  NotFound,
  remove,
  restore,
  unlink,
  unmerge,
} from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

import { recordHref } from "../../../format";
import { confidenceFrom, instantFrom, propsFrom } from "../../../props";

// Changes one record the way the form asked: edited, deleted, restored,
// unmerged, or one of its links removed. An edit posts the declared fields;
// what the record holds beyond them stays.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!isId(id)) return new Response(null, { status: 404 });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "edit");

  try {
    await asPerson(p, async (db) => {
      if (intent === "delete") return remove(db, id);
      if (intent === "restore") return restore(db, id);
      if (intent === "unmerge") return unmerge(db, id);
      if (intent === "unlink") {
        const edge = String(form.get("edge") ?? "");
        if (!isId(edge))
          throw new NotFound(`edge ${edge} is not in this brain`);
        return unlink(db, edge);
      }
      const [current] = await get(db, [id]);
      if (!current) throw new NotFound(`record ${id} is not in this brain`);
      const declared =
        (await catalog(db)).types.find(
          (t) => t.name === current.type && t.ownerId === current.ownerId,
        )?.properties ?? [];
      const title = String(form.get("title") ?? "").trim();
      if (!title) throw new Invalid("A record needs a title.");
      const kept = Object.fromEntries(
        Object.entries(current.props).filter(
          ([name]) => !declared.some((d) => d.name === name),
        ),
      );
      await edit(db, id, {
        title,
        body: String(form.get("body") ?? "").trim(),
        props: { ...kept, ...propsFrom(form, declared) },
        occurredAt: instantFrom(form.get("occurred_at")),
        confidence: confidenceFrom(form.get("confidence")),
      });
    });
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
