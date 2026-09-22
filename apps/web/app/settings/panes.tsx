"use client";

// Settings as a Mac lays out System Settings: a rail of panes down the
// left with a search over it, in their groups, the one open lit in the
// accent; and that pane on the right, its parts one under another. Typing
// in the search leaves only the panes
// that match in the rail, and Return opens the first. On a phone the rail
// is a strip along the top.

import {
  RiApps2Line,
  RiBuilding2Line,
  RiComputerLine,
  RiGroupLine,
  RiPaletteLine,
  RiKey2Line,
  RiSearchLine,
  RiTeamLine,
  RiUserLine,
} from "@remixicon/react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";

import { EagerLink } from "@/components/eager-link";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import type { Mark } from "@/app/desktop/apps";
import { cn } from "@/lib/utils";

// One pane of settings: where it sits in the rail, what it is called, and
// the words a person might search for it by that its title does not say.
export type Pane = {
  id: string;
  title: string;
  group: string;
  words?: string[];
};

// The mark each pane wears in the rail.
const MARKS: Record<string, Mark> = {
  you: RiUserLine,
  computer: RiComputerLine,
  look: RiPaletteLine,
  apps: RiApps2Line,
  access: RiKey2Line,
  org: RiBuilding2Line,
  members: RiTeamLine,
  groups: RiGroupLine,
};

export function Panes({
  panes,
  pane,
  children,
}: {
  panes: Pane[];
  // The pane being shown.
  pane: Pane;
  children?: ReactNode;
}) {
  const router = useRouter();
  // The pane just clicked lights up at once; the page follows.
  const [going, setGoing] = useState<string | null>(null);
  const [, start] = useTransition();
  const [query, setQuery] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const typed = query.trim().toLowerCase();
  const shown = typed
    ? panes.filter((p) =>
        [p.title, ...(p.words ?? [])].some((w) =>
          w.toLowerCase().includes(typed),
        ),
      )
    : panes;
  // A save comes back with its notice in the address. The page has read it
  // by now, so the address becomes only the pane: a reload or a Back does
  // not say it again.
  useEffect(() => {
    const url = new URL(window.location.href);
    if ([...url.searchParams.keys()].every((k) => k === "pane")) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}?pane=${pane.id}`,
    );
  }, [pane.id]);
  useEffect(() => setGoing(null), [pane.id]);
  const open = (id: string) => {
    setQuery("");
    field.current?.blur();
    setGoing(id);
    start(() => router.push(`/settings?pane=${id}`));
  };
  const lit = going && going !== pane.id ? going : pane.id;
  const groups = [...new Set(shown.map((p) => p.group))];
  return (
    <div className="flex h-full overflow-hidden bg-background text-foreground max-sm:flex-col">
      <nav
        className="no-scrollbar flex w-48 shrink-0 flex-col gap-2 overflow-y-auto border-r border-border bg-sidebar p-2 max-sm:w-auto max-sm:flex-row max-sm:items-center max-sm:gap-1.5 max-sm:overflow-x-auto max-sm:overflow-y-hidden max-sm:border-r-0 max-sm:border-b max-sm:px-3"
        aria-label="Panes"
      >
        <InputGroup className="h-7 shrink-0 max-sm:hidden">
          <InputGroupAddon>
            <RiSearchLine aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            ref={field}
            type="search"
            aria-label="Search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && shown[0]) {
                e.preventDefault();
                open(shown[0].id);
              } else if (e.key === "Escape") setQuery("");
            }}
          />
        </InputGroup>
        {shown.length === 0 ? (
          <p className="px-2 py-1 text-sm text-muted-foreground">
            Nothing is called that.
          </p>
        ) : (
          groups.map((group) => (
            <section
              key={group}
              className="flex flex-col gap-px max-sm:contents"
              aria-label={group}
            >
              <h3 className="px-2 py-1 text-xs font-medium text-muted-foreground max-sm:hidden">
                {group}
              </h3>
              {shown
                .filter((p) => p.group === group)
                .map((p) => {
                  const Icon = MARKS[p.id] ?? RiApps2Line;
                  const on = p.id === lit;
                  return (
                    <EagerLink
                      key={p.id}
                      href={`/settings?pane=${p.id}`}
                      aria-current={on ? "page" : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        open(p.id);
                      }}
                      className={cn(
                        "flex h-7 shrink-0 items-center gap-2 rounded-md px-2 text-sm whitespace-nowrap outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 max-sm:h-8 max-sm:border max-sm:border-border max-sm:px-3",
                        on
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden />
                      <span className="truncate">{p.title}</span>
                    </EagerLink>
                  );
                })}
            </section>
          ))
        )}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <h2 className="sr-only">{pane.title}</h2>
        <div className="flex flex-[1_0_auto] flex-col px-6 pt-2 pb-8 max-sm:px-4 *:mx-auto *:w-full *:max-w-[640px]">
          {children}
        </div>
      </div>
    </div>
  );
}
