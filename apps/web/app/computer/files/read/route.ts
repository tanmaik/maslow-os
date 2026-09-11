import { files } from "@/lib/computer";
import { principal } from "@/lib/session";

// What a browser is told a file is, by its ending, so a picture shows as a
// picture and text as text; anything else is handed over as bytes.
const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  json: "text/plain; charset=utf-8",
  js: "text/plain; charset=utf-8",
  mjs: "text/plain; charset=utf-8",
  ts: "text/plain; charset=utf-8",
  tsx: "text/plain; charset=utf-8",
  css: "text/plain; charset=utf-8",
  html: "text/plain; charset=utf-8",
  sh: "text/plain; charset=utf-8",
  py: "text/plain; charset=utf-8",
  yml: "text/plain; charset=utf-8",
  yaml: "text/plain; charset=utf-8",
  toml: "text/plain; charset=utf-8",
};

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
    const answer = await f.read(at, request.headers.get("range") ?? undefined);
    const ending = at.split(".").pop()?.toLowerCase() ?? "";
    const carried = ["content-length", "content-range", "accept-ranges"];
    return new Response(answer.body, {
      status: answer.status,
      headers: {
        "content-type": TYPES[ending] ?? "application/octet-stream",
        ...Object.fromEntries(
          carried
            .filter((h) => answer.headers.has(h))
            .map((h) => [h, answer.headers.get(h)!]),
        ),
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
