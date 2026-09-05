import { read } from "@/lib/storage";

const TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

// Serves an uploaded image. A key is unguessable and its bytes never
// change, so it is only ever known to whoever was shown it, and the
// response can be cached forever.
export async function GET(
  _: Request,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const m = /^([0-9a-f]{32})\.(png|jpg|webp)$/.exec(key);
  if (!m) return new Response(null, { status: 404 });
  const bytes = await read(key);
  if (!bytes) return new Response(null, { status: 404 });
  return new Response(Buffer.from(bytes), {
    headers: {
      "content-type": TYPE[m[2]!]!,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
