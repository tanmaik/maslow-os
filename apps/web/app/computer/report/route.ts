import { computerOfIn, report, type Said } from "@placeholder/db/computers";
import { after } from "next/server";

import { sizeIn } from "@/lib/computer";

// Vercel gives this request this long: a report can end in a machine
// made again at another size.
export const maxDuration = 300;

// Reports one machine may make per ten minutes, counted only once the
// machine has proved it is that machine and before anything it said is
// kept: a header anyone can copy must not spend another machine's
// allowance, and a report over the limit must not leave a mark. The daemon makes one report every
// five minutes; the limit is loose enough for a machine that reboots and
// reports again. What a report can buy is bounded by the ladder's own
// cooldown, not by this.
const PER_MACHINE = 60;
const WINDOW = 10 * 60;

const num = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x) && x >= 0;

// A machine reporting on itself: its id, its secret, how full its disk is
// and what it has and needs. A stranger gets the same 404 as a machine we
// never made. Once answered, the ladder has its word.
export async function POST(request: Request) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const machineId = request.headers.get("fly-machine-id");
  if (!secret || !machineId) return new Response(null, { status: 404 });
  let said: Said;
  try {
    const b = (await request.json()) as Record<string, unknown> & {
      disk?: { used?: unknown; total?: unknown };
      memory?: { total?: unknown; available?: unknown };
    };
    if (!(
      num(b.disk?.used) &&
      num(b.disk?.total) &&
      b.disk.used <= b.disk.total
    ))
      throw new Error();
    said = { disk: { used: b.disk.used, total: b.disk.total } };
    if (b.memory !== undefined) {
      if (!(
        num(b.memory?.total) &&
        num(b.memory?.available) &&
        b.memory.total > 0 &&
        b.memory.available <= b.memory.total
      ))
        throw new Error();
      said.memory = { total: b.memory.total, available: b.memory.available };
    }
    for (const k of ["oom", "load", "terminals", "landings"] as const) {
      if (b[k] === undefined) continue;
      if (!num(b[k])) throw new Error();
      said[k] = b[k];
    }
  } catch {
    return new Response(null, { status: 400 });
  }
  // The allowance is spent inside the report, once the secret has proved
  // whose machine this is and before a word of it is written: a stranger
  // with a copied id cannot starve the machine it names, and a machine
  // over its limit writes nothing.
  const known = await report(machineId, secret, said, {
    hits: PER_MACHINE,
    seconds: WINDOW,
  });
  if (!known) return new Response(null, { status: 404 });
  if (known === "too-often") return new Response(null, { status: 429 });
  after(async () => {
    try {
      const c = await computerOfIn(known.orgId, known.id);
      if (c) await sizeIn(known.orgId, c);
    } catch (err) {
      console.error(`sizing ${known.id}: ${(err as Error).message}`);
    }
  });
  return new Response(null, { status: 204 });
}
