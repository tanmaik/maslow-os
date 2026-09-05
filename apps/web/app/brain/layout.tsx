import { catalog } from "@placeholder/brain";
import { asPerson } from "@placeholder/db";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { principal } from "@/lib/session";

import { kindHref, sharedGroups } from "./format";
import { peopleOf } from "./people";
import { BrainNav } from "./nav";

// The signed-in person's brain, as a database with views: a rail of views
// beside whichever one is open.
export default async function Layout({ children }: { children: ReactNode }) {
  const p = await principal();
  if (!p) redirect("/");
  const { kinds, people } = await asPerson(p, async (db) => ({
    ...(await catalog(db)),
    people: await peopleOf(db),
  }));
  const shared = sharedGroups(kinds, people).map((g) => ({
    owner: g.owner,
    how: g.how,
    kinds: g.kinds.map((k) => ({
      name: k.name,
      href: kindHref(k.name, k.ownerId),
    })),
  }));

  return (
    <div className="gap-6 md:grid md:grid-cols-[11rem_minmax(0,1fr)]">
      <BrainNav
        kinds={kinds.filter((k) => !k.via).map((k) => k.name)}
        shared={shared}
      />
      <main className="mt-4 min-w-0 space-y-4 md:mt-0">{children}</main>
    </div>
  );
}
