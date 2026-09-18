import { NextResponse } from "next/server";

import { principal } from "@/lib/session";

import { vocabulary } from "../catalog";

// The vocabulary as the phone's rail shows it: every type the person may
// see with how many records it holds and whose it is, and how many records
// of their own the brain holds.
export async function GET() {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const { types, records, held, people } = await vocabulary(p);
  return NextResponse.json(
    {
      records,
      types: types.map((t) => ({
        id: t.id,
        name: t.name,
        own: t.own,
        ownerId: t.ownerId,
        owner: people.get(t.ownerId) ?? null,
        records: held.get(`${t.ownerId}:${t.name}`) ?? 0,
        properties: t.properties.map((f) => ({
          name: f.name,
          datatype: f.datatype,
          required: f.required,
          options: f.options,
        })),
      })),
    },
    { headers: { "cache-control": "no-store" } },
  );
}
