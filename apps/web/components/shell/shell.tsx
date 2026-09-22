"use client";

import {
  RiApps2Line,
  RiHome5Line,
  RiNotification3Line,
  RiSearchLine,
  RiCloseLine,
} from "@remixicon/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { APPS, appHref, type Mark } from "@/app/desktop/apps";
import type { Port } from "@/app/desktop/tiles";
import type { Update } from "@/lib/computer";
import { CommandBar } from "@/app/desktop/command";
import { Down } from "@/app/desktop/down";
import { useLocation } from "@/components/location";
import { remember } from "@/components/lock-screen";
import { EagerLink } from "@/components/eager-link";
import { NewOrgDialog } from "@/components/new-org";
import { Permissions } from "@/components/permissions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  NotificationsPanel,
  NotificationToasts,
  useNotifications,
} from "@/components/notifications";
import { cn } from "@/lib/utils";

// The addresses the shell stands around. Every other page, the way in and
// the pages an outside app is sent to, is drawn bare.
const INSIDE = /^\/(home|brain|settings|computer|browser)(\/|$)/;

// A place: one entry of the sidebar, opened filling the rest.
type Place = { title: string; href: string; mark: Mark };
const SETTINGS: Place = APPS.find((a) => a.kind === "settings")!;
const PLACES: Place[] = [
  { title: "Home", href: "/home", mark: RiHome5Line },
  ...APPS.filter((a) => a !== SETTINGS),
];

// Who is signed in, as the account menu shows them.
type You = {
  name: string;
  email: string;
  org: string;
  picture: string | null;
  others: { userId: string; orgName: string }[];
};

// The shell: the places and the person's apps named down the left, and
// the one that is open filling the rest. A phone has the places along
// the bottom.
export function Shell({
  children,
  computers,
  framed,
  you,
}: {
  children: ReactNode;
  // Whether this page was asked for as a frame: a pane of a shell already
  // on screen, drawn bare.
  framed: boolean;
  // Whether the person has a computer: signed in, on a deployment with
  // computers.
  computers: boolean;
  // Who is signed in, and the other orgs they are in.
  you: You | null;
}) {
  const path = usePathname();
  const router = useRouter();
  const notifications = useNotifications();
  useLocation(computers && !framed);
  // Whoever is here is offered by face at this device's next sign-in.
  useEffect(() => {
    if (you)
      remember({ name: you.name, email: you.email, picture: you.picture });
  }, [you]);
  // The command bar, and what was typed to open it.
  const [bar, setBar] = useState({ open: false, initial: "" });
  const [makingOrg, setMakingOrg] = useState(false);
  // The apps the person can open: their own that are up, and those
  // colleagues opened to them.
  const [apps, setApps] = useState<Port[]>([]);
  // Whether the person's computer is not answering: being made, moved,
  // restarted or updated. The screen is covered until it is back.
  const [down, setDown] = useState(false);
  // The update waiting on the person's computer, until they take it.
  const [update, setUpdate] = useState<Update | null>(null);
  const inside = !framed && INSIDE.test(path);
  // What an agent connected to the brain asked to show while something
  // else was open, offered and not opened.
  const [offered, setOffered] = useState<{ href: string; title: string }[]>([]);
  // A page inside the shell is flush to its pane, as one framed in a
  // window was.
  useLayoutEffect(() => {
    if (window.self !== window.top) return;
    const html = document.documentElement;
    if (inside) html.dataset.framed = "";
    else delete html.dataset.framed;
    html.toggleAttribute("data-shell", inside);
  }, [inside]);
  // Anything is shown one thing at a time. A port is an outside page, so
  // it is shown by the page of ours that frames it.
  const show = (href: string, title?: string) =>
    router.push(
      href.startsWith("/port/")
        ? appHref({ href, title: title ?? "App" })
        : href,
    );
  const showing = useRef(show);
  showing.current = show;

  // Command-K opens the command bar. What a pane or a program on the
  // computer asks to open takes the pane: a file as its
  // preview, a folder as Files there, a port or an address as itself.
  useEffect(() => {
    if (!inside) return;
    const key = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        e.key.toLowerCase() === "k"
      ) {
        e.preventDefault();
        setBar({ open: true, initial: "" });
      }
    };
    const said = (e: MessageEvent) => {
      if (e.origin !== location.origin) return;
      const asked = e.data as {
        maslow?: string;
        view?: unknown;
        share?: { id?: unknown };
        path?: unknown;
        file?: unknown;
        url?: unknown;
      };
      if (asked?.maslow === "command") setBar({ open: true, initial: "" });
      // A restart asked for in any pane: the computer is off at once.
      if (asked?.maslow === "off" && computers) setDown(true);
      if (asked?.maslow !== "open") return;
      const file = (path: string, share?: string) =>
        `/computer/files/view?${share ? `share=${encodeURIComponent(share)}&` : ""}path=${encodeURIComponent(path)}`;
      if (typeof asked.view === "string")
        showing.current(
          file(
            asked.view,
            typeof asked.share?.id === "string" ? asked.share.id : undefined,
          ),
        );
      else if (typeof asked.path === "string")
        showing.current(
          asked.file
            ? file(asked.path)
            : `/computer/files?path=${encodeURIComponent(asked.path)}`,
        );
      else if (typeof asked.url === "string")
        showing.current(`/browser?url=${encodeURIComponent(asked.url)}`);
    };
    addEventListener("keydown", key);
    addEventListener("message", said);
    return () => {
      removeEventListener("keydown", key);
      removeEventListener("message", said);
    };
  }, [inside]);

  // What an agent asked, through the brain, to put in front of the
  // person: opened where the screen is empty, and offered, never put over
  // it, where something is open.
  const act = (asked: { href: string; title: string }[]) => {
    let empty = path === "/home";
    for (const open of asked) {
      if (empty) show(open.href, open.title);
      else setOffered((was) => [...was, open].slice(-3));
      empty = false;
    }
  };
  const acting = useRef(act);
  acting.current = act;
  // Asked for every few seconds while the page is looked at, so what is
  // opened for the person is on screen within seconds.
  useEffect(() => {
    if (!inside) return;
    const look = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch("/opens", { cache: "no-store" }).catch(
        () => null,
      );
      if (!res?.ok) return;
      const { opens, computer } = (await res.json()) as {
        opens: { href: string; title: string }[];
        computer: string;
      };
      setDown(computers && computer !== "ready");
      if (opens.length > 0) acting.current(opens);
    };
    const beat = setInterval(() => void look(), 4000);
    return () => clearInterval(beat);
  }, [inside, computers]);

  useEffect(() => {
    if (!inside || !computers) return;
    const look = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch("/desktop/ports", { cache: "no-store" }).catch(
        () => null,
      );
      if (!res?.ok) return;
      const { ports } = (await res.json()) as { ports: Port[] | null };
      // A computer that did not answer leaves what was known standing.
      if (ports) setApps(ports);
    };
    void look();
    const beat = setInterval(() => void look(), 20_000);
    addEventListener("focus", look);
    return () => {
      clearInterval(beat);
      removeEventListener("focus", look);
    };
  }, [inside, computers]);

  // Asked after every few minutes, which is also what looks at the
  // machine: a new image is offered within minutes of a deploy.
  useEffect(() => {
    if (!inside || !computers) return;
    const look = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch("/computer/update", { cache: "no-store" }).catch(
        () => null,
      );
      if (res?.ok) setUpdate((await res.json()) as Update | null);
    };
    void look();
    const beat = setInterval(() => void look(), 5 * 60_000);
    return () => clearInterval(beat);
  }, [inside, computers]);

  if (!inside) return <>{children}</>;

  return (
    <>
      <div className="fixed inset-0 flex flex-col bg-background text-foreground md:flex-row">
        <nav
          aria-label="Places"
          className="order-last flex shrink-0 items-center justify-around border-t border-border px-2 pb-[env(safe-area-inset-bottom)] md:order-none md:w-52 md:flex-col md:items-stretch md:justify-start md:gap-0.5 md:overflow-y-auto md:border-t-0 md:border-r md:p-2"
        >
          <RailButton
            title="Search"
            hint="⌘K"
            mark={RiSearchLine}
            lit={bar.open}
            wideOnly
            onClick={() => setBar({ open: true, initial: "" })}
          />
          {PLACES.map((p) => (
            <RailLink key={p.href} place={p} active={path.startsWith(p.href)} />
          ))}
          {computers && apps.length > 0 && (
            <div className="hidden flex-col gap-0.5 md:flex">
              <h2 className="px-2 pt-4 pb-1 text-xs font-medium text-muted-foreground">
                Apps
              </h2>
              {apps.map((app) => (
                <AppLink
                  key={app.href}
                  app={app}
                  active={
                    path === "/computer/app" &&
                    new URLSearchParams(location.search).get("at") === app.href
                  }
                />
              ))}
            </div>
          )}
          <div className="hidden flex-1 md:block" />
          <RailButton
            title="Notifications"
            label={
              notifications.waiting > 0
                ? `Notifications, ${notifications.waiting} waiting on you`
                : "Notifications"
            }
            mark={RiNotification3Line}
            lit={notifications.open}
            dot={
              notifications.unread > 0 || notifications.waiting > 0 || !!update
            }
            onClick={() => notifications.show(!notifications.open)}
          />
          <RailLink place={SETTINGS} active={path.startsWith("/settings")} />
          {you && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label={`${you.name}, ${you.org}`}
                className={cn(rail, "hidden md:flex")}
              >
                {you.picture ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={you.picture}
                    alt=""
                    className="size-5 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-foreground">
                    {you.name
                      .split(" ")
                      .map((w) => w[0])
                      .slice(0, 2)
                      .join("")}
                  </span>
                )}
                <span data-you className="truncate">
                  {you.name}
                </span>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="w-56">
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="flex flex-col">
                    <span className="text-foreground">{you.name}</span>
                    <span className="truncate text-xs font-normal text-muted-foreground">
                      {you.org} · {you.email}
                    </span>
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {you.others.length > 0 && (
                  <form action="/auth/switch" method="post">
                    {you.others.map((m) => (
                      <DropdownMenuItem
                        key={m.userId}
                        nativeButton
                        render={
                          <button
                            type="submit"
                            name="membership"
                            value={m.userId}
                            className="w-full"
                          />
                        }
                      >
                        Switch to {m.orgName}
                      </DropdownMenuItem>
                    ))}
                  </form>
                )}
                <DropdownMenuItem onClick={() => setMakingOrg(true)}>
                  New org…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <form action="/auth/sign-out" method="post">
                  <DropdownMenuItem
                    nativeButton
                    render={<button type="submit" className="w-full" />}
                  >
                    Sign out
                  </DropdownMenuItem>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </nav>

        <section
          aria-label="Open"
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          {children}
          {offered.length > 0 && (
            <div className="absolute bottom-3 left-1/2 z-40 flex -translate-x-1/2 flex-col gap-1">
              {offered.map((o, i) => (
                <div
                  key={`${o.href} ${i}`}
                  className="flex items-center gap-2 rounded-md border border-border bg-popover py-1 pr-1 pl-3 text-sm shadow-md"
                >
                  <span className="max-w-64 truncate">
                    Your agent wants to show you {o.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      show(o.href, o.title);
                      setOffered((was) => was.filter((x) => x !== o));
                    }}
                    className="rounded-md px-2 py-1 text-primary transition-colors duration-150 hover:bg-accent"
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    aria-label="Not now"
                    onClick={() =>
                      setOffered((was) => was.filter((x) => x !== o))
                    }
                    className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
                  >
                    <RiCloseLine className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
      {down && <Down back={false} />}
      {you && <Permissions computers={computers} />}
      <NewOrgDialog open={makingOrg} onOpenChange={setMakingOrg} />
      <NotificationsPanel
        notifications={notifications}
        update={update}
        onUpdate={async () => {
          setDown(true);
          const res = await fetch("/computer/update", { method: "POST" });
          if (res.ok) setUpdate(null);
          else setDown(false);
        }}
      />
      <NotificationToasts notifications={notifications} />
      <CommandBar
        open={bar.open}
        initial={bar.initial}
        onOpenChange={(open) => setBar((b) => ({ ...b, open }))}
        ports={apps}
        onApp={(b) => router.push(b.href)}
        onNewApp={(b) => show(b.href, b.title)}
        onPane={(id) => router.push(`/settings?pane=${id}`)}
        onRecord={(id) => router.push(`/brain/records/${id}`)}
        onFile={(file) =>
          show(`/computer/files/view?path=${encodeURIComponent(file)}`)
        }
      />
    </>
  );
}

// A row of the sidebar: a mark and its name on a laptop, the mark alone
// along the bottom of a phone.
const rail =
  "relative flex size-11 shrink-0 items-center justify-center rounded-md text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground aria-[current=page]:bg-accent aria-[current=page]:font-medium aria-[current=page]:text-foreground md:h-8 md:w-full md:justify-start md:gap-2 md:px-2";
const name = "hidden truncate md:inline";

function RailLink({ place, active }: { place: Place; active: boolean }) {
  const Mark = place.mark;
  return (
    <EagerLink
      href={place.href}
      aria-label={place.title}
      aria-current={active ? "page" : undefined}
      className={rail}
    >
      <Mark className="size-[18px] shrink-0 md:size-4" />
      <span className={name}>{place.title}</span>
    </EagerLink>
  );
}

// An app in the sidebar: the face it was published with, or a plain one.
// One that opens in a tab of its own does, and the rest fill the screen.
function AppLink({ app, active }: { app: Port; active: boolean }) {
  return (
    <Link
      href={app.tab ? app.href : appHref(app)}
      target={app.tab ? "_blank" : undefined}
      aria-current={active ? "page" : undefined}
      className={rail}
    >
      {app.face ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={app.face} alt="" className="size-4 shrink-0 rounded-sm" />
      ) : (
        <RiApps2Line className="size-4 shrink-0" />
      )}
      <span className={name}>{app.title}</span>
    </Link>
  );
}

function RailButton({
  title,
  label = title,
  hint,
  mark: Mark,
  lit,
  dot = false,
  wideOnly = false,
  onClick,
}: {
  title: string;
  // What a screen reader is told, where it says more than the name.
  label?: string;
  // The keys that do the same, shown at the row's end.
  hint?: string;
  mark: Mark;
  // Whether something waits behind it.
  dot?: boolean;
  // Left off a phone's row of tabs.
  wideOnly?: boolean;
  // Whether what it shows is in view.
  lit: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={lit}
      onClick={onClick}
      className={cn(
        rail,
        lit && "md:text-foreground",
        wideOnly && "hidden md:flex",
      )}
    >
      <Mark className="size-[18px] shrink-0 md:size-4" />
      <span className={cn(name, "flex-1 text-left")}>{title}</span>
      {hint && (
        <kbd className="hidden font-sans text-xs text-muted-foreground md:inline">
          {hint}
        </kbd>
      )}
      {dot && (
        <span className="absolute top-2 right-2 size-1.5 rounded-full bg-primary md:static" />
      )}
    </button>
  );
}
