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
import { useCallback, useEffect, useRef, useState } from "react";

import {
  NotificationCenter,
  type NotificationCenterItem,
} from "@/components/application/notification-center/notification-center";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import {
  Notification as NotificationCard,
  NotificationViewport,
} from "@/components/base/notification/notification";
import { Markdown } from "@/components/markdown";
import { BASE, LEAVE } from "@/lib/motion";
import { cx } from "@/utils/cx";

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

// The panel itself: every notification newest first, over the desktop, out of the
// way of the clock that opened it.
export function NotificationsPanel({
  notifications,
  update = null,
  onUpdate,
}: {
  notifications: Notifications;
  // An update waiting on the person's computer, until they say when.
  update?: { image: string; readyAt: string } | null;
  onUpdate?: (when: "now" | "tonight" | "idle") => Promise<void>;
}) {
  const { open, show } = notifications;
  // The update as a notification: what it is, what taking it means, and the
  // three times it can be taken, level with each other.
  const updateRow: NotificationCenterItem | null = update
    ? {
        id: UPDATE,
        category: "activity",
        group: "",
        title: "An update is ready for your computer",
        description: (
          <span className="text-body-regular text-text-secondary">
            Image {update.image}, ready since {ago(update.readyAt)}. Taking it
            restarts your computer, which takes about a minute. Now stops
            whatever is running; tonight is three in the morning; when idle is a
            quiet half hour.
          </span>
        ),
        timestamp: ago(update.readyAt),
        unread: true,
        status: "information",
        icon: RiRefreshLine,
        actions: [
          { id: "now", label: "Now", variant: "secondary" },
          { id: "tonight", label: "Tonight", variant: "secondary" },
          { id: "idle", label: "When idle", variant: "secondary" },
        ],
      }
    : null;
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && show(false);
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, show]);
  const clearable = notifications.notifications.some(
    (n) => n.readAt !== null && (n.kind === "note" || n.answer !== null),
  );
  return (
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
            initial={{ opacity: 0, x: 24, filter: "blur(4px)" }}
            animate={{
              opacity: 1,
              x: 0,
              filter: "blur(0px)",
              transition: BASE,
            }}
            exit={{ opacity: 0, x: 24, filter: "blur(4px)", transition: LEAVE }}
            className="glass-sheet glass-airy fixed top-[calc(27px+env(safe-area-inset-top))] right-2 z-[70] w-[400px] max-w-[calc(100vw-1rem)] overflow-hidden rounded-3xl"
          >
            <NotificationCenter
              tabs={false}
              title="Notifications"
              emptyMessage="Nothing is waiting on you."
              className="w-full max-w-none border-none bg-transparent shadow-none"
              clear={{
                label: "Clear read",
                onClear: notifications.clear,
                disabled: !clearable,
              }}
              notifications={[
                ...(updateRow ? [updateRow] : []),
                ...notifications.notifications.map((n) =>
                  row(n, notifications),
                ),
              ]}
              onAction={(id, answer) =>
                id === UPDATE
                  ? void onUpdate?.(answer as "now" | "tonight" | "idle")
                  : void notifications.answer(id, answer)
              }
            />
            {notifications.said && (
              <p className="text-body-2-regular text-text-error-primary px-4 pb-3">
                {notifications.said}
              </p>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

// One notification as a row of the panel: what it says, what it is about, and
// what it is waiting for.
function row(
  n: Notification,
  notifications: Notifications,
): NotificationCenterItem {
  const answered = n.kind === "ask" && n.answer !== null;
  const waiting = n.kind === "ask" && n.answer === null;
  return {
    id: n.id,
    category: "activity",
    group: "",
    title: n.title,
    description: n.body ? (
      <Markdown className="text-body-regular text-text-secondary">
        {n.body}
      </Markdown>
    ) : null,
    timestamp:
      n.from === "you" ? ago(n.createdAt) : `${n.from} · ${ago(n.createdAt)}`,
    unread: n.readAt === null,
    status: answered ? "success" : waiting ? "information" : "neutral",
    icon: answered
      ? RiCheckLine
      : n.request
        ? RiShareForwardLine
        : waiting
          ? RiQuestionAnswerLine
          : RiNotification3Line,
    // An ask that hands another person access to a private record is
    // hard to take back, so nothing here is the default: its choices
    // stand level and the person picks one.
    actions:
      waiting && n.options.length > 0
        ? n.options.map((o, i) => ({
            id: o,
            label: o,
            variant:
              n.request || i > 0
                ? ("secondary" as const)
                : ("primary" as const),
          }))
        : undefined,
    content: (
      <>
        {n.records.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {n.records.map((id) => (
              <Link
                key={id}
                href={`/brain/records/${id}`}
                className="text-caption-1-medium text-text-secondary bg-background-secondary-default hover:bg-background-secondary-hover duration-fast ease-plain rounded-full px-2 py-0.5 transition-colors"
              >
                {notifications.titles[id] ?? id}
              </Link>
            ))}
          </div>
        )}
        {answered && (
          <p className="text-body-2-medium text-text-tertiary mt-1.5">
            You said {n.answer}.
          </p>
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
      className="mt-2 flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (answer.trim()) onSay(answer.trim());
      }}
    >
      <Input
        size="small"
        aria-label="Your answer"
        placeholder="Your answer"
        value={answer}
        onChange={setAnswer}
        className="flex-1"
      />
      <Button type="submit" size="small" disabled={!answer.trim()}>
        Send
      </Button>
    </form>
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
  const [held, setHeld] = useState<string | null>(null);
  if (notifications.open || notifications.fresh.length === 0) return null;
  return (
    <NotificationViewport
      position="top-right"
      // 25 of menu bar and 8 under it, and the clock's own right edge.
      className={cx(
        "top-[calc(33px+env(safe-area-inset-top))] right-[calc(0.5rem+env(safe-area-inset-right))] z-[80]",
        "sm:top-[calc(33px+env(safe-area-inset-top))] sm:right-[calc(0.5rem+env(safe-area-inset-right))]",
        "max-sm:inset-x-0 max-sm:top-[env(safe-area-inset-top)] max-sm:w-full max-sm:items-stretch max-sm:px-2",
      )}
    >
      {notifications.fresh.map((n) => (
        <div
          key={n.id}
          onPointerEnter={() => setHeld(n.id)}
          onPointerLeave={() => setHeld((h) => (h === n.id ? null : h))}
        >
          <NotificationCard
            title={n.title}
            description={n.body ? n.body.split("\n")[0] : undefined}
            status={n.kind === "ask" ? "information" : "neutral"}
            icon={n.kind === "ask" ? RiQuestionAnswerLine : RiNotification3Line}
            introDelay={0}
            // A note goes by itself; an ask is a decision waiting on the
            // person and stays until they take it.
            autoDismissDuration={
              n.kind === "ask" || held === n.id ? undefined : TOAST
            }
            onDismiss={() => notifications.drop(n.id)}
            closeLabel="Close"
            onClick={() => notifications.show(true)}
            className={cx(
              "w-[360px] max-w-[calc(100vw-1.5rem)] cursor-pointer",
              "max-sm:w-full max-sm:max-w-none",
            )}
          />
        </div>
      ))}
    </NotificationViewport>
  );
}
