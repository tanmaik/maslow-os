import { computersAllowed } from "@placeholder/db/computers";
import { usageOfMember } from "@placeholder/db/usage";
import { File as FileIcon, Folder as FolderIcon } from "lucide-react";
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Uploader } from "@/components/uploader";
import { ensureFilesystem, status } from "@/lib/computer";
import { deployment } from "@/lib/deployment";
import { cleanPath, filesOf, listing } from "@/lib/files";
import { amount, dollars } from "@/lib/meter";
import { principal } from "@/lib/session";

const gb = (n: number) =>
  n < 1e6
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
  "no-compute": "None attached",
  unknown: "Fly is not answering; try again shortly",
};

// The person's computer, as its filesystem: folders to open, files to take
// out and put in. What the machine is doing sits folded at the bottom.
export default async function Computer({
  searchParams,
}: {
  searchParams: Promise<{ path?: string }>;
}) {
  const p = await principal();
  if (!p) redirect("/");
  if (deployment.computers.kind === "none")
    return <Note>Computers are not set up on this deployment.</Note>;
  if (!(await computersAllowed(p)))
    return <Note>Computers are not available for this org yet.</Note>;
  let s = await status(p);
  if (!s) {
    await ensureFilesystem(p);
    s = await status(p);
  }
  if (!s)
    return <Note>Your filesystem could not be made. Try again shortly.</Note>;
  const { computer, state } = s;
  const at = cleanPath((await searchParams).path ?? "/") ?? "/";
  const { folders, files } = await listing(p, at);
  const { bytes, files: all } = await filesOf(p);
  const crumbs = at.split("/").filter(Boolean);
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const usage = await usageOfMember(p, monthStart);
  const total = usage.reduce((n, l) => n + l.cost, 0);
  const href = (path: string) => `/computer?path=${encodeURIComponent(path)}`;

  return (
    <main className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between gap-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              {at === "/" ? (
                <BreadcrumbPage>Your computer</BreadcrumbPage>
              ) : (
                <BreadcrumbLink href={href("/")}>Your computer</BreadcrumbLink>
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
                      <BreadcrumbLink href={href(path)}>{c}</BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                </span>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>
        <NewFolder at={at} />
      </div>

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
          {folders.map((f) => (
            <TableRow key={f.path} data-folder={f.path}>
              <TableCell>
                <a href={href(f.path)} className="flex items-center gap-2">
                  <FolderIcon className="text-muted-foreground size-4" />
                  {f.name}
                </a>
              </TableCell>
              <TableCell className="text-muted-foreground">—</TableCell>
              <TableCell className="text-muted-foreground">
                {f.createdAt.toISOString().slice(0, 10)}
              </TableCell>
              <TableCell>
                <FileActions
                  target={{ folder: f.path }}
                  name={f.name}
                  at={at}
                />
              </TableCell>
            </TableRow>
          ))}
          {files.map((f) => (
            <TableRow key={f.id} data-file={f.id}>
              <TableCell>
                {f.state === "ready" ? (
                  <a
                    href={`/files/${f.id}`}
                    className="flex items-center gap-2"
                  >
                    <FileIcon className="text-muted-foreground size-4" />
                    {f.name}
                  </a>
                ) : (
                  <span className="text-muted-foreground flex items-center gap-2">
                    <FileIcon className="size-4" />
                    {f.name} (uploading)
                  </span>
                )}
              </TableCell>
              <TableCell>{gb(f.size)}</TableCell>
              <TableCell className="text-muted-foreground">
                {(f.readyAt ?? f.createdAt).toISOString().slice(0, 10)}
              </TableCell>
              <TableCell>
                <FileActions
                  target={{ file: f.id }}
                  name={f.name}
                  at={at}
                  downloadHref={
                    f.state === "ready" ? `/files/${f.id}` : undefined
                  }
                />
              </TableCell>
            </TableRow>
          ))}
          {folders.length === 0 && files.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-muted-foreground">
                This folder is empty.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      <p
        className="text-muted-foreground mt-2 text-sm"
        data-files-bytes={bytes}
      >
        {gb(bytes)} in {all.filter((f) => f.state === "ready").length} files, on
        a {computer.diskGb} GB filesystem
      </p>

      <Collapsible className="mt-10">
        <CollapsibleTrigger className="text-muted-foreground text-sm underline">
          About this computer
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted>
          <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Compute</dt>
            <dd data-state={state}>
              {STATES[state] ?? state} · {computer.size}
            </dd>
            <dt className="text-muted-foreground">Filesystem</dt>
            <dd>
              {computer.diskUsed !== null && computer.diskTotal !== null
                ? `${gb(computer.diskUsed)} of ${gb(computer.diskTotal)} used, ${computer.seenAt ? `reported ${Math.max(0, Math.round((Date.now() - computer.seenAt.getTime()) / 60000))} min ago` : "not reported yet"}`
                : `${computer.diskGb} GB, ${computer.seenAt ? "reported" : "not reported yet"}`}
            </dd>
            <dt className="text-muted-foreground">This month</dt>
            <dd data-month-total={total}>
              {dollars(total)}
              {usage.length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  (
                  {usage
                    .map(
                      (l) =>
                        `${l.resource} ${amount(l.resource, l.unit, l.quantity)} ${dollars(l.cost)}`,
                    )
                    .join(", ")}
                  )
                </span>
              )}
            </dd>
            <dt className="text-muted-foreground">Region</dt>
            <dd>{computer.region}</dd>
          </dl>
        </CollapsibleContent>
      </Collapsible>
    </main>
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
