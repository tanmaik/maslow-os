"use client";

import {
  ArrowUpTrayIcon,
  DocumentIcon,
  DocumentTextIcon,
  FolderIcon,
  PhotoIcon,
  VideoCameraIcon,
} from "@heroicons/react/24/solid";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { Editor } from "@/app/computer/files/editor";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { liveSocket } from "@/lib/live";

// One thing in a folder, as the door lists it.
type Entry = {
  name: string;
  kind: "dir" | "file" | "link" | "other";
  size: number;
  modified: string;
};

// An upload in flight: how far it has got, and what stopped it if anything.
type Upload = { done: number; total: number; error?: string };

// A file goes up in pieces this big, so a dropped connection loses at most
// one piece and picks up from the last the door kept.
const PIECE = 8 * 1024 * 1024;

const TEXT = new Set([
  "txt",
  "md",
  "json",
  "js",
  "mjs",
  "ts",
  "tsx",
  "css",
  "html",
  "sh",
  "py",
  "yml",
  "yaml",
  "toml",
  "env",
  "gitignore",
  "csv",
  "log",
  "xml",
  "sql",
]);
const IMAGE = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "heic",
  "tif",
  "tiff",
  "bmp",
]);
const VIDEO = new Set(["mp4", "m4v", "mov", "webm", "mkv"]);
const DOCUMENT = new Set([
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "rtf",
]);

const ending = (name: string) =>
  name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
const isText = (e: Entry) => e.kind === "file" && TEXT.has(ending(e.name));
const isImage = (e: Entry) => e.kind === "file" && IMAGE.has(ending(e.name));
const isVideo = (e: Entry) => e.kind === "file" && VIDEO.has(ending(e.name));
const isPdf = (e: Entry) => e.kind === "file" && ending(e.name) === "pdf";
const isDocument = (e: Entry) =>
  e.kind === "file" && DOCUMENT.has(ending(e.name));
// A picture is made on the machine for these; a small SVG is shown as is.
const pictured = (e: Entry) =>
  (isImage(e) && ending(e.name) !== "svg") ||
  isVideo(e) ||
  isPdf(e) ||
  isDocument(e);

// Bytes in words a person reads at a glance.
const size = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1024 ** 2
      ? `${(n / 1024).toFixed(0)} KB`
      : n < 1024 ** 3
        ? `${(n / 1024 ** 2).toFixed(1)} MB`
        : `${(n / 1024 ** 3).toFixed(2)} GB`;

const readHref = (path: string) =>
  `/computer/files/read?path=${encodeURIComponent(path)}`;
const previewHref = (path: string, modified: string) =>
  `/computer/files/preview?path=${encodeURIComponent(path)}&v=${encodeURIComponent(modified)}`;

// The person's files on their own computer. A folder's contents, folders
// first; a look at a file beside them, or beneath them when the window is
// narrow; a small edit saved back; and a file dropped anywhere on the
// window, sent straight to the machine in pieces, carrying on from where
// it stopped if the connection drops.
export function Finder() {
  const [path, setPath] = useState<string[]>([]);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [picked, setPicked] = useState<Entry | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploads, setUploads] = useState<Record<string, Upload>>({});
  const [dragging, setDragging] = useState(false);
  // Files whose names start with a dot are the machine's own business
  // until asked for.
  const [dotfiles, setDotfiles] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const dir = path.join("/");
  const at = (name: string) => (dir ? `${dir}/${name}` : name);

  const load = useCallback(async () => {
    setFailed(null);
    try {
      const res = await fetch(
        `/computer/files/list?path=${encodeURIComponent(dir || ".")}`,
      );
      if (!res.ok) throw new Error(await res.text());
      setEntries((await res.json()) as Entry[]);
    } catch (err) {
      setEntries([]);
      setFailed((err as Error).message);
    }
  }, [dir]);

  useEffect(() => {
    setPicked(null);
    setText(null);
    setEntries(null);
    void load();
  }, [load]);

  // The list follows the disk: the folder shown is watched through the
  // machine's door, and a change in it reads the list again a moment
  // later, once a burst of changes has settled.
  const sock = useRef<WebSocket | null>(null);
  const latest = useRef({ dir, load });
  latest.current = { dir, load };
  useEffect(() => {
    let stopped = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let soon: ReturnType<typeof setTimeout> | undefined;
    const connect = async () => {
      try {
        const next = await liveSocket("view");
        if (stopped) return next.close();
        ws = next;
        sock.current = next;
        next.send(JSON.stringify({ watch: latest.current.dir || "." }));
        next.onmessage = (m) => {
          if (typeof m.data !== "string") return;
          if (!("changed" in JSON.parse(m.data))) return;
          clearTimeout(soon);
          soon = setTimeout(() => void latest.current.load(), 300);
        };
        next.onclose = () => {
          ws = null;
          sock.current = null;
          if (!stopped) timer = setTimeout(connect, 1000);
        };
      } catch {
        if (!stopped) timer = setTimeout(connect, 5000);
      }
    };
    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(soon);
      ws?.close();
      sock.current = null;
    };
  }, []);
  useEffect(() => {
    if (sock.current?.readyState === WebSocket.OPEN)
      sock.current.send(JSON.stringify({ watch: dir || "." }));
  }, [dir]);

  const open = async (e: Entry) => {
    if (e.kind === "dir") {
      setPath([...path, e.name]);
      return;
    }
    setPicked(e);
    setText(null);
    setDirty(false);
    if (isText(e)) {
      const res = await fetch(readHref(at(e.name)));
      setText(res.ok ? await res.text() : "");
    }
  };

  const save = async () => {
    if (!picked || text === null) return;
    setSaving(true);
    const res = await fetch(
      `/computer/files/write?path=${encodeURIComponent(at(picked.name))}`,
      { method: "PUT", body: text },
    );
    setSaving(false);
    if (res.ok) {
      setDirty(false);
      void load();
    }
  };

  // Sends one file to the machine's door in pieces. A piece that fails is
  // not retried blindly: the door is asked how far it got, and the next
  // piece starts there.
  const upload = async (file: File) => {
    const key = at(file.name);
    const mark = (u: Partial<Upload>) =>
      setUploads((was) => {
        const so_far = was[key] ?? { done: 0, total: file.size };
        return { ...was, [key]: { ...so_far, ...u } };
      });
    mark({});
    try {
      const target = await fetch("/computer/files/upload", { method: "POST" });
      if (!target.ok) throw new Error(await target.text());
      const { door, ticket } = (await target.json()) as {
        door: string;
        ticket: string;
      };
      const head = { "x-maslow-ticket": ticket };
      const where = `${door}/upload?path=${encodeURIComponent(key)}`;
      const have = async () =>
        (
          (await (await fetch(where, { headers: head })).json()) as {
            have: number;
          }
        ).have;
      let done = await have();
      let stumbles = 0;
      while (done < file.size) {
        try {
          const res = await fetch(
            `${where}&offset=${done}&total=${file.size}`,
            {
              method: "PUT",
              headers: { ...head, "content-type": "application/octet-stream" },
              body: file.slice(done, Math.min(done + PIECE, file.size)),
            },
          );
          if (res.status === 409) {
            done = ((await res.json()) as { have: number }).have;
          } else if (res.status === 201) {
            done = file.size;
          } else if (res.ok) {
            done = ((await res.json()) as { have: number }).have;
          } else throw new Error(await res.text());
          stumbles = 0;
        } catch (err) {
          if (++stumbles > 20) throw err;
          await new Promise((r) => setTimeout(r, 1500));
          done = await have().catch(() => done);
        }
        mark({ done });
      }
      setUploads((was) => {
        const { [key]: _gone, ...rest } = was;
        return rest;
      });
      void load();
    } catch (err) {
      mark({ error: (err as Error).message });
    }
  };

  const take = (list: FileList | null) => {
    if (!list) return;
    for (const f of Array.from(list)) void upload(f);
  };

  const crumbs = path.map((name, i) => ({
    name,
    to: path.slice(0, i + 1),
  }));
  const shown = entries?.filter((e) => dotfiles || !e.name.startsWith("."));

  return (
    <div
      className="@container relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files);
      }}
    >
      {/* On a narrow screen the bar keeps clear of you in the corner. */}
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3 max-sm:pr-14">
        <Breadcrumb className="min-w-0 flex-1">
          <BreadcrumbList className="flex-nowrap overflow-hidden">
            <BreadcrumbItem>
              {path.length === 0 ? (
                <BreadcrumbPage>Home</BreadcrumbPage>
              ) : (
                <BreadcrumbLink
                  render={<button type="button" onClick={() => setPath([])} />}
                >
                  Home
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {crumbs.map((c, i) => (
              <Fragment key={c.to.join("/")}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {i === crumbs.length - 1 ? (
                    <BreadcrumbPage className="truncate">
                      {c.name}
                    </BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink
                      render={
                        <button type="button" onClick={() => setPath(c.to)} />
                      }
                    >
                      {c.name}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            ))}
          </BreadcrumbList>
        </Breadcrumb>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            take(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() => input.current?.click()}
        >
          <ArrowUpTrayIcon /> Upload
        </Button>
      </div>

      {Object.keys(uploads).length > 0 && (
        <div className="space-y-2 border-b px-3 py-2">
          {Object.entries(uploads).map(([key, u]) => (
            <div key={key} className="space-y-1">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {key.split("/").pop()}
                </span>
                <span className="text-muted-foreground shrink-0 tabular-nums">
                  {u.error
                    ? "could not be sent"
                    : `${size(u.done)} of ${size(u.total)}`}
                </span>
              </div>
              <Progress
                value={(u.done / Math.max(1, u.total)) * 100}
                className={u.error ? "opacity-50" : ""}
              />
              {u.error && <p className="text-destructive text-xs">{u.error}</p>}
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col @md:flex-row">
        <ContextMenu>
          <ContextMenuTrigger
            className={`flex min-h-0 flex-col ${picked ? "@md:w-2/5 @md:border-r max-h-[40%] @md:max-h-none flex-none @md:flex-1 border-b @md:border-b-0" : "flex-1"}`}
          >
            <ScrollArea className="min-h-0 flex-1">
              {shown === undefined ? (
                <p className="text-muted-foreground px-3 py-3 text-sm">
                  Reading…
                </p>
              ) : failed ? (
                <p className="text-destructive px-3 py-3 text-sm">{failed}</p>
              ) : shown.length === 0 ? (
                <Empty className="py-10">
                  <EmptyHeader>
                    <EmptyTitle>
                      {entries?.length
                        ? "Only hidden files"
                        : "Nothing here yet"}
                    </EmptyTitle>
                    <EmptyDescription>
                      {entries?.length
                        ? "Right-click to show them."
                        : "Drop a file on this window."}
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ul className="p-1">
                  {shown.map((e) => {
                    const Mark =
                      e.kind === "dir"
                        ? FolderIcon
                        : isImage(e)
                          ? PhotoIcon
                          : isVideo(e)
                            ? VideoCameraIcon
                            : isText(e)
                              ? DocumentTextIcon
                              : DocumentIcon;
                    return (
                      <li key={e.name}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => open(e)}
                          aria-current={
                            picked?.name === e.name ? "true" : undefined
                          }
                          className={`h-8 w-full justify-start gap-2 rounded-md px-2 font-normal ${
                            picked?.name === e.name ? "bg-accent" : ""
                          }`}
                        >
                          <Mark
                            className={`size-4 shrink-0 ${
                              e.kind === "dir"
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }`}
                          />
                          <span className="min-w-0 flex-1 truncate text-left">
                            {e.name}
                          </span>
                          {e.kind !== "dir" && (
                            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                              {size(e.size)}
                            </span>
                          )}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuCheckboxItem
              checked={dotfiles}
              onCheckedChange={(on) => setDotfiles(on)}
            >
              Show hidden files
            </ContextMenuCheckboxItem>
          </ContextMenuContent>
        </ContextMenu>

        {picked && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-sm">
              <span className="min-w-0 flex-1 truncate font-medium">
                {picked.name}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {size(picked.size)}
              </span>
              {isText(picked) && (
                <Button
                  size="sm"
                  variant={dirty ? "default" : "outline"}
                  disabled={!dirty || saving}
                  onClick={save}
                >
                  {saving ? "Saving…" : "Save"}
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                nativeButton={false}
                render={
                  <a
                    href={readHref(at(picked.name))}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                Open
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              {isVideo(picked) ? (
                <div className="grid h-full place-items-center bg-black">
                  {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                  <video
                    key={picked.name}
                    controls
                    playsInline
                    preload="metadata"
                    poster={previewHref(at(picked.name), picked.modified)}
                    src={readHref(at(picked.name))}
                    className="h-full w-full object-contain"
                  />
                </div>
              ) : isImage(picked) || isPdf(picked) || isDocument(picked) ? (
                <div className="grid h-full place-items-center overflow-auto p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={picked.name}
                    src={
                      pictured(picked)
                        ? previewHref(at(picked.name), picked.modified)
                        : readHref(at(picked.name))
                    }
                    alt={picked.name}
                    className="max-h-full max-w-full rounded-md object-contain"
                  />
                </div>
              ) : isText(picked) ? (
                text === null ? (
                  <p className="text-muted-foreground px-3 py-3 text-sm">
                    Reading…
                  </p>
                ) : (
                  <Editor
                    name={picked.name}
                    value={text}
                    onChange={(next) => {
                      setText(next);
                      setDirty(true);
                    }}
                  />
                )
              ) : (
                <Empty className="h-full">
                  <EmptyHeader>
                    <EmptyTitle>{picked.name}</EmptyTitle>
                    <EmptyDescription>
                      {size(picked.size)}. Open it to download.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </div>
        )}
      </div>

      {dragging && (
        <div className="border-primary/60 bg-background/80 text-muted-foreground pointer-events-none absolute inset-2 grid place-items-center rounded-lg border-2 border-dashed text-sm">
          Drop to put it here
        </div>
      )}
    </div>
  );
}
