"use client";

// Settings as a Mac lays out System Settings: a rail of panes down the
// left with a search over it, in their groups, the one open lit in the
// accent; and that pane on the right, its parts one under another. Typing
// in the search leaves only the panes
// that match in the rail, and Return opens the first. On a phone the rail
// is a strip along the top. Every part of it is BoardUI's.

import {
  RiApps2Line,
  RiBuilding2Line,
  RiComputerLine,
  RiGroupLine,
  RiPaletteLine,
  RiKey2Line,
  RiSearchLine,
  RiSparklingLine,
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

import { InputBase } from "@/components/base/input/input";
import { EagerLink } from "@/components/eager-link";
import type { Mark } from "@/app/desktop/apps";
import { cx } from "@/utils/cx";

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
  agent: RiSparklingLine,
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
    <div className="prefs">
      <nav className="prefs-side" aria-label="Panes">
        <InputBase
          ref={field}
          size="small"
          type="search"
          aria-label="Search"
          placeholder="Search"
          leadingIcon={RiSearchLine}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && shown[0]) {
              e.preventDefault();
              open(shown[0].id);
            } else if (e.key === "Escape") setQuery("");
          }}
          className="prefs-search"
        />
        {shown.length === 0 ? (
          <p className="px-2 py-1 text-body-2-regular text-text-secondary">
            Nothing is called that.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group} className="prefs-group" aria-label={group}>
              <h3 className="prefs-group-name text-caption-1-medium text-text-tertiary">
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
                      className={cx(
                        "prefs-item text-body-medium",
                        on
                          ? "bg-accent-600 text-text-white"
                          : "text-text-primary hover:bg-background-secondary-hover",
                      )}
                    >
                      <span
                        className={cx(
                          "prefs-item-mark",
                          on
                            ? "bg-white/20 text-text-white"
                            : "bg-background-secondary-default text-foreground-icon-primary",
                        )}
                      >
                        <Icon className="size-4" aria-hidden />
                      </span>
                      <span className="truncate">{p.title}</span>
                    </EagerLink>
                  );
                })}
            </section>
          ))
        )}
      </nav>
      <div className="prefs-main">
        <h2 className="sr-only">{pane.title}</h2>
        <div className="prefs-pane">{children}</div>
      </div>
    </div>
  );
}
