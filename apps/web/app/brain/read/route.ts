import { Invalid, opened, type Property, type Sort } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { NextResponse } from "next/server";

import { principal } from "@/lib/session";

import { vocabulary } from "../catalog";
import { peopleOf } from "../people";
import { narrowFrom, termsFrom, WHEN } from "../views/query";

// A page of records as a list shows them, newest first: a type's, one
// owner's, the ones matching a query, or the whole brain, with the opening
// line of each body and the next page's cursor. Conditions arrive as
// `where=<field>:<comparison>:<value>`, as many as were set, and the sort
// as a field and a direction; several conditions come as one parameter a
// line each, or as the parameter repeated. The read door narrows, and
// nothing narrows here.
export async function GET(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const asked = new URL(request.url).searchParams;
  const one = (k: string) => asked.get(k)?.trim() || undefined;
  const limit = Math.min(Number(asked.get("limit")) || 50, 200);
  const type = one("type");
  const owner = one("owner");
  const terms = termsFrom(asked.getAll("where").flatMap((v) => v.split("\n")));
  // A condition is checked against the declaration of the field it names,
  // which is the type's owner's, or the reader's own where there is none.
  let declared: Property[] = [];
  if (type && terms.length) {
    declared =
      (await vocabulary(p)).types.find(
        (t) => t.name === type && (owner ? t.ownerId === owner : t.own),
      )?.properties ?? [];
  }
  const { where, since, until } = narrowFrom(terms, declared);
  const by = one("sort");
  const direction = one("dir") === "asc" ? "asc" : "desc";
  const orderBy: Sort | undefined =
    by || asked.has("dir")
      ? { property: by && by !== WHEN ? by : undefined, direction }
      : undefined;
  try {
    const page = await asPerson(p, async (db) => {
      const page = await opened(db, {
        type,
        owner,
        query: one("q"),
        cursor: one("cursor"),
        where: where.length ? where : undefined,
        since,
        until,
        orderBy,
        limit,
      });
      const people = await peopleOf(db);
      return {
        cursor: page.cursor,
        records: page.records.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          opening: r.body.split("\n")[0] ?? "",
          updatedAt: r.updatedAt,
          ownerId: r.ownerId,
          owner:
            r.ownerId === p.userId ? null : (people.get(r.ownerId) ?? null),
        })),
      };
    });
    return NextResponse.json(page, {
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    if (err instanceof Invalid)
      return NextResponse.json({ said: err.message }, { status: 400 });
    throw err;
  }
}
