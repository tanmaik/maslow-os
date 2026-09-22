import { notFound, redirect } from "next/navigation";

import { principal } from "@/lib/session";

// An app, as a pane of the shell: the port it is served on, framed as the
// outside page it is. Only a port's own address is framed; whether the
// person may reach it is decided where that address is answered.
export default async function Open({
  searchParams,
}: {
  searchParams: Promise<{ at?: string; title?: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  const { at, title } = await searchParams;
  if (!at || !/^\/port\/[a-z0-9]{6,20}\/\d{1,5}$/.test(at)) notFound();
  return (
    <main>
      <h1 className="sr-only">{title ?? "App"}</h1>
      <iframe
        src={at}
        title={title ?? "App"}
        className="size-full bg-background"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
        allow="microphone; camera; display-capture; clipboard-read; clipboard-write"
      />
    </main>
  );
}
