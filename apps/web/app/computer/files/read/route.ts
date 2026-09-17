import { files } from "@/lib/computer";
import { principal } from "@/lib/session";

import { served } from "../serve";

// One file of the person's home, streamed as it is, or the part a Range
// asks for, so a video plays from wherever it is scrubbed to.
export async function GET(request: Request) {
  const p = await principal();
  if (!p) return new Response(null, { status: 401 });
  const f = await files(p);
  if (!f) return new Response("Your computer is not ready.", { status: 409 });
  const at = new URL(request.url).searchParams.get("path") ?? "";
  if (!at) return new Response("Which file?", { status: 400 });
  try {
    return served(
      at,
      await f.read(at, request.headers.get("range") ?? undefined),
    );
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
