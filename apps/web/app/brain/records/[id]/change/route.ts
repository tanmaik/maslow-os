import {
  Conflict,
  edit,
  Forbidden,
  get,
  history,
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
import { backTo, refused } from "../../../refuse";
import { fieldValue } from "../../../props";

// The number of the last change to one record, which a page watching it
// compares against the one it has.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!isId(id)) return new Response(null, { status: 404 });
  const [last] = await asPerson(p, (db) => history(db, { of: id, limit: 1 }));
  return NextResponse.json({ seen: last?.seq ?? 0 });
}

// Changes one record the way the form asked: removed, restored, unmerged,
// one of its links removed, or edited. An edit changes only what was
// posted: a title, a body, a field, when it happened, how sure; a field
// posted empty is taken away, and the door merges fields under a lock. A
// post that names the last change it saw is refused when what it sets
// changed since. A browser posting a form is sent back to the record; a
// page saving as it goes asks for JSON and gets the record's last change
// back, which is what its next save names.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const { id } = await params;
  if (!isId(id)) return new Response(null, { status: 404 });
  const form = await request.formData();
  // The view the change was made from, which the page comes back to.
  const back = backTo(form.get("back"), recordHref(id));
  const intent = String(form.get("intent") ?? "edit");
  const bare = request.headers.get("accept")?.includes("application/json");

  try {
    const seen = await asPerson(p, async (db) => {
      if (intent === "remove") return remove(db, id);
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
      if (!Object.keys(patch).length) return;
      if (form.has("seen")) {
        const seen = Number(form.get("seen"));
        if (!Number.isInteger(seen) || seen < 0)
          throw new Invalid("seen is a change number.");
        patch.seen = seen;
      }
      await edit(db, id, patch);
      return (await history(db, { of: id, limit: 1 }))[0]?.seq ?? 0;
    });
    if (bare) return NextResponse.json({ seen: seen ?? 0 });
  } catch (err) {
    const known =
      err instanceof Invalid ||
      err instanceof NotFound ||
      err instanceof Forbidden ||
      err instanceof Conflict;
    if (!known) throw err;
    if (bare) {
      return new Response(err.message, {
        status:
          err instanceof Forbidden ? 403 : err instanceof Conflict ? 409 : 400,
      });
    }
    return refused(request, back, err.message);
  }
  return NextResponse.redirect(`${origin(request)}${back}`, 303);
}
