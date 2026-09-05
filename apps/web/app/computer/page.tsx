import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder as FolderIcon,
  HardDrive,
  SquareArrowOutUpRight,
} from "lucide-react";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Fragment } from "react";

import { ComputerActions } from "@/components/computer-actions";
import { FileActions } from "@/components/file-actions";
import { NewFolder } from "@/components/new-folder";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Terminal } from "@/components/terminal";
import { Uploader } from "@/components/uploader";
import { backupsOf } from "@placeholder/db/backups";
import {
  computerOf,
  computersAllowed,
  lastResizeIn,
  noteEvent,
} from "@placeholder/db/computers";

import { LocalTime } from "@/components/local-time";
import { Button } from "@/components/ui/button";
import { ensureFilesystem, sizing, status } from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { disk, DiskError, type Tree } from "@/lib/disk";
import { cleanPath, filesOf, whole } from "@/lib/files";
import { live, sweepIfDue } from "@/lib/meter";
import { dollars, parseSize, sizeName } from "@/lib/prices";
import { principal } from "@/lib/session";

const gb = (n: number) =>
  n < 1e3
    ? `${n} B`
    : n < 1e6
      ? `${(n / 1e3).toFixed(0)} KB`
      : n < 1e9
        ? `${(n / 1e6).toFixed(1)} MB`
        : `${(n / 1e9).toFixed(1)} GB`;

const STATES: Record<string, string> = {
  started: "Running",
  stopped: "Stopped",
  suspended: "Stopped",
  starting: "Starting",
  stopping: "Stopping",
  suspending: "Stopping",
  created: "Built, not yet started",
  building: "Being built",
  failed: "The build failed",
  "no-compute": "Stopped",
  "powered-off": "Powered off",
  unknown: "Fly is not answering",
};

const href = (path: string) => `/computer?path=${encodeURIComponent(path)}`;

// What the Finder shows of a home: what is not hidden, as a Mac does.
// The shell and the tools see everything.
const shown = (name: string) => !name.startsWith(".");
const shownTree = (t: Tree): Tree => ({
  ...t,
  folders: t.folders.filter((f) => shown(f.name)).map(shownTree),
});

// Vercel gives this request this long.
export const maxDuration = 60;

// The person's computer, laid out as an editor lays out a project: every
// folder down the left, the one being looked at in the middle, a shell on
// the disk and the ports the machine serves below it, and what the
// machine is doing along the bottom. The machine was made at sign-in and
// runs until the person powers it off; the page reaches it, which starts
// it if Fly ever stopped it.
export default async function Computer({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  if (deployment.computers.kind === "none")
    return <Note>Computers are not set up on this deployment.</Note>;
  if (!(await computersAllowed(p)))
    return (
      <Note>
        Computers are off for this org: an owner turned them off. An owner can
        turn them on again in{" "}
        <a href="/settings" className="underline">
          Settings
        </a>
        .
      </Note>
    );
  const params = await searchParams;
  const at = cleanPath(params.path ?? "/") ?? "/";
  // A look at the computer is when the meter, the backups and the
  // stragglers catch up, wherever this runs.
  after(() => sweepIfDue());
  // Why the machine may be woken next: this look.
  const before = await computerOf(p);
  if (before) await noteEvent(p.orgId, before, "opened");
  let s = await status(p);
  if (!s) {
    await ensureFilesystem(p);
    const made = await computerOf(p);
    if (made) await noteEvent(p.orgId, made, "opened");
    s = await status(p);
  }
  if (!s)
    return <Note>Your filesystem could not be made. Try again shortly.</Note>;
  // Powered off by the person: the disk is kept and nothing is read from
  // it; one button powers it on.
  if (s.computer.offAt)
    return (
      <Note>
        <span data-state="powered-off">
          Your computer is powered off. Its disk and files are kept; only the
          disk is charged.
        </span>
        <form action="/computer/on" method="post" className="mt-4">
          <input type="hidden" name="path" value="/" />
          <Button type="submit" data-power-on>
            Power on
          </Button>
        </form>
      </Note>
    );
  // A reset asked for: the page says so while it goes, and how it went —
  // done, refused with nothing changed, stopped partway, or unreadable.
  // Never nothing.
  let resetSaid: React.ReactNode = null;
  let resetWrong = false;
  if (params.reset === "started") {
    try {
      const r = await disk.resetting(p);
      // While it goes the disk is not served; nothing else is asked.
      if (r.running)
        return (
          <Note>
            <span data-resetting>
              The system is being reset: a backup of your home first, then a
              fresh system around it. Open this page again in a minute.
            </span>
          </Note>
        );
      if (r.last?.ok)
        resetSaid = (
          <>
            System reset at <LocalTime at={new Date(r.last.at)} />; your files
            are as they were.
          </>
        );
      else if (r.last?.refused)
        resetSaid = `${r.last.refused}, so nothing was changed.`;
      else if (r.last)
        resetSaid = `The reset stopped partway: ${r.last.error}. The next boot finishes it.`;
      resetWrong = Boolean(r.last && !r.last.ok);
    } catch (err) {
      if (!(err instanceof DiskError)) throw err;
      resetSaid = `How the reset went could not be read: ${err.message}`;
      resetWrong = true;
    }
  }
  let listing: Awaited<ReturnType<typeof disk.list>>;
  let tree: Tree;
  let ports: number[];
  try {
    [listing, { tree }, { ports }] = await Promise.all([
      disk.list(p, at),
      disk.tree(p),
      disk.ports(p),
    ]);
    tree = shownTree(tree);
  } catch (err) {
    if (!(err instanceof DiskError)) throw err;
    if (err.status === 404 && at !== "/") redirect("/computer");
    return (
      <Note>
        <span data-disk-error>{err.message}</span>
      </Note>
    );
  }
  const entries = listing.entries.filter((e) => shown(e.name));
  const space = listing.disk;
  // The rest of what the page shows, read at once: the row as it is now
  // that the machine has answered, the ladder's word on it, the files on
  // their way, the backups, a restore under way, and the month's meter.
  const [row, lastResize, uploads, backups, restoring, meter] =
    await Promise.all([
      computerOf(p),
      lastResizeIn(p.orgId, s.computer.id),
      filesOf(p),
      backupsOf(p),
      entries.length === 0 ? disk.restoring(p) : null,
      live(p),
    ]);
  const computer = row ?? s.computer;
  const size = sizing(computer, lastResize?.at ?? null);
  const load = computer.need?.load?.at(-1);
  const free = computer.need?.memory?.free.at(-1);
  const gbOf = (s: string) => `${parseSize(s).memoryMb / 1024} GB`;
  // A size-up in the last day is said, so nothing ran out unnoticed; a
  // size-down is quiet.
  const sizedUp =
    lastResize &&
    lastResize.why !== "room-to-spare" &&
    Date.now() - lastResize.at.getTime() < 24 * 3600_000
      ? lastResize
      : null;
  // Files still on their way to this folder, shown in it until they land.
  const arriving = uploads.files.filter((f) => f.path === at);
  // The machine is awake now, having just answered.
  const state =
    s.state === "no-compute" || s.state === "created" || s.state === "stopped"
      ? "started"
      : s.state;
  const latest = backups[0];
  const month = meter.month;
  const notice = resetSaid ?? said(params);
  const ago = (d: Date) => {
    const m = Math.round((Date.now() - d.getTime()) / 60000);
    return m < 60
      ? `${m} min ago`
      : m < 1440
        ? `${Math.round(m / 60)} h ago`
        : `${Math.round(m / 1440)} d ago`;
  };
  const crumbs = at.split("/").filter(Boolean);

  return (
    <main className="bg-background fixed inset-x-0 top-14 bottom-0 flex flex-col border-t">
      <div className="flex min-h-0 flex-1">
        <nav
          className="bg-muted/30 w-64 shrink-0 overflow-y-auto border-r p-2 text-sm"
          aria-label="Folders"
        >
          <a
            href={href("/")}
            className={`flex items-center gap-2 rounded px-2 py-1 font-medium ${at === "/" ? "bg-accent" : "hover:bg-accent/50"}`}
          >
            <HardDrive className="size-4" /> Your computer
          </a>
          <Branch node={tree} at={at} depth={0} />
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <section className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
            <div className="flex items-center justify-between gap-4">
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    {at === "/" ? (
                      <BreadcrumbPage>Your computer</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink href={href("/")}>
                        Your computer
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {crumbs.map((c, i) => {
                    const path = "/" + crumbs.slice(0, i + 1).join("/");
                    const last = i === crumbs.length - 1;
                    return (
                      <Fragment key={path}>
                        <BreadcrumbSeparator />
                        <BreadcrumbItem>
                          {last ? (
                            <BreadcrumbPage>{c}</BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink href={href(path)}>
                              {c}
                            </BreadcrumbLink>
                          )}
                        </BreadcrumbItem>
                      </Fragment>
                    );
                  })}
                </BreadcrumbList>
              </Breadcrumb>
              <span className="flex items-center gap-2">
                <NewFolder at={at} />
                <ComputerActions at={at} />
              </span>
            </div>

            {notice && (
              <p
                className={`mt-3 text-sm ${params.error || resetWrong ? "text-destructive" : "text-muted-foreground"}`}
                data-notice
              >
                {notice}
              </p>
            )}

            <div className="mt-4" data-path={at}>
              <Uploader path={at} />
            </div>

            <Table className="mt-4">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-28">Size</TableHead>
                  <TableHead className="w-32">Modified</TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
                  const path = at === "/" ? `/${e.name}` : `${at}/${e.name}`;
                  return (
                    <TableRow
                      key={path}
                      {...(e.kind === "folder"
                        ? { "data-folder": path }
                        : { "data-file": path })}
                    >
                      <TableCell>
                        <a
                          href={
                            e.kind === "folder"
                              ? href(path)
                              : `/files/download?path=${encodeURIComponent(path)}`
                          }
                          className="flex items-center gap-2"
                        >
                          {e.kind === "folder" ? (
                            <FolderIcon className="text-muted-foreground size-4" />
                          ) : (
                            <FileIcon className="text-muted-foreground size-4" />
                          )}
                          {e.name}
                        </a>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.kind === "folder" ? "—" : gb(e.size)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.modified.slice(0, 10)}
                      </TableCell>
                      <TableCell>
                        <FileActions
                          target={path}
                          kind={e.kind}
                          name={e.name}
                          at={at}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
                {arriving.map((f) => (
                  <TableRow key={f.id} data-upload={f.id}>
                    <TableCell>
                      <span className="text-muted-foreground flex items-center gap-2">
                        <FileIcon className="size-4" />
                        {f.name} (
                        {!whole(f)
                          ? "arriving"
                          : f.said
                            ? `could not land: ${f.said}; tried again within the hour`
                            : "landing"}
                        )
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {gb(f.size)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {f.createdAt.toISOString().slice(0, 10)}
                    </TableCell>
                    <TableCell>
                      <FileActions
                        upload={f.id}
                        target={f.path}
                        kind="file"
                        name={f.name}
                        at={at}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && arriving.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground">
                      This folder is empty.
                      {at === "/" && restoring?.running && (
                        <p className="mt-3" data-restoring>
                          A backup is being put back. This page will show it
                          when it is done.
                        </p>
                      )}
                      {at === "/" &&
                        !restoring?.running &&
                        backups.length > 0 && (
                          <div className="mt-3 space-y-2">
                            <p>
                              A backup can be put back onto this empty disk.
                            </p>
                            {backups.map((b) => (
                              <form
                                key={b.id}
                                action="/computer/restore"
                                method="post"
                                className="flex items-center gap-3"
                                data-restore={b.id}
                              >
                                <input type="hidden" name="path" value="/" />
                                <input
                                  type="hidden"
                                  name="backup"
                                  value={b.id}
                                />
                                <span>
                                  <LocalTime at={b.finishedAt!} /> (
                                  {gb(b.size ?? 0)})
                                </span>
                                <Button
                                  type="submit"
                                  size="sm"
                                  variant="outline"
                                >
                                  Restore this one
                                </Button>
                              </form>
                            ))}
                          </div>
                        )}{" "}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </section>

          <div className="flex h-72 shrink-0 flex-col border-t">
            <div
              className="bg-muted/50 text-muted-foreground flex items-center gap-4 overflow-x-auto border-b px-3 py-1 text-xs whitespace-nowrap"
              data-ports={ports.join(",")}
            >
              <span className="text-foreground font-medium">Terminal</span>
              <span className="ml-4">Previews</span>
              {ports.length === 0 ? (
                <span>nothing is listening yet</span>
              ) : (
                ports.map((port) => (
                  <a
                    key={port}
                    href={`/computer/preview?port=${port}`}
                    target="_blank"
                    rel="noopener"
                    className="hover:text-foreground flex items-center gap-1 underline"
                  >
                    :{port} <SquareArrowOutUpRight className="size-3" />
                  </a>
                ))
              )}
            </div>
            <div className="min-h-0 flex-1">
              <Terminal />
            </div>
          </div>
        </div>
      </div>

      <footer
        className="bg-muted/50 text-muted-foreground flex items-center gap-6 border-t py-1.5 pr-4 pl-20 text-xs"
        data-state={state}
        data-disk-used={space.used}
        data-month-total={month}
      >
        <span>{STATES[state] ?? state}</span>
        <span
          data-size={computer.size}
          data-wants={size.up}
          data-cpu={load === undefined ? undefined : Math.round(load * 100)}
          data-memory={
            free === undefined ? undefined : Math.round((1 - free) * 100)
          }
        >
          {sizeName(computer.size)}
          {load !== undefined &&
            ` · CPU ${Math.round(Math.min(load, 1) * 100)}%`}
          {free !== undefined &&
            ` · memory ${Math.round((1 - free) * 100)}% used`}
        </span>
        {size.up ? (
          <form
            action="/computer/bigger"
            method="post"
            className="flex items-center gap-2"
            data-pending="up"
          >
            <input type="hidden" name="path" value={at} />
            <span>more memory is on its way</span>
            <Button type="submit" size="sm" variant="outline">
              Restart with more memory now
            </Button>
          </form>
        ) : (
          sizedUp && (
            <span data-sized-up={sizedUp.size}>
              sized up to {gbOf(sizedUp.size)} at <LocalTime at={sizedUp.at} />
              {sizedUp.why === "asked-bigger"
                ? ", as you asked"
                : " so nothing ran out"}
            </span>
          )
        )}
        <span>{`${gb(space.used)} of ${gb(space.total)} used`}</span>
        <span>{place(computer.region)}</span>
        <span data-backups={backups.length}>
          {latest
            ? `backed up ${ago(latest.finishedAt!)}, ${backups.length} kept`
            : "not backed up yet"}
        </span>
        <span className="ml-auto">{dollars(month)} this month so far</span>
      </footer>
    </main>
  );
}

// One folder of the tree and, when it is on the way to where the person
// is, the folders inside it.
function Branch({
  node,
  at,
  depth,
}: {
  node: Tree;
  at: string;
  depth: number;
}) {
  return (
    <ul>
      {node.folders.map((f) => {
        const open = at === f.path || at.startsWith(`${f.path}/`);
        return (
          <li key={f.path}>
            <a
              href={href(f.path)}
              data-tree={f.path}
              className={`flex items-center gap-1 rounded py-1 pr-2 ${at === f.path ? "bg-accent" : "hover:bg-accent/50"}`}
              style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
            >
              {f.folders.length > 0 ? (
                open ? (
                  <ChevronDown className="size-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="size-3.5 shrink-0" />
                )
              ) : (
                <span className="size-3.5 shrink-0" />
              )}
              <FolderIcon className="text-muted-foreground size-4 shrink-0" />
              <span className="truncate">{f.name}</span>
            </a>
            {open && <Branch node={f} at={at} depth={depth + 1} />}
          </li>
        );
      })}
    </ul>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Your computer</h1>
      <p className="text-muted-foreground mt-2">{children}</p>
    </main>
  );
}

// What the address says happened, in words.
function said(params: Record<string, string | undefined>): string | null {
  if (params.error) return params.error;
  const table: Record<string, string> = {
    "folder=name": "That is not a name a folder can have.",
    "renamed=name": "That is not a name a file can have.",
    "moved=where": "Say which folder to move it to.",
    "moved=inside": "A folder cannot be moved into itself.",
    "deleted=where": "Say what to delete.",
    "deleted=gone": "That was already gone.",
    "restored=gone": "That backup is gone.",
    "restored=started": "The backup is being put back.",
    "backup=started":
      "A backup is being taken. The bar below says when it is done.",
    "computer=on": "Your computer is powered on.",
    "bigger=done": "Restarted with more memory.",
    "bigger=top": "It is already at the biggest size there is.",
  };
  for (const [k, v] of Object.entries(params))
    if (v && table[`${k}=${v}`]) return table[`${k}=${v}`]!;
  return null;
}

// A region as a person would say it.
const place = (region: string) =>
  ({
    sjc: "San Jose",
    iad: "Virginia",
    lhr: "London",
    ams: "Amsterdam",
    fra: "Frankfurt",
    sin: "Singapore",
    syd: "Sydney",
    nrt: "Tokyo",
    gru: "São Paulo",
    ord: "Chicago",
    lax: "Los Angeles",
    sea: "Seattle",
    dfw: "Dallas",
    ewr: "New Jersey",
    cdg: "Paris",
    yyz: "Toronto",
    bom: "Mumbai",
  })[region] ?? region;
