import { files } from "@/lib/computer";
import { principal } from "@/lib/session";

// A small picture of one file of the person's home, made on their machine:
// a photo scaled down, a video's first second, a PDF's first page.
export async function GET(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const f = await files(p);
  if (!f) return new Response("Your computer is not ready.", { status: 409 });
  const at = new URL(request.url).searchParams.get("path") ?? "";
  if (!at) return new Response("Which file?", { status: 400 });
  try {
    const answer = await f.preview(at);
    return new Response(answer.body, {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "private, max-age=3600",
        ...(answer.headers.get("content-length")
          ? { "content-length": answer.headers.get("content-length")! }
          : {}),
      },
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
