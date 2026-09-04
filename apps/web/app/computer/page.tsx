import { computersAllowed } from "@placeholder/db/computers";
import { usageOfMember } from "@placeholder/db/usage";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder as FolderIcon,
  HardDrive,
  SquareArrowOutUpRight,
} from "lucide-react";
import { redirect } from "next/navigation";

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
import { ensureFilesystem, status } from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { disk, DiskError, type Tree } from "@/lib/disk";
import { cleanPath, filesOf } from "@/lib/files";
import { dollars } from "@/lib/meter";
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
  stopped: "Off",
  suspended: "Asleep",
  starting: "Starting",
  stopping: "Stopping",
  suspending: "Falling asleep",
  created: "Built, not yet started",
  building: "Being built",
  failed: "The build failed",
  "no-compute": "Off",
  unknown: "Fly is not answering",
};

const href = (path: string) => `/computer?path=${encodeURIComponent(path)}`;

// The person's computer, laid out as an editor lays out a project: every
// folder down the left, the one being looked at in the middle, a shell on
// the disk and the ports the machine serves below it, and what the
// machine is doing along the bottom. Opening the page wakes the machine.
export default async function Computer({
  searchParams,
}: {
  searchParams: Promise<{ path?: string; error?: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  if (deployment.computers.kind === "none")
    return <Note>Computers are not set up on this deployment.</Note>;
  if (!(await computersAllowed(p)))
    return <Note>Computers are not available for this org yet.</Note>;
  const params = await searchParams;
  const at = cleanPath(params.path ?? "/") ?? "/";
  let s = await status(p);
  if (!s) {
    await ensureFilesystem(p);
    s = await status(p);
  }
  if (!s)
    return <Note>Your filesystem could not be made. Try again shortly.</Note>;
  let listing: Awaited<ReturnType<typeof disk.list>>;
  let tree: Tree;
  let ports: number[];
  let shell: string;
  try {
    [listing, { tree }, { ports }, shell] = await Promise.all([
      disk.list(p, at),
      disk.tree(p),
      disk.ports(p),
      disk.terminalUrl(p),
    ]);
  } catch (err) {
    if (!(err instanceof DiskError)) throw err;
    if (err.status === 404 && at !== "/") redirect("/computer");
    return (
      <Note>
        <span data-disk-error>{err.message}</span>
      </Note>
    );
  }
  const { entries, disk: space } = listing;
  // Files still on their way to this folder, shown in it until they land.
  const arriving = (await filesOf(p)).files.filter((f) => f.path === at);
  // The machine is awake now, having just answered.
  const state =
    s.state === "no-compute" || s.state === "created" || s.state === "stopped"
      ? "started"
      : s.state;
  const crumbs = at.split("/").filter(Boolean);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const total = (await usageOfMember(p, monthStart)).reduce(
    (n, l) => n + l.cost,
    0,
  );

  return (
    <main className="bg-background fixed inset-x-0 top-8 bottom-0 flex flex-col">
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
                      <span key={path} className="contents">
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
                      </span>
                    );
                  })}
                </BreadcrumbList>
              </Breadcrumb>
              <NewFolder at={at} />
            </div>

            {params.error && (
              <p className="text-destructive mt-3 text-sm" data-error>
                {params.error}
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
                        {f.name} ({f.state === "ready" ? "landing" : "arriving"}
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
              <Terminal url={shell} />
            </div>
          </div>
        </div>
      </div>

      <footer
        className="bg-muted/50 text-muted-foreground flex items-center gap-6 border-t py-1.5 pr-4 pl-20 text-xs"
        data-state={state}
        data-disk-used={space.used}
        data-month-total={total}
      >
        <span>{STATES[state] ?? state}</span>
        <span>{s.computer.size}</span>
        <span>{`${gb(space.used)} of ${gb(space.total)} used`}</span>
        <span>{s.computer.region}</span>
        <span className="ml-auto">{dollars(total)} this month</span>
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
