import { redirect } from "next/navigation";

import { Finder } from "@/app/computer/files/finder";
import { principal } from "@/lib/session";

// The person's files, as a window: a folder's contents, a look at any one
// of them, a small edit, and somewhere to drop a file. Shaped to sit in a
// pane of the room, at any width it is given.
export default async function FilesPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const { path } = await searchParams;
  return (
    // A full-height panel takes the page shell's padding back: the list
    // reaches the bottom of the display and nothing scrolls under it.
    <main className="-mx-6 -mt-6 -mb-28 flex h-dvh min-h-0 flex-col">
      <h1 className="sr-only">Files</h1>
      <Finder initialPath={path} standalone />
    </main>
  );
}
