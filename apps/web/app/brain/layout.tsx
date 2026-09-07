import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { principal } from "@/lib/session";

import { vocabulary } from "./catalog";
import { sharedGroups, typeHref } from "./format";
import { BrainNav } from "./nav";

// The signed-in person's brain, as a database with views: a rail of views
// beside whichever one is open.
export default async function Layout({ children }: { children: ReactNode }) {
  const p = await principal();
  if (!p) redirect("/");
  const { types, people } = await vocabulary(p);
  const shared = sharedGroups(types, people).map((g) => ({
    owner: g.owner,
    types: g.types.map((t) => ({
      name: t.name,
      href: typeHref(t.name, t.ownerId),
    })),
  }));

  return (
    <div className="gap-6 md:grid md:grid-cols-[11rem_minmax(0,1fr)]">
      <BrainNav
        types={types.filter((t) => t.own).map((t) => t.name)}
        shared={shared}
      />
      <main className="mt-4 min-w-0 space-y-4 md:mt-0">{children}</main>
    </div>
  );
}
