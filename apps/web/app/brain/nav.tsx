"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

import { EagerLink } from "@/components/eager-link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

import { typeHref } from "./format";
import { TypeIcon } from "./type-icon";

// A type in the rail: its name, where it goes, and how many records it
// holds, which the bar beneath it draws.
type Kind = { name: string; href: string; held: number };

// The types one colleague shared into this brain, under their name.
type Shared = {
  owner: string;
  ownerId: string;
  types: Kind[];
  most: number;
};

function View({
  href,
  current,
  type,
  held,
  most,
  children,
}: {
  href: string;
  current: string;
  type?: string;
  held?: number;
  most?: number;
  children: ReactNode;
}) {
  return (
    <Button
      variant={href === current ? "secondary" : "ghost"}
      className="h-auto shrink-0 flex-col items-stretch gap-1 rounded-[10px] px-2.5 py-1.5 text-sm font-normal aria-[current]:font-medium"
      nativeButton={false}
      render={
        <EagerLink
          href={href}
          aria-current={href === current ? "page" : undefined}
        />
      }
    >
      <span className="flex min-w-0 items-center gap-2.5">
        {type && <TypeIcon type={type} />}
        {children}
      </span>
      {held !== undefined && most !== undefined && (
        // How much of the brain this type is, against the fullest one. The
        // number itself is bookkeeping; the length is what a person reads.
        <span
          aria-hidden
          className="bg-muted hidden h-[3px] overflow-hidden rounded-full md:block"
        >
          <span
            className="bg-foreground/35 block h-full rounded-full"
            style={{ width: `${Math.max(4, (held / most) * 100)}%` }}
          />
        </span>
      )}
    </Button>
  );
}

const Rule = () => <Separator className="mx-1 my-2 hidden w-auto md:block" />;

// The brain's views: everything, one view per type of the person's own with
// how full it is, the types shared into this brain under whose they are,
// then the types page. A brain with many types is narrowed by name.
export function BrainNav({
  records,
  types,
  shared,
  most,
}: {
  records: number;
  types: Kind[];
  shared: Shared[];
  most: number;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const [narrow, setNarrow] = useState("");
  const current =
    pathname === "/brain"
      ? typeHref(
          params.get("type") ?? undefined,
          params.get("from") ?? undefined,
        )
      : pathname;
  // The search belongs to the standing rail; a window narrowed until the
  // rail lies down has nowhere to type, so what was typed goes with it.
  useEffect(() => {
    const tall = window.matchMedia("(min-width: 48rem)");
    const follow = () => {
      if (!tall.matches) setNarrow("");
    };
    follow();
    tall.addEventListener("change", follow);
    return () => tall.removeEventListener("change", follow);
  }, []);
  const matches = (name: string) =>
    name.toLowerCase().includes(narrow.trim().toLowerCase());
  const mine = types.filter((t) => matches(t.name));
  const theirs = shared
    .map((g) => ({ ...g, types: g.types.filter((t) => matches(t.name)) }))
    .filter((g) => g.types.length > 0 || matches(g.owner));
  // Enough types that finding one by eye is work.
  const many = types.length + shared.reduce((n, g) => n + g.types.length, 0);

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
        {many > 12 && (
          <Input
            value={narrow}
            onChange={(e) => setNarrow(e.target.value)}
            placeholder="Find a type"
            aria-label="Find a type"
            className="bg-background mb-1 hidden h-7 rounded-[10px] text-xs md:block"
          />
        )}
        <View href="/brain" current={current}>
          Everything
        </View>
        {mine.map((t) => (
          <View
            key={t.href}
            href={t.href}
            current={current}
            type={t.name}
            held={t.held}
            most={most}
          >
            <span className="truncate">{t.name}</span>
          </View>
        ))}
        {theirs.map((g) => (
          <Group key={g.ownerId} group={g} current={current} most={g.most} />
        ))}
        <Rule />
        <View href="/brain/vocabulary" current={current}>
          Types and fields
        </View>
      </nav>
    </Card>
  );
}

// One colleague's types, folded under their name: open where one of them is
// the view being read, and opened by hand otherwise, so a brain twenty
// people share into is twenty names rather than a hundred types.
function Group({
  group,
  current,
  most,
}: {
  group: Shared;
  current: string;
  most: number;
}) {
  const here = group.types.some((t) => t.href === current);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Rule />
      <Button
        variant="ghost"
        aria-expanded={here || open}
        onClick={() => setOpen(!open)}
        className="text-muted-foreground h-7 shrink-0 justify-between gap-2 rounded-[10px] px-2.5 text-xs font-normal"
      >
        <span className="truncate">{group.owner} shared</span>
        <span className="text-muted-foreground/70">{group.types.length}</span>
      </Button>
      {(here || open) &&
        group.types.map((t) => (
          <View
            key={t.href}
            href={t.href}
            current={current}
            type={t.name}
            held={t.held}
            most={most}
          >
            <span className="truncate">{t.name}</span>
          </View>
        ))}
    </>
  );
}
