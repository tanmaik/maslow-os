import { redirect } from "next/navigation";

import { Look } from "@/app/computer/files/look";
import { principal } from "@/lib/session";

// One file of the person's, as a page of its own: what the Preview window
// shows on the desk, reachable by address.
export default async function ViewPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const { path } = await searchParams;
  const href = path
    ? `/computer/files/view?path=${encodeURIComponent(path)}`
    : undefined;
  return (
    <main className="-mx-6 -mt-6 -mb-28 flex h-dvh min-h-0 flex-col">
      <h1 className="sr-only">{path?.split("/").at(-1) ?? "Preview"}</h1>
      <Look href={href} />
    </main>
  );
}
