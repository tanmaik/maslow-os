"use client";

import {
  ChartNoAxesColumn,
  Check,
  ChevronDown,
  CircleCheck,
  CircleDashed,
  Monitor,
  Pencil,
  Search,
  Settings,
  SquarePen,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { DeleteConversation } from "@/components/agent/delete-conversation";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type SessionRow = {
  id: string;
  title: string;
  model: string;
  state: "idle" | "working" | "restarted";
  createdAt: string;
  updatedAt: string;
  settledAt: string | null;
  unread: boolean;
};

// The sidebar, as t3code lays it out: a search row with the new-conversation
// pen beside it; live conversations as cards, newest first; a shelf of
// settled ones below as slim rows, collapsed to a count; Settings and Usage
// in the footer. A card carries the machine on its first line with the
// status or the time at the right, the title on its second, and the model on
// its third. A conversation the agent is working on says so; one that
// finished since the person last looked says Done. Double-click renames,
// right-click offers the rest.
export function AgentSidebar({ sessions }: { sessions: SessionRow[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [settledOpen, setSettledOpen] = useState(false);
  const [renaming, setRenaming] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const searching = query.trim().length > 0;

  const { live, settled } = useMemo(() => {
    const byTime = (a: SessionRow, b: SessionRow) =>
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
      a.id.localeCompare(b.id);
    const live = sessions.filter((s) => s.settledAt === null).sort(byTime);
    const settled = sessions
      .filter((s) => s.settledAt !== null)
      .sort(
        (a, b) =>
          Date.parse(b.settledAt!) - Date.parse(a.settledAt!) ||
          a.id.localeCompare(b.id),
      );
    return { live, settled };
  }, [sessions]);
  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sessions.filter((s) => s.title.toLowerCase().includes(q)) : [];
  }, [query, sessions]);

  const act = async (id: string, path: string, body?: object) => {
    await fetch(`/agent/${id}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    router.refresh();
  };
  const remove = async (id: string) => {
    setDeleting(null);
    await act(id, "delete");
    if (pathname === `/agent/${id}`) router.push("/agent");
  };
  const commitRename = async (id: string, title: string, was: string) => {
    setRenaming(null);
    const next = title.trim();
    if (next && next !== was) await act(id, "rename", { title: next });
  };

  const row = (s: SessionRow, variant: "card" | "slim") => (
    <SessionRowView
      key={`${s.id}:${variant}`}
      session={s}
      variant={variant}
      active={pathname === `/agent/${s.id}`}
      renaming={renaming?.id === s.id ? renaming.title : null}
      onOpen={() => router.push(`/agent/${s.id}`)}
      onStartRename={() => setRenaming({ id: s.id, title: s.title })}
      onRenameChange={(title) => setRenaming({ id: s.id, title })}
      onCommitRename={(title) => commitRename(s.id, title, s.title)}
      onCancelRename={() => setRenaming(null)}
      onSettle={() => act(s.id, "settle", { settled: true })}
      onUnsettle={() => act(s.id, "settle", { settled: false })}
      onDelete={() => setDeleting({ id: s.id, title: s.title })}
    />
  );

  return (
    <Sidebar collapsible="offcanvas" className="top-8 h-[calc(100svh-2rem)]">
      <DeleteConversation
        title={deleting?.title ?? null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => deleting && remove(deleting.id)}
      />
      <SidebarContent className="gap-0">
        <SidebarGroup className="gap-1 p-2">
          <div className="flex items-center gap-1">
            <div className="text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground focus-within:bg-sidebar-accent focus-within:text-sidebar-foreground flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium">
              <Search className="size-4 shrink-0 opacity-80" />
              <input
                type="search"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setQuery("");
                  if (e.key === "Enter" && found[0])
                    router.push(`/agent/${found[0].id}`);
                }}
                placeholder="Search"
                aria-label="Search conversations"
                className="text-sidebar-foreground placeholder:text-muted-foreground min-w-0 flex-1 bg-transparent text-sm font-medium outline-none [&::-webkit-search-cancel-button]:hidden"
              />
              {searching && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                  className="hover:bg-sidebar-border text-muted-foreground hover:text-sidebar-foreground focus-visible:ring-ring/70 flex size-6 shrink-0 items-center justify-center rounded outline-none focus-visible:ring-2"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <SidebarMenuButton
                    size="default"
                    className="size-8 shrink-0 justify-center p-0"
                    render={<a href="/agent" aria-label="New conversation" />}
                  />
                }
              >
                <SquarePen />
              </TooltipTrigger>
              <TooltipContent side="right">New conversation</TooltipContent>
            </Tooltip>
          </div>
        </SidebarGroup>

        <SidebarGroup className="px-2 pt-0 pb-1">
          <TooltipProvider delay={150} closeDelay={0}>
            {searching ? (
              found.length > 0 ? (
                <ul
                  role="listbox"
                  aria-label="Search results"
                  className="flex flex-col gap-px"
                >
                  {found.map((s) => row(s, "slim"))}
                </ul>
              ) : (
                <p
                  role="status"
                  className="text-muted-foreground px-2 py-6 text-center text-xs text-pretty"
                >
                  No conversations match “{query.trim()}”.
                </p>
              )
            ) : (
              <ul
                role="list"
                className="flex flex-col gap-px"
                data-sessions={sessions.length}
              >
                {live.map((s) => row(s, "card"))}
                {settled.length > 0 && (
                  <li className="list-none">
                    <button
                      type="button"
                      onClick={() => setSettledOpen((o) => !o)}
                      aria-expanded={settledOpen}
                      className="mt-3 mb-1 flex w-full cursor-pointer items-center gap-2 px-2.5 text-left"
                      data-settled-shelf
                    >
                      <span className="text-muted-foreground text-xs font-medium">
                        {settledOpen
                          ? "Settled"
                          : `Settled (${settled.length})`}
                      </span>
                      <span className="bg-sidebar-border/60 h-px flex-1" />
                      <ChevronDown
                        aria-hidden
                        className={cn(
                          "text-muted-foreground size-3 transition-transform duration-150",
                          settledOpen && "rotate-180",
                        )}
                      />
                    </button>
                  </li>
                )}
                {settledOpen && settled.map((s) => row(s, "slim"))}
              </ul>
            )}
            {!searching && sessions.length === 0 && (
              <p className="text-muted-foreground px-2 py-6 text-center text-xs text-pretty">
                No conversations yet. Ask anything to start one.
              </p>
            )}
          </TooltipProvider>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-2">
        <SidebarMenu className="flex-row items-center">
          <UtilityItem href="/settings" label="Settings" icon={<Settings />} />
          <UtilityItem
            href="/usage"
            label="Usage"
            icon={<ChartNoAxesColumn />}
          />
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

// One icon in the footer, leading to a page of the app.
function UtilityItem({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <SidebarMenuItem className="shrink-0">
      <Tooltip>
        <TooltipTrigger
          render={
            <SidebarMenuButton
              className="size-8 justify-center p-0"
              render={<a href={href} aria-label={label} />}
            />
          }
        >
          {icon}
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </SidebarMenuItem>
  );
}

// One conversation: a card while live, a slim row on the shelf or in search.
function SessionRowView({
  session: s,
  variant,
  active,
  renaming,
  onOpen,
  onStartRename,
  onRenameChange,
  onCommitRename,
  onCancelRename,
  onSettle,
  onUnsettle,
  onDelete,
}: {
  session: SessionRow;
  variant: "card" | "slim";
  active: boolean;
  renaming: string | null;
  onOpen: () => void;
  onStartRename: () => void;
  onRenameChange: (title: string) => void;
  onCommitRename: (title: string) => void;
  onCancelRename: () => void;
  onSettle: () => void;
  onUnsettle: () => void;
  onDelete: () => void;
}) {
  const working = s.state === "working";
  const settled = s.settledAt !== null;
  // Background work recedes when it is not the open conversation; unread
  // and active rows keep their weight.
  // The open conversation is being read, so it is never unread.
  const unread = s.unread && !active;
  const recede = !active && !unread && (working || settled);

  const surface = cn(
    "group/row focus-visible:ring-ring/70 relative w-full cursor-pointer overflow-hidden rounded-md text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-inset",
    active
      ? "bg-background text-sidebar-foreground shadow-xs"
      : recede
        ? "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
        : "text-sidebar-foreground hover:bg-sidebar-accent",
    working && !active && "opacity-70 transition-opacity hover:opacity-100",
  );

  const title =
    renaming !== null ? (
      <input
        autoFocus
        value={renaming}
        maxLength={120}
        aria-label="Conversation title"
        onChange={(e) => onRenameChange(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.nativeEvent.isComposing)
            onCommitRename(renaming);
          if (e.key === "Escape") onCancelRename();
        }}
        onBlur={() => onCommitRename(renaming)}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="border-input bg-card text-card-foreground focus:border-foreground min-w-0 flex-1 rounded-sm border px-1 text-sm font-medium outline-none"
      />
    ) : (
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          recede ? "font-normal" : "font-medium",
          variant === "card"
            ? recede
              ? "text-muted-foreground"
              : unread
                ? "text-foreground"
                : "text-foreground/90"
            : cn(
                "group-hover/row:text-foreground",
                active
                  ? "text-foreground"
                  : unread
                    ? "text-muted-foreground"
                    : "text-muted-foreground",
              ),
        )}
      >
        {s.title}
      </span>
    );

  // What the row says at its right: Working with a timer, Done when unread,
  // else how long ago. A hover swaps it for the settle control.
  const status = working ? (
    <span className="inline-flex items-center gap-1 font-medium text-sky-700 dark:text-sky-400">
      <CircleDashed aria-hidden className="size-4 shrink-0" />
      <span role="status">Working</span>
      <WorkingFor since={s.updatedAt} />
    </span>
  ) : unread ? (
    <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
      <CircleCheck aria-hidden className="size-4 shrink-0" />
      <span role="status">Done</span>
    </span>
  ) : (
    <span className="text-xs" suppressHydrationWarning>
      {ago(settled ? s.settledAt! : s.updatedAt)}
    </span>
  );

  // A single click opens after a beat, so a double-click renames instead
  // of opening first; a beat that outlives the page moving is dropped.
  const opening = useRef<ReturnType<typeof setTimeout> | null>(null);
  const here = usePathname();
  useEffect(() => {
    if (opening.current) clearTimeout(opening.current);
  }, [here]);
  const handlers = {
    onClick: (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).closest("button, a, input")) return;
      if (opening.current) clearTimeout(opening.current);
      if (e.detail > 1) return;
      opening.current = setTimeout(onOpen, 250);
    },
    onDoubleClick: (e: React.MouseEvent) => {
      if (opening.current) clearTimeout(opening.current);
      if (
        renaming !== null ||
        (e.target as HTMLElement).closest("button, a, input")
      )
        return;
      e.preventDefault();
      onStartRename();
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen();
      }
    },
  };

  const hoverAction = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
  ) => (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="text-muted-foreground hover:text-foreground pointer-events-none absolute inset-y-0 end-0 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
    >
      {icon}
    </button>
  );

  const menu = (
    <ContextMenuContent>
      <ContextMenuItem onClick={onStartRename}>
        <Pencil />
        Rename
      </ContextMenuItem>
      {settled ? (
        <ContextMenuItem onClick={onUnsettle}>
          <CircleCheck />
          Un-settle
        </ContextMenuItem>
      ) : (
        <ContextMenuItem onClick={onSettle}>
          <CircleCheck />
          Settle
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={onDelete}>
        <Trash2 />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  );

  if (variant === "slim")
    return (
      <li className="list-none" data-session={s.id} data-row="slim">
        <ContextMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <ContextMenuTrigger
                  render={
                    <div
                      role="button"
                      tabIndex={0}
                      className={cn(
                        surface,
                        "flex h-9 items-center gap-2.5 px-2.5",
                      )}
                      {...handlers}
                    />
                  }
                />
              }
            >
              <Monitor
                aria-hidden
                className={cn(
                  "text-muted-foreground size-4 shrink-0 transition-opacity",
                  !active && "opacity-40 group-hover/row:opacity-100",
                )}
              />
              {title}
              <span className="relative ml-auto flex h-6 min-w-8 shrink-0 items-center justify-end">
                <span
                  className="text-muted-foreground inline-flex justify-end text-xs tabular-nums transition-opacity group-hover/row:opacity-0"
                  suppressHydrationWarning
                >
                  {ago(settled ? s.settledAt! : s.updatedAt)}
                </span>
                {settled
                  ? hoverAction(
                      "Un-settle conversation",
                      <Undo2 className="mb-px size-3.5" />,
                      onUnsettle,
                    )
                  : hoverAction(
                      "Settle conversation",
                      <Check className="size-3" />,
                      onSettle,
                    )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">
              {s.title} · {s.model}
            </TooltipContent>
          </Tooltip>
          {menu}
        </ContextMenu>
      </li>
    );

  return (
    <li className="list-none py-0.5" data-session={s.id} data-row="card">
      <ContextMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <ContextMenuTrigger
                render={
                  <div
                    role="button"
                    tabIndex={0}
                    className={surface}
                    {...handlers}
                  />
                }
              />
            }
          >
            <div className="relative z-10 h-[4.875rem] px-2.5 py-2">
              <div className="flex h-5 min-w-0 items-center gap-1.5">
                <Monitor
                  aria-hidden
                  className="text-muted-foreground size-4 shrink-0"
                />
                <span
                  className={cn(
                    "text-muted-foreground min-w-0 flex-1 truncate text-xs",
                    recede ? "font-normal" : "font-medium",
                  )}
                >
                  your computer
                </span>
                <span className="group/slot relative ml-auto flex h-5 min-w-8 shrink-0 items-stretch justify-end text-xs">
                  <span className="text-muted-foreground pointer-events-none flex items-center self-center tabular-nums transition-opacity group-hover/row:absolute group-hover/row:end-0 group-hover/row:opacity-0">
                    {status}
                  </span>
                  <span className="pointer-events-none absolute inset-y-0 end-0 flex items-stretch opacity-0 transition-opacity group-hover/row:pointer-events-auto group-hover/row:static group-hover/row:opacity-100">
                    <button
                      type="button"
                      aria-label="Settle conversation"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onSettle();
                      }}
                      className="text-muted-foreground hover:text-foreground -me-1 inline-flex cursor-pointer items-center gap-1 rounded-md bg-transparent px-1.5 text-xs"
                    >
                      <Check className="size-3.5" />
                      Settle
                    </button>
                  </span>
                </span>
              </div>
              <div className="mt-1 flex min-w-0">{title}</div>
              <div className="text-muted-foreground mt-0.5 flex min-w-0 items-center gap-1.5 text-xs">
                <span className="text-muted-foreground min-w-0 flex-1 truncate">
                  {s.model}
                </span>
                {s.state === "restarted" && (
                  <span className="shrink-0">restarted</span>
                )}
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">
            {s.title} · {s.model}
          </TooltipContent>
        </Tooltip>
        {menu}
      </ContextMenu>
    </li>
  );
}

// Ticks on its own, so only this span re-renders each second.
function WorkingFor({ since }: { since: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(since)) / 1000));
  const label =
    s < 60
      ? `${s}s`
      : s < 3600
        ? `${Math.floor(s / 60)}m`
        : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return (
    <span className="font-mono tabular-nums" suppressHydrationWarning>
      {label}
    </span>
  );
}

// How long ago, in the fewest characters: "now", "4m", "3h", "2d".
function ago(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.round(m / 60)}h`;
  return `${Math.round(m / 1440)}d`;
}
