"use client";

// The menu bar, ryOS's (github.com/ryokun6/ryos, AGPL-3.0) made ours: a
// frosted strip along the top with the Maslow menu at its left, the front
// window's own menu beside it, every open window under Window, and the
// clock at its right.

import { RiCloseLine, RiSearchLine } from "@remixicon/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { Dragged, Held } from "@/app/desktop/dock";
import { anotherOf } from "@/app/desktop/apps";
import { Kbd } from "@/components/base/kbd/kbd";
import { AboutComputer } from "@/components/about-computer";
import { useLocation } from "@/components/location";
import { NewOrgDialog } from "@/components/new-org";
import {
  NotificationsPanel,
  NotificationToasts,
  useNotifications,
} from "@/components/notifications";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarTrigger,
} from "@/components/ui/menubar";
import type { Update } from "@/lib/computer";
import { usePhone } from "@/hooks/use-phone";

// Who is at the desktop, for the Maslow menu: their name, and the other orgs
// they are in.
export type Me = {
  name: string;
  email: string;
  others: { userId: string; orgName: string }[];
};

// The time, as a Mac's menu bar says it: the day and date beside it on a
// wide screen, the time alone on a narrow one. No seconds, as a Mac shows
// none, and a width held from the first paint so nothing beside it moves
// when the clock arrives.
// On a phone the menus stand in a strip that scrolls sideways, with a
// fade at whichever end can still scroll, and a tap that follows a scroll
// is not a tap (ryOS ScrollableMenuWrapper.tsx:100-215: 24px fades, 3px of
// movement counts as a scroll, taps held off for 100ms after it). On a
// wide screen the menus stand as they are.
function MenuStrip({ children }: { children: ReactNode }) {
  const phone = usePhone();
  const strip = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState({ left: 0, width: 0, room: 0 });
  useEffect(() => {
    const el = strip.current;
    if (!phone || !el) return;
    const read = () =>
      setScroll({
        left: el.scrollLeft,
        width: el.scrollWidth,
        room: el.clientWidth,
      });
    read();
    el.addEventListener("scroll", read, { passive: true });
    const watch = new ResizeObserver(read);
    watch.observe(el);
    return () => {
      el.removeEventListener("scroll", read);
      watch.disconnect();
    };
  }, [phone]);
  const touch = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const scrolled = useRef(false);
  const coasting = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A moved finger, or a flick still coasting, holds every tap off for a
  // moment; one timer, so the later word always wins (ryOS
  // ScrollableMenuWrapper.tsx:50-69).
  const settle = (ms: number) => {
    scrolled.current = true;
    clearTimeout(coasting.current);
    coasting.current = setTimeout(() => (scrolled.current = false), ms);
  };
  if (!phone) return <>{children}</>;
  const fade = 24;
  const canLeft = scroll.left > 0;
  const canRight = scroll.left < scroll.width - scroll.room - 1;
  const mask =
    scroll.width <= scroll.room
      ? undefined
      : canLeft && canRight
        ? `linear-gradient(to right, transparent 0%, black ${fade}px, black calc(100% - ${fade}px), transparent 100%)`
        : canLeft
          ? `linear-gradient(to right, transparent 0%, black ${fade}px, black 100%)`
          : canRight
            ? `linear-gradient(to right, black 0%, black calc(100% - ${fade}px), transparent 100%)`
            : undefined;
  return (
    <div
      ref={strip}
      onScroll={() => settle(300)}
      className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{
        WebkitOverflowScrolling: "touch",
        overscrollBehaviorX: "contain",
        maskImage: mask,
        WebkitMaskImage: mask,
        touchAction: "pan-x",
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = { x: t.clientX, y: t.clientY, moved: false };
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        const at = touch.current;
        if (!at) return;
        if (Math.abs(t.clientX - at.x) > 3 || Math.abs(t.clientY - at.y) > 3)
          at.moved = true;
      }}
      onTouchEnd={() => {
        const moved = touch.current?.moved;
        touch.current = null;
        if (moved) settle(100);
      }}
      onPointerDownCapture={(e) => {
        if (scrolled.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      onClickCapture={(e) => {
        if (scrolled.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      <div className="flex h-full min-w-max items-stretch">{children}</div>
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const size = () => setWide(window.innerWidth > 768);
    tick();
    size();
    const beat = setInterval(tick, 30_000);
    window.addEventListener("resize", size);
    return () => {
      clearInterval(beat);
      window.removeEventListener("resize", size);
    };
  }, []);
  const time = now?.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const day = now
    ?.toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    })
    .replace(",", "");
  return (
    // Every digit the same width, so a minute turning moves nothing.
    <span className="mr-1 text-right whitespace-nowrap tabular-nums sm:mr-2 sm:min-w-28">
      {now ? (wide ? `${day} ${time}` : time) : " "}
    </span>
  );
}

// Whether an update is waiting on this person's computer: asked when the
// desktop opens and every few minutes after, which is how a new image is
// noticed at all. Nothing where this deployment makes no computers.
function useUpdate(computers: boolean) {
  const [update, setUpdate] = useState<Update | null>(null);
  useEffect(() => {
    if (!computers) return;
    let gone = false;
    const ask = async () => {
      const said = await fetch("/computer/update", { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<typeof update>) : null))
        .catch(() => null);
      if (!gone) setUpdate(said);
    };
    void ask();
    const beat = setInterval(() => void ask(), 5 * 60_000);
    return () => {
      gone = true;
      clearInterval(beat);
    };
  }, [computers]);
  // The person taking it: told to the app, and gone from the clock at
  // once.
  const take = async () => {
    const res = await fetch("/computer/update", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    setUpdate(null);
  };
  return { update, take };
}

// A menu's line: BoardUI's row, whose height, padding and highlight are
// the same in every menu of the product.
const item = "gap-6 whitespace-nowrap";

// The keys a line answers to, at its right.
function Keys({ children }: { children: string }) {
  return <Kbd className="ml-auto">{children}</Kbd>;
}
// A menu's name on the bar: lit in the accent, rounded, while it is open.
const name =
  "flex items-center self-stretch rounded-lg px-2 whitespace-nowrap transition-colors duration-fast ease-plain hover:bg-white/10 aria-expanded:bg-linear-to-b aria-expanded:from-accent-600 aria-expanded:to-accent-700 aria-expanded:text-text-white aria-expanded:shadow-nav-selected focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--color-border-focus-ring)]";

export function MenuBar({
  you,
  computers,
  front,
  open,
  onPick,
  onFront,
  onMinimize,
  onFill,
  onClose,
  onSearch,
  onCycle,
  onSnap,
  onSettings,
}: {
  you: Me | undefined;
  // Whether this deployment makes computers at all: the location's log has
  // nowhere to land without one.
  computers: boolean;
  // The window in front on the desktop being looked at, and every window
  // that is out on any desktop.
  front: Held | null;
  open: Held[];
  onPick: (b: Dragged) => void;
  onFront: (w: Held) => void;
  onMinimize: (w: Held) => void;
  onFill: (w: Held) => void;
  onClose: (w: Held) => void;
  onSearch: () => void;
  // The next window forward, or, going back, the front one behind.
  onCycle: (back: boolean) => void;
  // The front window put where a key would put it.
  onSnap: (place: string) => void;
  onSettings: (pane?: string) => void;
}) {
  const [makingOrg, setMakingOrg] = useState(false);
  const [about, setAbout] = useState(false);
  const notifications = useNotifications();
  // The person's location to their own machine, once a minute they are here.
  useLocation(Boolean(you) && computers);
  // An update waiting is a notification behind the clock and a line in
  // the Maslow menu: quiet, since nothing about it is urgent, and there
  // until the person takes it.
  const { update, take } = useUpdate(computers);
  const waiting = notifications.waiting + (update ? 1 : 0);
  return (
    <div className="mac-top-menubar text-caption-1-medium text-text-white fixed top-0 right-0 left-0 z-[60] flex items-center pt-[env(safe-area-inset-top)] pr-[calc(0.5rem+env(safe-area-inset-right))] pl-[calc(0.5rem+env(safe-area-inset-left))]">
      <MenuStrip>
        <Menubar className="flex h-full shrink-0 items-stretch gap-0 rounded-none border-none bg-transparent p-0 whitespace-nowrap">
          <MenubarMenu>
            <MenubarTrigger className={`text-caption-1-medium ${name}`}>
              Maslow
            </MenubarTrigger>
            <MenubarContent align="start" alignOffset={0} sideOffset={1}>
              <MenubarItem className={item} onClick={() => setAbout(true)}>
                About This Computer
              </MenubarItem>
              {update && (
                <MenubarItem
                  className={item}
                  onClick={() => onSettings("computer")}
                >
                  An update is ready…
                </MenubarItem>
              )}
              <MenubarSeparator />
              <MenubarItem className={item} onClick={onSearch}>
                Find…
                <Keys>⌘K</Keys>
              </MenubarItem>
              <MenubarItem className={item} onClick={() => onSettings()}>
                Settings…
                <Keys>⌃⌥,</Keys>
              </MenubarItem>
              {you && (
                <>
                  <MenubarSeparator />
                  {/* A phone's bar has room for Maslow, the search and the
                    clock and no more, so the person's own pane folds in
                    here; a wide bar keeps it under their name. Their other
                    orgs and the way out are the Maslow menu's at every
                    width. */}
                  <div className="sm:hidden">
                    <MenubarItem
                      className={item}
                      onClick={() => onSettings("you")}
                    >
                      You…
                    </MenubarItem>
                  </div>
                  {you.others.length > 0 && (
                    <form action="/auth/switch" method="post">
                      {you.others.map((m) => (
                        <MenubarItem
                          key={m.userId}
                          className={item}
                          nativeButton
                          render={
                            <button
                              type="submit"
                              name="membership"
                              value={m.userId}
                            />
                          }
                        >
                          Switch to {m.orgName}
                        </MenubarItem>
                      ))}
                    </form>
                  )}
                  <MenubarItem
                    className={item}
                    onClick={() => setMakingOrg(true)}
                  >
                    New org…
                  </MenubarItem>
                  <MenubarSeparator />
                  <form action="/auth/sign-out" method="post">
                    <MenubarItem
                      className={item}
                      nativeButton
                      render={<button type="submit" />}
                    >
                      Sign out
                    </MenubarItem>
                  </form>
                </>
              )}
            </MenubarContent>
          </MenubarMenu>
          {front && (
            <MenubarMenu>
              <MenubarTrigger className={`text-caption-1-semibold ${name}`}>
                {front.card.title}
              </MenubarTrigger>
              <MenubarContent align="start" alignOffset={0} sideOffset={1}>
                <MenubarItem
                  className={item}
                  onClick={() => onPick(anotherOf(front.card))}
                >
                  New window
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem className={item} onClick={() => onMinimize(front)}>
                  Minimize
                </MenubarItem>
                <MenubarItem className={item} onClick={() => onFill(front)}>
                  Fill the screen
                </MenubarItem>
                <MenubarSeparator />
                <MenubarItem className={item} onClick={() => onClose(front)}>
                  Close
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          )}
          <MenubarMenu>
            <MenubarTrigger className={`text-caption-1-medium ${name}`}>
              Window
            </MenubarTrigger>
            <MenubarContent align="start" alignOffset={0} sideOffset={1}>
              {open.length === 0 && (
                <MenubarItem className={item} disabled>
                  Nothing is open
                </MenubarItem>
              )}
              {/* Every window, each closed from its row without leaving the
                menu, and all of them at once. */}
              {open.map((w) => (
                <MenubarItem
                  key={w.card.id}
                  className={`${item} group/w`}
                  onClick={() => onFront(w)}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {w.card.minimized
                      ? `${w.card.title} (minimized)`
                      : w.card.title}
                  </span>
                  <button
                    type="button"
                    aria-label={`Close ${w.card.title}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onClose(w);
                    }}
                    className="ml-2 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-foreground-icon-tertiary opacity-0 transition-opacity duration-instant ease-plain group-hover/w:opacity-100 hover:bg-background-tertiary-hover hover:text-text-primary focus-visible:opacity-100"
                  >
                    <RiCloseLine className="size-3.5" aria-hidden />
                  </button>
                </MenubarItem>
              ))}
              {open.length > 1 && (
                <MenubarItem
                  className={item}
                  onClick={() => open.forEach((w) => onClose(w))}
                >
                  Close all windows
                </MenubarItem>
              )}
              <MenubarSeparator />
              {/* What the keys do to the window in front, each with its key. */}
              <MenubarItem
                className={item}
                disabled={!front}
                onClick={() => front && onPick(anotherOf(front.card))}
              >
                New window
                <Keys>⌃⌥N</Keys>
              </MenubarItem>
              <MenubarItem
                className={item}
                disabled={!front}
                onClick={() => front && onClose(front)}
              >
                Close
                <Keys>⌃⌥W</Keys>
              </MenubarItem>
              <MenubarItem
                className={item}
                disabled={!front}
                onClick={() => front && onMinimize(front)}
              >
                Minimize
                <Keys>⌃⌥M</Keys>
              </MenubarItem>
              <MenubarItem
                className={item}
                disabled={open.length < 2}
                onClick={() => onCycle(false)}
              >
                Next window
                <Keys>⌃⌥⇥</Keys>
              </MenubarItem>
              <MenubarItem
                className={item}
                disabled={open.length < 2}
                onClick={() => onCycle(true)}
              >
                Previous window
                <Keys>⌃⌥⇧⇥</Keys>
              </MenubarItem>
              <MenubarSeparator />
              {/* Filling the screen is the green light's act, under the
                green light's words, and not a place of its own. */}
              <MenubarItem
                className={item}
                disabled={!front}
                onClick={() => front && onFill(front)}
              >
                Fill the screen
                <Keys>⌃⌥↩</Keys>
              </MenubarItem>
              {(
                [
                  ["Left half", "left", "⌃⌥←"],
                  ["Right half", "right", "⌃⌥→"],
                  ["Top left", "top left", "⌃⌥U"],
                  ["Top right", "top right", "⌃⌥I"],
                  ["Bottom left", "bottom left", "⌃⌥J"],
                  ["Bottom right", "bottom right", "⌃⌥K"],
                ] as const
              ).map(([label, place, keys]) => (
                <MenubarItem
                  key={place}
                  className={item}
                  disabled={!front}
                  onClick={() => onSnap(place)}
                >
                  {label}
                  <Keys>{keys}</Keys>
                </MenubarItem>
              ))}
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </MenuStrip>
      <div className="ml-auto flex h-full shrink-0 items-center gap-1.5">
        {/* Who is at the desktop, and their own pane of Settings. Their other
            orgs and the way out are the Maslow menu's. */}
        {you && (
          <Menubar className="flex h-full items-stretch gap-0 rounded-none border-none bg-transparent p-0 whitespace-nowrap">
            <MenubarMenu>
              <MenubarTrigger
                data-you
                className={`text-caption-1-medium ${name} max-sm:hidden`}
              >
                {you.name}
              </MenubarTrigger>
              <MenubarContent align="end" alignOffset={0} sideOffset={1}>
                <div className="px-2 pt-1 pb-2">
                  <div className="text-body-medium text-text-primary">
                    {you.name}
                  </div>
                  <div className="text-caption-1-regular text-text-tertiary">
                    {you.email}
                  </div>
                </div>
                <MenubarSeparator />
                <MenubarItem className={item} onClick={() => onSettings("you")}>
                  You…
                </MenubarItem>
              </MenubarContent>
            </MenubarMenu>
          </Menubar>
        )}
        {/* The command bar, for a hand that has not learned the key yet. */}
        <button
          type="button"
          aria-label="Search (⌘K)"
          onClick={onSearch}
          className="focus-visible:outline-border-focus-ring duration-fast ease-plain grid size-[22px] place-items-center rounded-lg outline-none transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          <RiSearchLine aria-hidden className="size-4" />
        </button>
        {/* The clock, and behind it everything waiting on the person: a
            count of the asks nobody has answered, a dot while anything is
            unread, and the panel itself. */}
        <button
          type="button"
          aria-label={
            waiting > 0
              ? `Notifications, ${waiting} waiting on you`
              : "Notifications"
          }
          aria-expanded={notifications.open}
          onClick={() => notifications.show(!notifications.open)}
          className="focus-visible:outline-border-focus-ring duration-fast ease-plain flex items-center gap-1.5 rounded-lg px-1 outline-none transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-1 aria-expanded:bg-white/15"
        >
          {waiting > 0 ? (
            <span className="text-caption-2-semibold bg-accent-500 text-text-white flex h-4 min-w-4 items-center justify-center rounded-full px-1 tabular-nums">
              {waiting}
            </span>
          ) : notifications.unread > 0 ? (
            <span className="bg-accent-500 size-1.5 rounded-full" />
          ) : null}
          <Clock />
        </button>
      </div>
      <NotificationsPanel
        notifications={notifications}
        update={update}
        onUpdate={take}
      />
      <NotificationToasts notifications={notifications} />
      <NewOrgDialog open={makingOrg} onOpenChange={setMakingOrg} />
      <AboutComputer
        open={about}
        onOpenChange={setAbout}
        whose={you?.name ?? "Your"}
      />
    </div>
  );
}
