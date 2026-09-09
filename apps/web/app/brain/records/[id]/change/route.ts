import {
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
  type Patch,
} from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { NextResponse } from "next/server";

import { origin } from "@/lib/origin";
import { principal } from "@/lib/session";

import { vocabulary } from "../../../catalog";
import { recordHref } from "../../../format";
import { confidenceFrom, fieldValue, instantFrom } from "../../../props";

// Changes one record the way the form asked: deleted, restored, unmerged,
// one of its links removed, or edited. An edit changes only what was
// posted: a title, a body, a field, when it happened, how sure; a field
// posted empty is taken away, and the door merges fields under a lock. A browser posting a form is sent back to the
// record; a page saving as it goes asks for JSON and gets a bare answer.
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
  const bare = request.headers.get("accept")?.includes("application/json");

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
      const patch: Patch = {};
      if (form.has("title")) {
        patch.title = String(form.get("title")).trim();
        if (!patch.title) throw new Invalid("A record needs a title.");
      }
      if (form.has("body")) patch.body = String(form.get("body")).trim();
      const declared =
        (await vocabulary(p)).types.find(
          (t) => t.name === current.type && t.ownerId === current.ownerId,
        )?.properties ?? [];
      const posted = declared.filter((f) => form.has(`p.${f.name}`));
      if (posted.length) {
        patch.fields = Object.fromEntries(
          posted.map((f) => [
            f.name,
            fieldValue(f, String(form.get(`p.${f.name}`))) ?? null,
          ]),
        );
      }
      if (form.has("occurred_at")) {
        patch.occurredAt = instantFrom(form.get("occurred_at"));
      }
      if (form.has("confidence")) {
        patch.confidence = confidenceFrom(form.get("confidence"));
      }
      if (Object.keys(patch).length) await edit(db, id, patch);
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
  if (bare) return new Response(null, { status: 204 });
  return NextResponse.redirect(`${origin(request)}${recordHref(id)}`, 303);
}
