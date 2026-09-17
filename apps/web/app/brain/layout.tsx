import { requestsOf } from "@maslow/brain";
import { asPerson } from "@maslow/db";
import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { principal } from "@/lib/session";

import { vocabulary } from "./catalog";
import { sharedGroups, typeHref } from "./format";
import { BrainNav } from "./nav";
import { Notice } from "./notice";

// The signed-in person's brain: a rail of its views beside whichever one is
// open.
export default async function Layout({ children }: { children: ReactNode }) {
  const p = await principal();
  if (!p) redirect("/");
  const [{ types, records, held, people }, waiting] = await Promise.all([
    vocabulary(p),
    asPerson(p, async (db) => (await requestsOf(db)).length),
  ]);
  const groups = sharedGroups(types, people);
  // An owner goes by first name unless another owner shares it.
  const first = (name: string) => name.split(" ")[0]!;
  const short = (name: string) =>
    groups.filter((g) => first(g.owner) === first(name)).length > 1
      ? name
      : first(name);
  const shared = groups.map((g) => {
    const kinds = g.types.map((t) => ({
      name: t.name,
      href: typeHref(t.name, t.ownerId),
      held: held.get(`${t.ownerId}:${t.name}`) ?? 0,
    }));
    return { owner: short(g.owner), ownerId: g.ownerId, types: kinds };
  });
  const mine = types
    .filter((t) => t.own)
    .map((t) => ({
      name: t.name,
      href: typeHref(t.name),
      held: held.get(`${t.ownerId}:${t.name}`) ?? 0,
    }));

  return (
    <div className="brain-layout gap-4 md:grid md:grid-cols-[14rem_minmax(0,1fr)]">
      <BrainNav
        records={records}
        waiting={waiting}
        types={mine}
        shared={shared}
      />
      <main className="mt-4 min-h-full min-w-0 md:mt-0">
        <Suspense>
          <Notice />
        </Suspense>
        {children}
      </main>
    </div>
  );
}
