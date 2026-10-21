import { pageOf } from "@/lib/trial-pages";

// An app on the trial's pretend computer, as its window frames it. The
// proxy answers 404 for every /trial address outside a trial.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ port: string }> },
) {
  const page = pageOf((await params).port);
  if (!page) return new Response("Not found", { status: 404 });
  return new Response(page, {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}
