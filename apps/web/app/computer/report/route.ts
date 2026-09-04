import { report } from "@placeholder/db/computers";

// A machine reporting on itself: its id, its secret, and how full its disk
// is. A stranger gets the same 404 as a machine we never made.
export async function POST(request: Request) {
  const secret = request.headers.get("authorization")?.replace(/^Bearer /, "");
  const machineId = request.headers.get("fly-machine-id");
  if (!secret || !machineId) return new Response(null, { status: 404 });
  let disk: { used: number; total: number };
  try {
    disk = (await request.json()).disk;
    if (!(disk.used >= 0 && disk.total >= 0 && disk.used <= disk.total))
      throw new Error();
  } catch {
    return new Response(null, { status: 400 });
  }
  const known = await report(machineId, secret, disk);
  return new Response(null, { status: known ? 204 : 404 });
}
