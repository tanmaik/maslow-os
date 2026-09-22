import { redirect } from "next/navigation";

import { Look } from "@/app/computer/files/look";
import { principal } from "@/lib/session";

// One file of the person's, as a page of its own: what the Preview window
// shows on the desktop, reachable by address.
export default async function ViewPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string; share?: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const { path, share } = await searchParams;
  const href = share
    ? `/computer/files/view?share=${encodeURIComponent(share)}&path=${encodeURIComponent(path ?? "")}`
    : path
      ? `/computer/files/view?path=${encodeURIComponent(path)}`
      : undefined;
  return (
    <main className="-mx-6 -mt-6 -mb-28 flex h-dvh min-h-0 flex-col [html[data-framed]_&]:m-0 [html[data-framed]_&]:h-full">
      <h1 className="sr-only">{path?.split("/").at(-1) ?? "Preview"}</h1>
      <Look href={href} />
    </main>
  );
}
