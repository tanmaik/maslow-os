"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

import { EagerLink } from "@/components/eager-link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import { typeHref } from "./format";
import { TypeIcon } from "./type-icon";

// A type shared into this brain, with whose it is.
type SharedType = { name: string; owner: string; href: string };

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
      className="h-8 shrink-0 justify-start gap-2.5 rounded-[10px] px-2.5 text-sm font-normal aria-[current]:font-medium"
      nativeButton={false}
      render={
        <EagerLink
          href={href}
          aria-current={href === current ? "page" : undefined}
        />
      }
    >
      {type && <TypeIcon type={type} />}
      {children}
    </Button>
  );
}

const Rule = () => <Separator className="mx-1 my-2 hidden w-auto md:block" />;

// The brain's views: everything, one view per type of the person's own, the
// types shared into this brain with whose they are, then the types page.
// The current one is marked.
export function BrainNav({
  records,
  types,
  shared,
}: {
  records: number;
  types: string[];
  shared: SharedType[];
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
    <Card
      className="brain-nav gap-0 rounded-2xl p-2"
      data-away={pathname === "/brain" ? undefined : ""}
    >
      <nav className="flex gap-0.5 overflow-x-auto md:flex-col md:overflow-visible">
        <div className="hidden items-baseline justify-between px-2.5 pt-0.5 pb-1.5 text-xs md:flex">
          <span className="text-muted-foreground font-medium">Your brain</span>
          <span className="text-muted-foreground/70">
            {records} {records === 1 ? "record" : "records"}
          </span>
        </div>
        <View href="/brain" current={current}>
          Everything
        </View>
        {types.map((t) => (
          <View key={t} href={typeHref(t)} current={current} type={t}>
            {t}
          </View>
        ))}
        {shared.length > 0 && (
          <>
            <Rule />
            <span className="text-muted-foreground hidden px-2.5 pb-1 text-[11.5px] md:block">
              Shared into your brain
            </span>
            {shared.map((t) => (
              <View key={t.href} href={t.href} current={current} type={t.name}>
                <span className="flex-1 truncate">{t.name}</span>
                <span className="text-muted-foreground text-[11.5px]">
                  {t.owner}&apos;s
                </span>
              </View>
            ))}
          </>
        )}
        <Rule />
        <View href="/brain/vocabulary" current={current}>
          Types and fields
        </View>
      </nav>
    </Card>
  );
}
