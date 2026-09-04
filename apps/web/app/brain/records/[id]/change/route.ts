import {
  catalog,
  Conflict,
  edit,
  Forbidden,
  get,
  Invalid,
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

import { isId, recordHref } from "../../../format";
import { confidenceFrom, instantFrom, propsFrom } from "../../../props";

// Changes one record the way the form asked: edited from the version shown,
// deleted, restored, unmerged, or one of its links removed. An edit posts
// the declared fields; what the record holds beyond them stays.
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
  const author = `person:${p.userId}`;

  try {
    await asPerson(p, async (db) => {
      if (intent === "delete") return remove(db, author, id);
      if (intent === "restore") return restore(db, author, id);
      if (intent === "unmerge") return unmerge(db, author, id);
      if (intent === "unlink") {
        const edge = String(form.get("edge") ?? "");
        if (!isId(edge))
          throw new NotFound(`edge ${edge} is not in this brain`);
        return unlink(db, author, edge);
      }
      const [current] = await get(db, [id]);
      if (!current) throw new NotFound(`record ${id} is not in this brain`);
      const declared =
        (await catalog(db)).kinds.find((k) => k.name === current.kind)
          ?.properties ?? [];
      const title = String(form.get("title") ?? "").trim();
      if (!title) throw new Invalid("A record needs a title.");
      const version = Number(form.get("version"));
      if (!Number.isInteger(version))
        throw new Invalid("Reload and try again.");
      const kept = Object.fromEntries(
        Object.entries(current.props).filter(
          ([name]) => !declared.some((d) => d.name === name),
        ),
      );
      await edit(db, author, id, version, {
        title,
        body: String(form.get("body") ?? "").trim(),
        props: { ...kept, ...propsFrom(form, declared) },
        occurredAt: instantFrom(form.get("occurred_at")),
        confidence: confidenceFrom(form.get("confidence")) ?? undefined,
      });
    });
  } catch (err) {
    if (err instanceof Invalid || err instanceof NotFound) {
      return new Response(err.message, { status: 400 });
    }
    if (err instanceof Forbidden) {
      return new Response(err.message, { status: 403 });
    }
    if (err instanceof Conflict) {
      return new Response(
        "Someone changed this record while you were editing. Reload and try again.",
        { status: 409 },
      );
    }
    throw err;
  }
  return NextResponse.redirect(`${origin(request)}${recordHref(id)}`, 303);
}
