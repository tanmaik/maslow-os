"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { EagerLink } from "@/components/eager-link";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import { typeHref } from "./format";
import { TypeIcon } from "./type-icon";

// Types shared into this brain by one person, as the rail lists them.
type SharedNav = {
  owner: string;
  types: { name: string; href: string }[];
};

function View({
  href,
  current,
  type,
  children,
}: {
  href: string;
  current: string;
  type?: string;
  children: ReactNode;
}) {
  return (
    <Button
      variant={href === current ? "secondary" : "ghost"}
      size="sm"
      className={`shrink-0 justify-start ${type ? "md:ml-3" : ""}`}
      nativeButton={false}
      render={<EagerLink href={href} />}
    >
      {type && <TypeIcon type={type} />}
      {children}
    </Button>
  );
}

// The brain's views: every record, one view per type of the person's own,
// the types shared into this brain grouped by owner, then the types page.
// The current one is marked.
export function BrainNav({
  types,
  shared,
}: {
  types: string[];
  shared: SharedNav[];
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current =
    pathname === "/brain"
      ? typeHref(
          params.get("type") ?? undefined,
          params.get("from") ?? undefined,
        )
      : pathname;
  return (
    <nav className="flex flex-wrap gap-1 md:flex-col">
      <View href="/brain" current={current}>
        Records
      </View>
      {types.map((t) => (
        <View key={t} href={typeHref(t)} current={current} type={t}>
          {t}
        </View>
      ))}
      {shared.length > 0 && <Separator className="my-2 hidden md:block" />}
      {shared.map((g) => (
        <span key={g.owner} className="contents">
          <p className="text-muted-foreground w-full px-2 pt-1 text-xs md:w-auto">
            {g.owner}&apos;s
          </p>
          {g.types.map((t) => (
            <View key={t.href} href={t.href} current={current} type={t.name}>
              {t.name}
            </View>
          ))}
        </span>
      ))}
      <Separator className="my-2 hidden md:block" />
      <View href="/brain/vocabulary" current={current}>
        Types
      </View>
    </nav>
  );
}
