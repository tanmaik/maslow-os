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

// What a browser is told a file is, by its name.
export const typeOf = (name: string) =>
  TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ??
  "application/octet-stream";

// A file's bytes as a door or a bucket answered them, handed on with the
// type its name says, the length and range carried through, and a picture
// that could carry a script shown as no one.
export function served(name: string, answer: Response): Response {
  const ending = name.split(".").pop()?.toLowerCase() ?? "";
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
      ...(TYPES[ending] === "image/svg+xml"
        ? { "content-security-policy": "sandbox" }
        : {}),
    },
  });
}
