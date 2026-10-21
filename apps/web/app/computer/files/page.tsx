import { redirect } from "next/navigation";

import { FileExplorer } from "@/app/computer/files/file-explorer";
import { principal } from "@/lib/session";
import { NoComputer } from "@/app/desktop/trial";
import { deployment } from "@/lib/deployment";

// The person's files, as a window: a folder's contents, a look at any one
// of them, a small edit, and somewhere to drop a file. Shaped to sit in a
// pane of the room, at any width it is given.
export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string; share?: string }>;
}) {
  // A trial has no computer, and says so in one line.
  if (deployment.trial)
    return (
      <main className="flex min-h-0 flex-1 flex-col">
        <NoComputer />
      </main>
    );
  const p = await principal();
  if (!p) redirect("/");
  const { path, share } = await searchParams;
  return (
    // A full-height panel takes the page shell's padding back: the list
    // reaches the bottom of the display and nothing scrolls under it.
    <main className="-mx-6 -mt-6 -mb-28 flex h-dvh min-h-0 flex-col">
      <h1 className="sr-only">Files</h1>
      <FileExplorer initialPath={path} initialShare={share} standalone />
    </main>
  );
}
