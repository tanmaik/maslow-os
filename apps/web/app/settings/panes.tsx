"use client";

// Settings as ryOS lays out its control panels (github.com/ryokun6/ryos,
// AGPL-3.0), which are Mac OS X 10.3's System Preferences, made ours: a
// toolbar of back, forward and Show All with a search at its right; a
// grid of panes in their groups, every group a band; a search that dims
// the grid and lights the panes that match, with a list of them under
// the field; and one pane at a time beneath the same toolbar. Every part
// of it is BoardUI's: the button group, the input, the menu, the discs
// the marks sit on.

import {
  RiApps2Line,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiBuilding2Line,
  RiComputerLine,
  RiDeleteBinLine,
  RiGroupLine,
  RiPaletteLine,
  RiPieChartLine,
  RiSearchLine,
  RiSparklingLine,
  RiTeamLine,
  RiUserLine,
} from "@remixicon/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  ButtonGroup,
  ButtonGroupItem,
} from "@/components/base/buttons/button-group";
import {
  MENU_ITEM,
  MENU_ITEM_ACTIVE,
  MENU_ITEMS_CONTAINER,
  MENU_POPOVER_SURFACE,
} from "@/components/base/dropdown/menu-styles";
import { InputBase } from "@/components/base/input/input";
import { EagerLink } from "@/components/eager-link";
import type { Mark } from "@/app/room/blocks";
import { cx } from "@/utils/cx";

// One pane of settings: where it sits in the grid, what it is called, and
// the words a person might search for it by that its title does not say.
export type Pane = {
  id: string;
  title: string;
  group: string;
  words?: string[];
};

// The mark each pane wears on the grid.
const MARKS: Record<string, Mark> = {
  you: RiUserLine,
  computer: RiComputerLine,
  usage: RiPieChartLine,
  look: RiPaletteLine,
  apps: RiApps2Line,
  agents: RiSparklingLine,
  org: RiBuilding2Line,
  members: RiTeamLine,
  groups: RiGroupLine,
  delete: RiDeleteBinLine,
};

export function Panes({
  panes,
  pane,
  children,
}: {
  panes: Pane[];
  // The pane being shown, or none for the grid.
  pane: Pane | null;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [lit, setLit] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const typed = query.trim().toLowerCase();
  // One character matches most of the grid, so the dimming would be noise;
  // the search starts at two.
  const searching = typed.length > 1;
  const matches = searching
    ? panes.filter((p) =>
        [p.title, ...(p.words ?? [])].some((w) =>
          w.toLowerCase().includes(typed),
        ),
      )
    : [];
  useEffect(() => {
    setLit((n) => Math.min(n, Math.max(matches.length - 1, 0)));
  }, [matches.length]);
  // The lit row is brought into the menu's view, so arrowing past the
  // fifth match does not light something nobody can see.
  useEffect(() => {
    options.current[lit]?.scrollIntoView({ block: "nearest" });
  }, [lit]);
  // A save comes back with its notice in the address. The page has read it
  // by now, so the address becomes only the pane: a reload or a Back does
  // not say it again.
  useEffect(() => {
    const url = new URL(window.location.href);
    if ([...url.searchParams.keys()].every((k) => k === "pane")) return;
    const to = pane ? `${url.pathname}?pane=${pane.id}` : url.pathname;
    window.history.replaceState(window.history.state, "", to);
  }, [pane?.id]);
  const open = (id: string) => {
    setQuery("");
    setFocused(false);
    field.current?.blur();
    router.push(`/settings?pane=${id}`);
  };
  const groups = [...new Set(panes.map((p) => p.group))];
  const menu = focused && searching;
  return (
    <div className="prefs">
      <div className="prefs-toolbar">
        <div className="prefs-toolbar-nav">
          <ButtonGroup size="small" aria-label="History">
            <ButtonGroupItem
              size="small"
              iconOnly
              leadingIcon={RiArrowLeftSLine}
              aria-label="Back"
              onClick={() => router.back()}
            />
            <ButtonGroupItem
              size="small"
              iconOnly
              leadingIcon={RiArrowRightSLine}
              aria-label="Forward"
              onClick={() => router.forward()}
            />
          </ButtonGroup>
          <ButtonGroup size="small">
            <EagerLink
              href="/settings"
              aria-current={pane ? undefined : "page"}
              className={cx(
                "inline-flex h-[30px] cursor-pointer items-center justify-center px-2.5 text-body-medium whitespace-nowrap text-text-primary select-none",
                "transition-[background-color,color] duration-fast ease-plain",
                "outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-border-focus-ring focus-visible:ring-inset",
                "hover:bg-background-primary-hover active:bg-background-primary-active",
                !pane && "bg-background-primary-hover",
              )}
            >
              Show All
            </EagerLink>
          </ButtonGroup>
          {pane && (
            <h2 className="ml-1 truncate text-body-medium text-text-primary">
              {pane.title}
            </h2>
          )}
        </div>
        <div className="prefs-search">
          <InputBase
            ref={field}
            size="small"
            type="search"
            role="combobox"
            aria-label="Search"
            aria-expanded={menu}
            aria-controls="prefs-search-menu"
            aria-activedescendant={
              menu && matches[lit]
                ? `prefs-match-${matches[lit].id}`
                : undefined
            }
            aria-autocomplete="list"
            placeholder="Search"
            leadingIcon={RiSearchLine}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && matches.length) {
                e.preventDefault();
                setLit((n) => (n + 1) % matches.length);
              } else if (e.key === "ArrowUp" && matches.length) {
                e.preventDefault();
                setLit((n) => (n - 1 + matches.length) % matches.length);
              } else if (e.key === "Enter" && matches[lit]) {
                e.preventDefault();
                open(matches[lit].id);
              } else if (e.key === "Escape") {
                setQuery("");
              }
            }}
          />
          {menu && (
            <div
              id="prefs-search-menu"
              className={cx("prefs-search-menu", MENU_POPOVER_SURFACE)}
              role="listbox"
              aria-label="Panes that match"
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className={MENU_ITEMS_CONTAINER}>
                {matches.length === 0 ? (
                  <div className={cx(MENU_ITEM, "text-text-secondary")}>
                    Nothing is called that.
                  </div>
                ) : (
                  matches.map((m, i) => (
                    <button
                      key={m.id}
                      id={`prefs-match-${m.id}`}
                      ref={(el) => {
                        options.current[i] = el;
                      }}
                      type="button"
                      role="option"
                      aria-selected={i === lit}
                      className={cx(
                        MENU_ITEM,
                        "text-body-medium",
                        i === lit && MENU_ITEM_ACTIVE,
                      )}
                      data-lit={i === lit || undefined}
                      onMouseEnter={() => setLit(i)}
                      onClick={() => open(m.id)}
                    >
                      {m.title}
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      {pane && !searching ? (
        <div className="prefs-pane">{children}</div>
      ) : (
        <div className="prefs-grid" data-searching={searching || undefined}>
          {groups.map((group) => (
            <section key={group} className="prefs-section" aria-label={group}>
              <h3 className="mb-2 text-body-2-medium text-text-secondary">
                {group}
              </h3>
              <div className="prefs-section-grid">
                {panes
                  .filter((p) => p.group === group)
                  .map((p) => {
                    const Icon = MARKS[p.id] ?? RiApps2Line;
                    const hit = matches.some((m) => m.id === p.id);
                    return (
                      <EagerLink
                        key={p.id}
                        href={`/settings?pane=${p.id}`}
                        onClick={(e) => {
                          e.preventDefault();
                          open(p.id);
                        }}
                        className="prefs-item"
                        data-hit={hit || undefined}
                        data-lit={
                          (hit && matches[lit]?.id === p.id) || undefined
                        }
                      >
                        <span className="prefs-item-mark">
                          <Icon className="size-5" aria-hidden />
                        </span>
                        <span className="prefs-item-label text-caption-2-medium text-text-primary">
                          {p.title}
                        </span>
                      </EagerLink>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
