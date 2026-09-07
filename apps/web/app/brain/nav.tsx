"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { kindHref } from "./format";
import { KindIcon } from "./kind-icon";

// Kinds shared into this brain by one person in one way, as the rail lists
// them.
type SharedNav = {
  owner: string;
  how: string;
  kinds: { name: string; href: string }[];
};

function View({
  href,
  current,
  kind,
  children,
}: {
  href: string;
  current: string;
  kind?: string;
  children: ReactNode;
}) {
  return (
    <Button
      variant={href === current ? "secondary" : "ghost"}
      size="sm"
      className={`shrink-0 justify-start ${kind ? "md:ml-3" : ""}`}
      nativeButton={false}
      render={<a href={href} />}
    >
      {kind && <KindIcon kind={kind} />}
      {children}
    </Button>
  );
}

// The brain's views: every record, one view per kind of the person's own,
// the kinds shared into this brain grouped by owner and how they were
// opened, then the vocabulary, the log and the file door. The current one
// is marked.
export function BrainNav({
  kinds,
  shared,
}: {
  kinds: string[];
  shared: SharedNav[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current =
    pathname === "/brain"
      ? kindHref(
          params.get("kind") ?? undefined,
          params.get("from") ?? undefined,
        )
      : pathname;
  return (
    <nav className="flex flex-wrap gap-1 md:flex-col">
      <View href="/brain" current={current}>
        Records
      </View>
      {kinds.map((k) => (
        <View key={k} href={kindHref(k)} current={current} kind={k}>
          {k}
        </View>
      ))}
      {shared.length > 0 && <Separator className="my-2 hidden md:block" />}
      {shared.map((g) => (
        <span key={`${g.owner}:${g.how}`} className="contents">
          <p className="text-muted-foreground w-full px-2 pt-1 text-xs md:w-auto">
            {g.owner}, {g.how}
          </p>
          {g.kinds.map((k) => (
            <View key={k.href} href={k.href} current={current} kind={k.name}>
              {k.name}
            </View>
          ))}
        </span>
      ))}
      <Separator className="my-2 hidden md:block" />
      <View href="/brain/vocabulary" current={current}>
        Vocabulary
      </View>
      <View href="/brain/activity" current={current}>
        Activity
      </View>
    </nav>
  );
}
