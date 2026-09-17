"use client";

import {
  RiArrowRightSLine,
  RiBrainLine,
  RiSearchLine,
  RiShapesLine,
} from "@remixicon/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";

import { Input } from "@/components/base/input/input";
import { EagerLink } from "@/components/eager-link";
import {
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { cx } from "@/utils/cx";

import { typeHref, typeText } from "./format";
import { TypeIcon } from "./type-icon";

// A type in the rail: its name, where it goes, and how many records it
// holds.
type Kind = { name: string; href: string; held: number };

// The types one colleague shared into this brain, under their name.
type Shared = {
  owner: string;
  ownerId: string;
  types: Kind[];
};

type Mark = ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

// One view of the brain, as a row of the rail: its mark, its name, and how
// many records it holds at its right. The one being read is filled.
function View({
  href,
  current,
  mark: Mark,
  type,
  count,
  waiting,
  name,
  children,
}: {
  href: string;
  current: string;
  mark?: Mark;
  type?: string;
  count?: number;
  // How many asks wait on the person, which is not a count of records and
  // does not read as one.
  waiting?: number;
  // What the row is called where its name is too wide to show.
  name?: string;
  children: ReactNode;
}) {
  const lit = href === current;
  return (
    <SidebarMenuItem className="shrink-0">
      <SidebarMenuButton
        isActive={lit}
        render={
          <EagerLink
            href={href}
            aria-label={name}
            title={name}
            aria-current={lit ? "page" : undefined}
          />
        }
        className="text-body-regular text-text-secondary data-active:text-body-medium hover:text-text-primary data-active:text-text-primary"
      >
        {Mark ? (
          <Mark className="text-foreground-icon-secondary" aria-hidden />
        ) : type ? (
          <span className="flex size-4 items-center justify-center">
            <TypeIcon type={type} className="size-2.5 rounded-[3px]" />
          </span>
        ) : null}
        <span>{children}</span>
      </SidebarMenuButton>
      {waiting ? (
        <SidebarMenuBadge className="hidden bg-accent-600 text-caption-1-semibold text-text-white md:flex">
          {waiting}
        </SidebarMenuBadge>
      ) : count !== undefined ? (
        <SidebarMenuBadge className="hidden text-caption-1-regular text-text-tertiary md:flex">
          {count}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
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
}: {
  records: number;
  // How many asks wait on the person, which the front view carries.
  waiting: number;
  types: Kind[];
  shared: Shared[];
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
  // A type is found by either spelling of its name.
  const matches = (name: string) =>
    `${name} ${typeText(name)}`
      .toLowerCase()
      .includes(narrow.trim().toLowerCase());
  const mine = types.filter((t) => matches(t.name));
  const theirs = shared
    .map((g) => ({ ...g, types: g.types.filter((t) => matches(t.name)) }))
    .filter((g) => g.types.length > 0 || matches(g.owner));
  // Enough types that finding one by eye is work.
  const many = types.length + shared.reduce((n, g) => n + g.types.length, 0);

  return (
    <div
      className="brain-nav flex gap-1 rounded-3xl border border-border-button-default bg-background-secondary-default p-2 shadow-sidebar md:flex-col"
      // A record is read on its own, with its own way back; every other
      // view of the brain keeps the rail beside it.
      data-away={pathname.startsWith("/brain/records") ? "" : undefined}
    >
      <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] md:flex-col md:overflow-visible md:[mask-image:none]">
        <SidebarGroupLabel className="hidden justify-between text-caption-1-medium text-text-tertiary md:flex">
          <span className="truncate">Your brain</span>
          <span className="tabular-nums">{records}</span>
        </SidebarGroupLabel>
        {many > 12 && (
          <Input
            size="small"
            value={narrow}
            onChange={setNarrow}
            placeholder="Search types"
            aria-label="Search types"
            leadingIcon={RiSearchLine}
            className="mb-1 hidden md:block"
          />
        )}
        <SidebarMenu className="max-md:flex-row max-md:gap-1">
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
              count={t.held}
            >
              {typeText(t.name)}
            </View>
          ))}
          {theirs.map((g) => (
            <Group key={g.ownerId} group={g} current={current} />
          ))}
        </SidebarMenu>
      </nav>
      {/* Pinned outside the strip a phone's rail becomes, as its mark alone:
          the types are what the strip is for. */}
      <SidebarMenu className="mt-1 max-md:w-auto">
        <View
          href="/brain/vocabulary"
          current={current}
          mark={RiShapesLine}
          name="Types and fields"
        >
          <span className="hidden md:inline">Types and fields</span>
        </View>
      </SidebarMenu>
    </div>
  );
}

// One colleague's types, folded under their name: open where one of them is
// the view being read, and opened by hand otherwise, so a brain twenty
// people share into is twenty names rather than a hundred types.
function Group({ group, current }: { group: Shared; current: string }) {
  const here = group.types.some((t) => t.href === current);
  const [open, setOpen] = useState(false);
  const shown = here || open;
  return (
    <SidebarMenuItem className="hidden md:block">
      <SidebarMenuButton
        aria-expanded={shown}
        onClick={() => setOpen(!open)}
        className="text-body-regular text-text-secondary hover:text-text-primary"
      >
        <RiArrowRightSLine
          className={cx(
            "text-foreground-icon-secondary transition-transform duration-fast ease-plain",
            shown && "rotate-90",
          )}
          aria-hidden
        />
        <span>{group.owner}</span>
      </SidebarMenuButton>
      <SidebarMenuBadge className="text-caption-1-regular text-text-tertiary">
        {group.types.length}
      </SidebarMenuBadge>
      {shown && (
        <SidebarMenuSub>
          {group.types.map((t) => {
            const lit = t.href === current;
            return (
              <SidebarMenuSubItem key={t.href}>
                <SidebarMenuSubButton
                  isActive={lit}
                  render={
                    <EagerLink
                      href={t.href}
                      aria-current={lit ? "page" : undefined}
                    />
                  }
                  className="text-body-regular text-text-secondary data-active:text-body-medium hover:text-text-primary data-active:text-text-primary"
                >
                  <span className="flex size-4 items-center justify-center">
                    <TypeIcon
                      type={t.name}
                      className="size-2.5 rounded-[3px]"
                    />
                  </span>
                  <span>{typeText(t.name)}</span>
                  <span className="ml-auto text-caption-1-regular text-text-tertiary tabular-nums">
                    {t.held}
                  </span>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            );
          })}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  );
}
