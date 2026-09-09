import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { principal } from "@/lib/session";

import { vocabulary } from "./catalog";
import { sharedGroups, typeHref } from "./format";
import { BrainNav } from "./nav";

// The signed-in person's brain: a rail of its views beside whichever one is
// open.
export default async function Layout({ children }: { children: ReactNode }) {
  const p = await principal();
  if (!p) redirect("/");
  const { types, records, people } = await vocabulary(p);
  const groups = sharedGroups(types, people);
  // An owner goes by first name unless another owner shares it.
  const first = (name: string) => name.split(" ")[0]!;
  const short = (name: string) =>
    groups.filter((g) => first(g.owner) === first(name)).length > 1
      ? name
      : first(name);
  const shared = groups.flatMap((g) =>
    g.types.map((t) => ({
      name: t.name,
      owner: short(g.owner),
      href: typeHref(t.name, t.ownerId),
    })),
  );

  return (
    <div className="gap-6 md:grid md:grid-cols-[13.75rem_minmax(0,1fr)]">
      <BrainNav
        records={records}
        types={types.filter((t) => t.own).map((t) => t.name)}
        shared={shared}
      />
      <main className="mt-4 min-w-0 md:mt-0">{children}</main>
    </div>
  );
}
