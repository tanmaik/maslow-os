import { abort, machineFrom } from "@/lib/backups";

// A machine giving up on a backup: its parts go.
export async function POST(request: Request) {
  const m = await machineFrom(request);
  if (!m) return new Response(null, { status: 404 });
  const body = await request.json().catch(() => null);
  await abort(m, String(body?.id ?? ""));
  return new Response(null, { status: 204 });
}
