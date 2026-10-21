import { newShell, run } from "@/lib/trial-computer";

// One line of the trial's shell, answered from the same script the
// Terminal plays in the page; each ask starts in the home folder.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    line?: unknown;
  } | null;
  if (typeof body?.line !== "string")
    return new Response("Which line?", { status: 400 });
  return Response.json(run(newShell(), body.line.slice(0, 1000)));
}
