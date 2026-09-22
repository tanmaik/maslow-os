import { orgOf } from "@maslow/db/settings";
import { redirect } from "next/navigation";

import { desktopOf } from "@/lib/desktop";
import { principal } from "@/lib/session";

import { Board } from "./board";

// Home: the org the person is in, the list of apps, and the widgets
// placed through the brain.
export default async function Home() {
  const p = await principal();
  if (!p) redirect("/");
  const [{ desktops, ports }, { org }] = await Promise.all([
    desktopOf(p),
    orgOf(p),
  ]);
  const widgets = (desktops[0]?.layout?.cards ?? []).filter(
    (c) => c.pinned && !c.minimized,
  );
  return (
    <main>
      <Board org={org.name} widgets={widgets} ports={ports} />
    </main>
  );
}
