import { pdfShared } from "@/lib/shares";

import { opened, refused } from "../opened";

// One file of a shared thing as a whole PDF for the browser's own viewer:
// a document made into one on the owner's machine, which has to be up.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const got = await opened(request, params);
  if (!got) return new Response("Not found", { status: 404 });
  try {
    const answer = await pdfShared(got.o, got.at);
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
    return refused(err);
  }
}
