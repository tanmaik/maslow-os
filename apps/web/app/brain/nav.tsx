"use client";

import { RiBrainLine, RiSearchLine, RiShapesLine } from "@remixicon/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";

import { Divider } from "@/components/base/divider/divider";
import { Input } from "@/components/base/input/input";
import { EagerLink } from "@/components/eager-link";
import { cx } from "@/utils/cx";

import { typeColor, typeHref } from "./format";
import { TypeIcon } from "./type-icon";

// A type in the rail: its name, where it goes, and how many records it
// holds, which the rule under its name draws.
type Kind = { name: string; href: string; held: number };

// The types one colleague shared into this brain, under their name.
type Shared = {
  owner: string;
  ownerId: string;
  types: Kind[];
  most: number;
};

type Mark = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

// One view of the brain, as a row of the rail: its mark, its name, and how
// many records it holds at its right. The one being read is lit in the
// accent; a type's row carries a rule along its bottom edge as wide as the
// type is full, against the fullest beside it.
function View({
  href,
  current,
  mark: Mark,
  type,
  held,
  most,
  count,
  waiting,
  name,
  children,
}: {
  href: string;
  current: string;
  mark?: Mark;
  type?: string;
  held?: number;
  most?: number;
  count?: number;
  // How many asks wait on the person, which is not a count of records and
  // does not read as one.
  waiting?: number;
  // What the row is called where its name is too wide to show.
  name?: string;
  children: ReactNode;
}) {
  const lit = href === current;
  const share =
    held !== undefined && most !== undefined
      ? Math.max(4, (held / most) * 100)
      : null;
  return (
    <EagerLink
      href={href}
      aria-label={name}
      title={name}
      aria-current={lit ? "page" : undefined}
      className={cx(
        "relative flex min-h-10 shrink-0 items-center justify-between gap-2 overflow-hidden rounded-2lg px-2 py-2.5 outline-none",
        "transition-colors duration-fast ease-plain focus-visible:ring-2 focus-visible:ring-border-focus-ring",
        lit
          ? "bg-linear-to-b from-accent-500 to-accent-600 shadow-nav-selected"
          : "hover:bg-background-secondary-hover",
      )}
    >
      {share !== null && !lit && (
        <span
          aria-hidden
          className="absolute bottom-1 left-2 hidden h-[3px] rounded-full md:block"
          style={{
            width: `calc((100% - 1rem) * ${share / 100})`,
            backgroundColor: typeColor(type!),
          }}
        />
      )}
      <span className="relative flex min-w-0 items-center gap-2">
        <span
          className={cx(
            "flex size-5 shrink-0 items-center justify-center",
            lit ? "text-text-white" : "text-foreground-icon-secondary",
          )}
        >
          {Mark ? (
            <Mark className="size-5" aria-hidden />
          ) : type ? (
            <TypeIcon type={type} className="size-2.5 rounded-[3px]" />
          ) : null}
        </span>
        <span
          className={cx(
            "truncate text-body-medium whitespace-nowrap",
            lit ? "text-text-white" : "text-text-secondary",
          )}
        >
          {children}
        </span>
      </span>
      {waiting ? (
        <span className="relative hidden shrink-0 rounded-full bg-accent-600 px-2 py-0.5 text-caption-1-semibold text-text-white tabular-nums md:inline">
          {waiting} waiting
        </span>
      ) : count !== undefined ? (
        <span
          className={cx(
            "relative hidden text-caption-1-regular tabular-nums md:inline",
            lit ? "text-text-white" : "text-text-secondary",
          )}
        >
          {count}
        </span>
      ) : null}
    </EagerLink>
  );
}

// A band's heading: whose types follow, in a quiet line.
function Heading({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="hidden items-center justify-between gap-2 pl-2 md:flex">
      <span className="truncate text-caption-1-semibold text-text-secondary">
        {children}
      </span>
      {count !== undefined && (
        <span className="text-caption-1-regular text-text-secondary tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

// The brain's views: everything, one view per type of the person's own with
// how full it is, the types shared into this brain under whose they are,
// then the types page. A brain with many types is narrowed by name.
export function BrainNav({
  records,
  waiting,
  types,
  shared,
  most,
}: {
  records: number;
  // How many asks wait on the person, which the front view carries.
  waiting: number;
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
    <div
      className="brain-nav flex gap-1 rounded-3xl border border-border-button-default bg-background-secondary-default p-3 shadow-sidebar md:flex-col"
      // A record is read on its own, with its own way back; every other
      // view of the brain keeps the rail beside it.
      data-away={pathname.startsWith("/brain/records") ? "" : undefined}
    >
      <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] md:flex-col md:overflow-visible md:[mask-image:none]">
        <Heading count={records}>Your brain</Heading>
        {many > 12 && (
          <Input
            size="small"
            value={narrow}
            onChange={setNarrow}
            placeholder="Find a type"
            aria-label="Find a type"
            leadingIcon={RiSearchLine}
            className="mb-1 hidden md:block"
          />
        )}
        <View
          href="/brain"
          current={current}
          mark={RiBrainLine}
          waiting={waiting}
        >
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
            count={t.held}
          >
            {t.name}
          </View>
        ))}
        {theirs.map((g) => (
          <Group key={g.ownerId} group={g} current={current} most={g.most} />
        ))}
      </nav>
      <Divider className="my-2 hidden md:block" />
      {/* Pinned outside the strip a phone's rail becomes, as its mark alone:
          the types are what the strip is for. */}
      <View
        href="/brain/vocabulary"
        current={current}
        mark={RiShapesLine}
        name="Types and fields"
      >
        <span className="hidden md:inline">Types and fields</span>
      </View>
    </div>
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
      <Divider className="my-2 hidden md:block" />
      <button
        type="button"
        aria-expanded={here || open}
        onClick={() => setOpen(!open)}
        className="hidden shrink-0 cursor-pointer items-center justify-between gap-2 rounded-2lg py-1 pr-2 pl-2 text-left outline-none transition-colors duration-fast ease-plain hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring md:flex"
      >
        <span className="truncate text-caption-1-semibold text-text-secondary">
          {group.owner} shared
        </span>
        <span className="text-caption-1-regular text-text-secondary tabular-nums">
          {group.types.length}
        </span>
      </button>
      {(here || open) &&
        group.types.map((t) => (
          <View
            key={t.href}
            href={t.href}
            current={current}
            type={t.name}
            held={t.held}
            most={most}
            count={t.held}
          >
            {t.name}
          </View>
        ))}
    </>
  );
}
