import { files } from "@/lib/computer";
import { principal } from "@/lib/session";

// One file of the person's home as a whole PDF, every page, for the
// browser's own viewer: a PDF as it is, a document made into one on their
// machine.
export async function GET(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const f = await files(p);
  if (!f) return new Response("Your computer is not ready.", { status: 409 });
  const at = new URL(request.url).searchParams.get("path") ?? "";
  if (!at) return new Response("Which file?", { status: 400 });
  try {
    const answer = await f.pdf(at);
    return new Response(answer.body, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition":
          answer.headers.get("content-disposition") ?? "inline",
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
