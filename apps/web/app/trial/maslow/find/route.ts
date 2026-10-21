import { findFiles } from "@/lib/trial-computer";

// Search over the trial's pretend home folder, as a door answers it.
export function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json(q.trim().length < 2 ? [] : findFiles(q.trim()));
}
