"use client";

import {
  ChevronDown,
  CircleCheck,
  Monitor,
  PanelRight,
  Pencil,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { DeleteConversation } from "@/components/agent/delete-conversation";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// The bar over a conversation, as t3code draws it: where it lives, then its
// title, which opens its actions on click and renames on double-click; the
// terminal toggle at the far end.
export function ChatHeader({
  session,
  title,
  status,
  terminal,
  onTerminal,
  onDelete,
}: {
  // Null while the conversation has not begun.
  session: { id: string; settled: boolean } | null;
  title: string;
  status?: string;
  terminal?: { open: boolean; available: boolean };
  onTerminal?: () => void;
  // Told before the row goes, so the machine stops the harness too.
  onDelete?: () => void;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const committed = useRef(false);

  // True when the server did it; the page then follows.
  const act = async (path: string, body?: object) => {
    if (!session) return false;
    const res = await fetch(`/agent/${session.id}/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }).catch(() => null);
    router.refresh();
    return res?.ok ?? false;
  };
  const startRename = () => {
    committed.current = false;
    setRenaming(title);
  };
  const commitRename = (next: string) => {
    setRenaming(null);
    const t = next.trim();
    if (t && t !== title) void act("rename", { title: t });
  };

  return (
    <header className="bg-background flex h-13 min-h-13 shrink-0 items-center gap-3 px-3 sm:px-5">
      <DeleteConversation
        title={deleting ? title : null}
        onOpenChange={(open) => setDeleting(open)}
        onConfirm={async () => {
          setDeleting(false);
          if (!(await act("delete"))) return;
          onDelete?.();
          router.push("/agent");
        }}
      />
      <SidebarTrigger className="text-muted-foreground hover:text-foreground -ms-1 shrink-0" />
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <nav
          aria-label="Conversation breadcrumb"
          className="min-w-0 flex-1 overflow-clip [overflow-clip-margin:2px]"
        >
          <ol className="m-0 flex min-w-0 list-none items-center gap-2 p-0 text-sm sm:gap-3">
            <li className="text-muted-foreground flex shrink-0 items-center font-medium">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label="New conversation on your computer"
                      onClick={() => router.push("/agent")}
                      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-sm transition-colors focus-visible:ring-2 focus-visible:outline-hidden"
                    />
                  }
                >
                  <Monitor aria-hidden className="size-3.5" />
                  <span className="max-w-40 truncate">your computer</span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  New conversation on your computer
                </TooltipContent>
              </Tooltip>
            </li>
            <li
              aria-hidden="true"
              className="text-muted-foreground flex shrink-0 items-center"
            >
              /
            </li>
            <li
              aria-current="page"
              className="text-foreground flex min-w-10 flex-1 items-center font-medium"
            >
              {renaming !== null ? (
                <input
                  autoFocus
                  aria-label="Conversation title"
                  className="text-foreground ring-ring/50 focus:ring-ring min-w-0 flex-1 rounded-sm bg-transparent text-sm font-medium ring-1 outline-none"
                  defaultValue={renaming}
                  maxLength={120}
                  onBlur={(e) => {
                    if (!committed.current) commitRename(e.currentTarget.value);
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter") {
                      committed.current = true;
                      commitRename(e.currentTarget.value);
                    } else if (e.key === "Escape") {
                      committed.current = true;
                      setRenaming(null);
                    }
                  }}
                />
              ) : session ? (
                <DropdownMenu>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <DropdownMenuTrigger
                          render={
                            <button
                              type="button"
                              aria-label={`Conversation actions for ${title}`}
                              onDoubleClick={(e) => {
                                if (
                                  e.metaKey ||
                                  e.ctrlKey ||
                                  e.shiftKey ||
                                  e.altKey
                                )
                                  return;
                                startRename();
                              }}
                              className="group/thread-title focus-visible:ring-ring inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1 rounded-sm text-left focus-visible:ring-2 focus-visible:outline-hidden"
                              data-title
                            />
                          }
                        />
                      }
                    >
                      <h2 className="min-w-0 truncate">{title}</h2>
                      <ChevronDown
                        aria-hidden
                        className="text-muted-foreground size-3.5 shrink-0 opacity-0 transition-opacity group-hover/thread-title:opacity-100 group-focus-visible/thread-title:opacity-100"
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top">{title}</TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={startRename}>
                      <Pencil />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        act("settle", { settled: !session.settled })
                      }
                    >
                      <CircleCheck />
                      {session.settled ? "Un-settle" : "Settle"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeleting(true)}
                    >
                      <Trash2 />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <h2 className="min-w-0 flex-1 truncate">{title}</h2>
              )}
            </li>
          </ol>
        </nav>
        <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-3">
          {status && (
            <span className="text-muted-foreground text-xs" data-link={status}>
              {status === "connecting"
                ? "Connecting…"
                : status === "closed"
                  ? "Disconnected"
                  : ""}
            </span>
          )}
          {terminal && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={cn(
                      "text-muted-foreground hover:text-foreground",
                      terminal.open && "bg-accent text-foreground",
                    )}
                    onClick={onTerminal}
                    disabled={!terminal.available}
                    aria-pressed={terminal.open}
                    aria-label="Toggle terminal"
                    data-terminal-toggle
                  />
                }
              >
                <PanelRight />
              </TooltipTrigger>
              <TooltipContent side="bottom">Terminal</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </header>
  );
}
