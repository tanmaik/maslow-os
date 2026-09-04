import { complete, machineFrom } from "@/lib/backups";

// A machine closing its backup with the parts it sent.
export async function POST(request: Request) {
  const m = await machineFrom(request);
  if (!m) return new Response(null, { status: 404 });
  const body = await request.json().catch(() => null);
  const parts = Array.isArray(body?.parts)
    ? body.parts.map((x: { partNumber: unknown; etag: unknown }) => ({
        partNumber: Number(x.partNumber),
        etag: String(x.etag ?? ""),
      }))
    : [];
  if (parts.length === 0) return new Response(null, { status: 400 });
  const done = await complete(m, String(body?.id ?? ""), parts);
  return new Response(null, { status: done ? 204 : 404 });
}
