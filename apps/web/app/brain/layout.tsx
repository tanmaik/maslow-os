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
  const { types, records, held, people } = await vocabulary(p);
  const groups = sharedGroups(types, people);
  // An owner goes by first name unless another owner shares it.
  const first = (name: string) => name.split(" ")[0]!;
  const short = (name: string) =>
    groups.filter((g) => first(g.owner) === first(name)).length > 1
      ? name
      : first(name);
  // A bar is read against the fullest type beside it, not the fullest in
  // the brain: a colleague who shared a thousand would otherwise flatten
  // every type of the person's own to nothing.
  const fullest = (kinds: { held: number }[]) =>
    Math.max(1, ...kinds.map((k) => k.held));
  const shared = groups.map((g) => {
    const kinds = g.types.map((t) => ({
      name: t.name,
      href: typeHref(t.name, t.ownerId),
      held: held.get(`${t.ownerId}:${t.name}`) ?? 0,
    }));
    return {
      owner: short(g.owner),
      ownerId: g.ownerId,
      types: kinds,
      most: fullest(kinds),
    };
  });
  const mine = types
    .filter((t) => t.own)
    .map((t) => ({
      name: t.name,
      href: typeHref(t.name),
      held: held.get(`${t.ownerId}:${t.name}`) ?? 0,
    }));

  return (
    <div className="brain-layout gap-6 md:grid md:grid-cols-[13.75rem_minmax(0,1fr)]">
      <BrainNav
        records={records}
        types={mine}
        shared={shared}
        most={fullest(mine)}
      />
      <main className="mt-4 min-h-full min-w-0 md:mt-0">{children}</main>
    </div>
  );
}
