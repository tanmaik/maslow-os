"use client";

import {
  RiFileLine,
  RiFileTextLine,
  RiImageLine,
  RiPlugLine,
  RiSettings3Line,
  RiVideoLine,
} from "@remixicon/react";
import { useEffect, useRef, useState } from "react";

import { TypeIcon } from "@/app/brain/type-icon";
import { APPS, portItem } from "@/app/desktop/apps";
import type { Dragged, Port } from "@/app/desktop/tiles";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

// The panes of Settings the bar can open straight to.
const PANES: { id: string; title: string }[] = [
  { id: "you", title: "You" },
  { id: "look", title: "Look" },
  { id: "computer", title: "Computer" },
  { id: "apps", title: "Apps" },
  { id: "access", title: "Access" },
  { id: "org", title: "Org" },
  { id: "members", title: "Members" },
  { id: "groups", title: "Groups" },
];

type Found = { id: string; title: string; type: string; opening: string };
// A file the door found, by name: where it is, split for the row.
type FileHit = { path: string; name: string; folder: string };

// The kinds of file a mark tells apart, by ending; anything else is the
// plain mark.
const IMAGES = new Set([
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
const VIDEOS = new Set(["mp4", "m4v", "mov", "webm", "mkv"]);
const TEXTS = new Set([
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
  "csv",
  "log",
]);
const markFor = (name: string) => {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return IMAGES.has(ext)
    ? RiImageLine
    : VIDEOS.has(ext)
      ? RiVideoLine
      : TEXTS.has(ext)
        ? RiFileTextLine
        : RiFileLine;
};

// The command bar: one field over the screen, opened with a key, that finds
// an app, a pane of Settings, a record or a file by its words and takes
// the person there. The keys do everything: the arrows
// move, Return goes, Escape leaves.
export function CommandBar({
  open,
  initial,
  onOpenChange,
  ports,
  onApp,
  onNewApp,
  onPane,
  onRecord,
  onFile,
}: {
  open: boolean;
  // What was typed to open it, so the first key is not lost.
  initial: string;
  onOpenChange: (open: boolean) => void;
  ports: Port[];
  // One of Maslow's own apps.
  onApp: (b: Dragged) => void;
  // An app of the person's own, or one a colleague opened to them.
  onNewApp: (b: Dragged) => void;
  onPane: (id: string) => void;
  onRecord: (id: string, title: string) => void;
  onFile: (path: string, name: string) => void;
}) {
  const [q, setQ] = useState(initial);
  const [lit, setLit] = useState("");
  const [records, setRecords] = useState<Found[]>([]);
  const [files, setFiles] = useState<FileHit[]>([]);
  // Which of the two searches did not answer, so an empty list is never
  // read as an answer it never gave.
  const [broke, setBroke] = useState<{ brain: boolean; disk: boolean }>({
    brain: false,
    disk: false,
  });
  useEffect(() => {
    if (open) setQ(initial);
  }, [open, initial]);
  // The machine's own door and ticket, asked for once and kept: the same
  // pair a live socket opens with, since a search is one more thing said
  // straight to the machine.
  const door = useRef<{ base: string; ticket: string } | null>(null);
  const doorInfo = async () => {
    if (door.current) return door.current;
    const r = await fetch("/computer/live", { cache: "no-store" });
    if (!r.ok) return null;
    const { door: at, ticket } = (await r.json()) as {
      door: string;
      ticket: string;
    };
    const got = { base: at.replace(/^wss:/, "https:"), ticket };
    door.current = got;
    return got;
  };
  // The files a search found, or null when the computer did not answer:
  // a search that broke and a search that found nothing are not the same
  // thing to a person.
  const findOnDisk = async (words: string): Promise<FileHit[] | null> => {
    const d = await doorInfo();
    if (!d) return null;
    try {
      const r = await fetch(
        `${d.base}/maslow/find?q=${encodeURIComponent(words)}&ticket=${d.ticket}`,
      );
      if (!r.ok) {
        if (r.status === 401) door.current = null;
        return null;
      }
      const paths = (await r.json()) as string[];
      return paths.map((p) => {
        const at = p.lastIndexOf("/");
        return {
          path: p,
          name: at < 0 ? p : p.slice(at + 1),
          folder: at < 0 ? "" : p.slice(0, at),
        };
      });
    } catch {
      return null;
    }
  };
  // Records and files are asked for a beat after the typing stops, once
  // there is enough of a word to ask with; a slow answer that lands after
  // a newer one is thrown away.
  const seq = useRef(0);
  useEffect(() => {
    const words = q.trim();
    if (words.length < 2) {
      setRecords([]);
      setFiles([]);
      setBroke({ brain: false, disk: false });
      return;
    }
    const mine = ++seq.current;
    const said = (which: "brain" | "disk", failed: boolean) =>
      seq.current === mine && setBroke((was) => ({ ...was, [which]: failed }));
    const t = setTimeout(() => {
      void fetch(`/brain/find?q=${encodeURIComponent(words)}`)
        .then((r) => (r.ok ? (r.json() as Promise<Found[]>) : null))
        .then((got) => {
          if (seq.current !== mine) return;
          setRecords(got ?? []);
          said("brain", got === null);
        })
        .catch(() => {
          if (seq.current !== mine) return;
          setRecords([]);
          said("brain", true);
        });
      void findOnDisk(words).then((got) => {
        if (seq.current !== mine) return;
        setFiles(got ?? []);
        said("disk", got === null);
      });
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  const go = (act: () => void) => {
    onOpenChange(false);
    act();
  };
  const typed = q.trim().length > 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Find"
      description="An app, a window, a port, a pane of Settings, a record or a file."
      // A key opens this many times a day, so it is simply there: no
      // entrance and no exit to sit through.
      plain
      // On a phone it is full width, clear of the menu bar and the safe
      // area either side.
      className="max-sm:top-[calc(25px+env(safe-area-inset-top)+8px)] max-sm:left-[calc(8px+env(safe-area-inset-left))] max-sm:right-[calc(8px+env(safe-area-inset-right))] max-sm:w-auto max-sm:max-w-none max-sm:translate-x-0"
    >
      <Command value={lit} onValueChange={setLit}>
        <CommandInput
          autoFocus
          value={q}
          onValueChange={setQ}
          placeholder="Search your database, files, apps and settings"
        />
        <CommandList>
          <CommandEmpty>Nothing matches</CommandEmpty>
          {(broke.brain || broke.disk) && (
            <p className="text-xs text-muted-foreground px-3 py-2">
              {broke.brain && broke.disk
                ? "Your database and your computer did not answer, so nothing of either is here."
                : broke.brain
                  ? "Your database did not answer, so no records are here."
                  : "Your computer did not answer, so no files are here."}
            </p>
          )}
          <CommandGroup heading="Apps">
            {APPS.map(({ mark: Mark, ...b }) => (
              <CommandItem
                key={b.href}
                value={`app ${b.title}`}
                onSelect={() => go(() => onApp(b))}
              >
                <Mark aria-hidden />
                {b.title}
              </CommandItem>
            ))}
          </CommandGroup>
          {ports.length > 0 && (
            <CommandGroup heading="Your apps">
              {ports.map((p) => (
                <CommandItem
                  key={p.href}
                  value={`port ${p.title}`}
                  onSelect={() => go(() => onNewApp(portItem(p)))}
                >
                  <RiPlugLine aria-hidden />
                  {p.title}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {typed && (
            <CommandGroup heading="Settings">
              {PANES.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`settings ${p.title}`}
                  onSelect={() => go(() => onPane(p.id))}
                >
                  <RiSettings3Line aria-hidden />
                  {p.title}
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {records.length > 0 && (
            <CommandGroup heading="Records">
              {records.map((r) => (
                <CommandItem
                  key={r.id}
                  value={`record ${r.title} ${r.id}`}
                  onSelect={() => go(() => onRecord(r.id, r.title))}
                >
                  <TypeIcon type={r.type} />
                  <span className="truncate">{r.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {r.opening}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {files.length > 0 && (
            <CommandGroup heading="Files">
              {files.map((f) => {
                const Mark = markFor(f.name);
                return (
                  <CommandItem
                    key={f.path}
                    value={`file ${f.name} ${f.path}`}
                    onSelect={() => go(() => onFile(f.path, f.name))}
                  >
                    <Mark aria-hidden />
                    <span className="truncate">{f.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {f.folder || "Home"}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
