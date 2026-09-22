"use client";

import type { Notification } from "@maslow/db/notifications";
import {
  RiCheckLine,
  RiNotification3Line,
  RiRefreshLine,
  RiQuestionAnswerLine,
  RiShareForwardLine,
} from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { CloseButton } from "@/components/ui/close-button";
import { Input } from "@/components/ui/input";
import { UpdateDialog } from "@/app/computer/updating";
import { Markdown } from "@/components/markdown";
import type { Update } from "@/lib/computer";
import { BASE, LEAVE } from "@/lib/motion";

// What waits on the person, behind the clock: notes their agent left and
// asks it cannot answer itself. The brain has no live channel of its own,
// so the desktop looks again on a beat while the tab is watched.
const BEAT = 30_000;

// How long a notification that has just arrived stands on the desktop.
const TOAST = 6_000;

// How many toasts stand at once, so a burst never covers the desktop.
const MOST_TOASTS = 3;

type State = {
  notifications: Notification[];
  // What every record a notification points at is called.
  titles: Record<string, string>;
  waiting: number;
  unread: number;
};

export type Notifications = ReturnType<typeof useNotifications>;

// The desktop's hold on what waits: the notifications themselves, how many wait,
// what has just arrived, and the one answer a notification takes.
export function useNotifications() {
  const [state, setState] = useState<State>({
    notifications: [],
    titles: {},
    waiting: 0,
    unread: 0,
  });
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState<Notification[]>([]);
  const [said, setSaid] = useState<string | null>(null);
  // What was already there when the desktop opened is not news.
  const known = useRef<Set<string> | null>(null);

  const take = useCallback((next: State) => {
    setState(next);
    const before = known.current;
    known.current = new Set(next.notifications.map((n) => n.id));
    if (!before) return;
    const arrived = next.notifications.filter((n) => !before.has(n.id));
    if (arrived.length > 0) {
      setFresh((f) => [...arrived, ...f].slice(0, MOST_TOASTS));
    }
  }, []);

  const look = useCallback(async () => {
    const res = await fetch("/notifications", { cache: "no-store" });
    if (res.ok) take((await res.json()) as State);
  }, [take]);

  useEffect(() => {
    const watched = () => document.visibilityState === "visible";
    void look();
    const beat = setInterval(() => watched() && void look(), BEAT);
    const wake = () => watched() && void look();
    document.addEventListener("visibilitychange", wake);
    return () => {
      clearInterval(beat);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [look]);

  const say = useCallback(
    async (what: Record<string, unknown>) => {
      setSaid(null);
      const res = await fetch("/notifications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(what),
      });
      if (res.ok) take((await res.json()) as State);
      else {
        const refused = (await res.json().catch(() => null)) as {
          said?: string;
        } | null;
        setSaid(refused?.said ?? "That could not be answered.");
      }
    },
    [take],
  );

  const show = useCallback(
    (showing: boolean) => {
      setOpen(showing);
      setSaid(null);
      // What has just arrived is in the panel now, not on the desktop; and
      // putting the panel away is what marks them read, so the count is
      // still true while they are being looked at.
      if (showing) setFresh([]);
      else void say({ read: true });
    },
    [say],
  );

  return {
    ...state,
    open,
    show,
    fresh,
    said,
    answer: (id: string, answer: string) => say({ id, answer }),
    clear: () => say({ clear: true }),
    drop: (id: string) => setFresh((f) => f.filter((n) => n.id !== id)),
  };
}

// The one notification that is not the brain's: the update waiting on the
// computer.
const UPDATE = "update";

// How long ago, as a person says it.
function ago(at: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(at).getTime()) / 1000);
  if (seconds < 60) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

// One row of the panel: what it says, what it is about, and what it is
// waiting for.
type Row = {
  id: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  when: string;
  unread: boolean;
  body?: ReactNode;
  // What the person may answer, the first in the accent when it is safe
  // to lead with.
  actions?: { id: string; label: string; lead: boolean }[];
};

// The panel itself: every notification newest first, over the desktop, out of the
// way of the clock that opened it.
export function NotificationsPanel({
  notifications,
  update = null,
  onUpdate,
}: {
  notifications: Notifications;
  // An update waiting on the person's computer, until they take it.
  update?: Update | null;
  onUpdate?: () => Promise<void>;
}) {
  const { open, show } = notifications;
  const [asking, setAsking] = useState(false);
  // The update as a notification: what it is, what taking it means, and
  // the one button that takes it, which asks first.
  const rows: Row[] = [
    ...(update
      ? [
          {
            id: UPDATE,
            icon: RiRefreshLine,
            title: "An update is ready for your computer",
            when: ago(update.readyAt),
            unread: true,
            body: (
              <p className="text-sm text-muted-foreground">
                Image {update.image}, ready since {ago(update.readyAt)}.
                Updating restarts your computer, which takes about a minute.
              </p>
            ),
            actions: [{ id: "update", label: "Update", lead: true }],
          },
        ]
      : []),
    ...notifications.notifications.map((n) => row(n, notifications)),
  ];
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && show(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, show]);
  // Clear takes what is done with: a note, an answered ask. An ask still
  // waiting is not the list's to drop.
  const clearable = notifications.notifications.some(
    (n) => n.kind === "note" || n.answer !== null,
  );
  const unread = rows.filter((r) => r.unread).length;
  return (
    <>
      <UpdateDialog
        open={asking}
        onOpenChange={setAsking}
        onTake={() => void onUpdate?.()}
      />
      <AnimatePresence>
        {open && (
          <>
            {/* A press anywhere else puts it away. */}
            <div
              className="fixed inset-0 z-[65]"
              onPointerDown={() => show(false)}
            />
            <motion.aside
              aria-label="Notifications"
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0, transition: BASE }}
              exit={{ opacity: 0, x: 24, transition: LEAVE }}
              className="fixed top-[calc(27px+env(safe-area-inset-top))] right-2 z-[70] flex max-h-[calc(100dvh-4rem)] w-[380px] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg max-sm:inset-x-2 max-sm:bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] max-sm:w-auto max-sm:max-w-none"
            >
              <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border pr-1 pl-3">
                <h2 className="text-sm font-medium text-foreground">
                  Notifications
                  <span className="pl-2 text-xs font-normal text-muted-foreground">
                    {unread === 0 ? "No unread" : `${unread} unread`}
                  </span>
                </h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void notifications.clear()}
                  disabled={!clearable}
                >
                  Clear
                </Button>
              </header>
              {rows.length === 0 ? (
                <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                  Nothing is waiting on you.
                </p>
              ) : (
                <ul className="flex min-h-0 flex-col overflow-y-auto">
                  {rows.map((r) => (
                    <li
                      key={r.id}
                      className="flex gap-2.5 border-b border-border px-3 py-2.5 last:border-b-0"
                    >
                      <r.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="min-w-0 text-sm font-medium text-foreground">
                            {r.title}
                          </p>
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                            {r.when}
                            {r.unread && (
                              <span
                                aria-label="Unread"
                                className="size-1.5 rounded-full bg-primary"
                              />
                            )}
                          </span>
                        </div>
                        {r.body}
                        {r.actions && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {r.actions.map((a) => (
                              <Button
                                key={a.id}
                                size="sm"
                                variant={a.lead ? "default" : "outline"}
                                // Update asks first, in a dialog over the panel.
                                onClick={() =>
                                  r.id === UPDATE
                                    ? setAsking(true)
                                    : void notifications.answer(r.id, a.id)
                                }
                              >
                                {a.label}
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {notifications.said && (
                <p className="border-t border-border px-3 py-2 text-xs text-destructive">
                  {notifications.said}
                </p>
              )}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

// One notification as a row of the panel.
function row(n: Notification, notifications: Notifications): Row {
  const answered = n.kind === "ask" && n.answer !== null;
  const waiting = n.kind === "ask" && n.answer === null;
  return {
    id: n.id,
    icon: answered
      ? RiCheckLine
      : n.request
        ? RiShareForwardLine
        : waiting
          ? RiQuestionAnswerLine
          : RiNotification3Line,
    title: n.title,
    when:
      n.from === "you" ? ago(n.createdAt) : `${n.from} · ${ago(n.createdAt)}`,
    unread: n.readAt === null,
    // An ask that hands another person access to a private record is
    // hard to take back, so nothing here is the default: its choices
    // stand level and the person picks one.
    actions:
      waiting && n.options.length > 0
        ? n.options.map((o, i) => ({
            id: o,
            label: o,
            lead: !n.request && i === 0,
          }))
        : undefined,
    body: (
      <>
        {n.body && (
          <Markdown className="text-sm text-muted-foreground">
            {n.body}
          </Markdown>
        )}
        {n.records.length > 0 && (
          <p className="text-xs text-muted-foreground">
            About{" "}
            {n.records.map((id, i) => (
              <Fragment key={id}>
                {i > 0 && ", "}
                <Link
                  href={`/brain/records/${id}`}
                  className="underline-offset-2 hover:underline"
                >
                  {notifications.titles[id] ?? id}
                </Link>
              </Fragment>
            ))}
          </p>
        )}
        {answered && (
          <p className="text-xs text-muted-foreground">You said {n.answer}.</p>
        )}
        {waiting && n.options.length === 0 && (
          <Typed onSay={(answer) => void notifications.answer(n.id, answer)} />
        )}
      </>
    ),
  };
}

// An ask that offers nothing to pick takes whatever the person types.
function Typed({ onSay }: { onSay: (answer: string) => void }) {
  const [answer, setAnswer] = useState("");
  return (
    <form
      className="mt-1 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (answer.trim()) onSay(answer.trim());
      }}
    >
      <Input
        aria-label="Your answer"
        placeholder="Your answer"
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
        className="flex-1"
      />
      <Button type="submit" disabled={!answer.trim()}>
        Send
      </Button>
    </form>
  );
}

// One notification that has just arrived. It goes by itself unless the
// pointer is on it; an ask is still behind the clock, waiting.
function Toast({
  n,
  onOpen,
  onDrop,
}: {
  n: Notification;
  onOpen: () => void;
  onDrop: () => void;
}) {
  const [held, setHeld] = useState(false);
  const drop = useRef(onDrop);
  drop.current = onDrop;
  useEffect(() => {
    if (held) return;
    const gone = setTimeout(() => drop.current(), TOAST);
    return () => clearTimeout(gone);
  }, [held]);
  const Icon = n.kind === "ask" ? RiQuestionAnswerLine : RiNotification3Line;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0, transition: BASE }}
      exit={{ opacity: 0, transition: LEAVE }}
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onClick={onOpen}
      className="pointer-events-auto flex w-[360px] max-w-[calc(100vw-1.5rem)] cursor-pointer gap-2.5 rounded-lg border border-border bg-popover py-2.5 pr-1.5 pl-3 text-popover-foreground shadow-lg max-sm:w-full max-sm:max-w-none"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="text-sm font-medium text-foreground">{n.title}</p>
        {n.body && (
          <p className="truncate text-sm text-muted-foreground">
            {n.body.split("\n")[0]}
          </p>
        )}
      </div>
      <CloseButton
        size="icon-xs"
        aria-label="Close"
        onClick={(e) => {
          e.stopPropagation();
          onDrop();
        }}
      />
    </motion.div>
  );
}

// What has just arrived, under the clock it belongs to for a few seconds,
// or until the pointer is on it; on a phone it drops from the top edge,
// the width of the screen. A press opens the panel.
export function NotificationToasts({
  notifications,
}: {
  notifications: Notifications;
}) {
  const { drop } = notifications;
  if (notifications.open || notifications.fresh.length === 0) return null;
  return (
    // 25 of menu bar and 8 under it, and the clock's own right edge.
    <div
      role="region"
      aria-label="New notifications"
      className="pointer-events-none fixed top-[calc(33px+env(safe-area-inset-top))] right-[calc(0.5rem+env(safe-area-inset-right))] z-[80] flex flex-col items-end gap-2 max-sm:inset-x-0 max-sm:top-[env(safe-area-inset-top)] max-sm:items-stretch max-sm:px-2"
    >
      <AnimatePresence>
        {notifications.fresh.map((n) => (
          <Toast
            key={n.id}
            n={n}
            onOpen={() => notifications.show(true)}
            onDrop={() => drop(n.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
