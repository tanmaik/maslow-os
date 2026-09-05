import { computerOfIn, report, type Said } from "@placeholder/db/computers";
import { after } from "next/server";

import { sizeIn } from "@/lib/computer";

// Vercel gives this request this long: a report can end in a machine
// made again at another size.
export const maxDuration = 120;

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
    const b = await request.json();
    const { disk, memory, oom, load, terminals } = b;
    if (!(num(disk?.used) && num(disk?.total) && disk.used <= disk.total))
      throw new Error();
    said = { disk: { used: disk.used, total: disk.total } };
    if (memory !== undefined) {
      if (!(
        num(memory?.total) &&
        num(memory?.available) &&
        memory.total > 0 &&
        memory.available <= memory.total
      ))
        throw new Error();
      said.memory = { total: memory.total, available: memory.available };
    }
    if (oom !== undefined) {
      if (!num(oom)) throw new Error();
      said.oom = oom;
    }
    if (load !== undefined) {
      if (!num(load)) throw new Error();
      said.load = load;
    }
    if (terminals !== undefined) {
      if (!num(terminals)) throw new Error();
      said.terminals = terminals;
    }
  } catch {
    return new Response(null, { status: 400 });
  }
  const known = await report(machineId, secret, said);
  if (!known) return new Response(null, { status: 404 });
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
