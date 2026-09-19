"use client";

import {
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCloseLine,
  RiFileLine,
  RiFileTextLine,
  RiFolderLine,
  RiGroupLine,
  RiHomeLine,
  RiImageLine,
  RiLinkM,
  RiSearchLine,
  RiShareForwardLine,
  RiSideBarLine,
  RiUploadLine,
  RiVideoLine,
} from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Selection, SortDescriptor } from "react-aria-components";

import {
  type Entry,
  type Shared,
  ending,
  isImage,
  isText,
  isVideo,
  shareLink,
  sharedHref,
  size,
} from "@/app/computer/files/kinds";
import { putShared } from "@/app/computer/files/shared-upload";
import {
  ShareSheet,
  type Parties,
  type Reach,
} from "@/app/computer/share-sheet";
import { BarButton, InBar, useFolded } from "@/app/desktop/panel";
import {
  Breadcrumb,
  BreadcrumbItem,
} from "@/components/base/breadcrumb/breadcrumb";
import { Button } from "@/components/base/buttons/button";
import { CloseButton } from "@/components/base/buttons/close-button";
import { InputBase } from "@/components/base/input/input";
import { Pagination } from "@/components/base/pagination/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@/components/base/table/table";
import { ChevronSortDown } from "@/components/foundations/icons/chevrons";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { BASE, FAST, LEAVE } from "@/lib/motion";
import { liveSocket } from "@/lib/live";
import { cx } from "@/utils/cx";
import { usePhone } from "@/hooks/use-phone";

// Where the device keeps whether the folders rail is shown, and what the
// person dropped on it to keep there.
const RAIL = "files-rail";
const PINS = "files-pins";
// One of the person's own things, carried by a drag.
const CARRIED = "application/x-maslow-entry";
type Pin = { path: string; kind: "dir" | "file" };

// An upload in flight: how far it has got, and what stopped it if anything.
type Upload = { done: number; total: number; error?: string };

// What colleagues shared with the person, by whom.
type Colleague = { owner: string; ownerId: string; files: Shared[] };

// What the sheet on a file or folder of the person's own needs: who it
// can be given to, and everything they have shared with who each reaches.
type Sharing = Parties & {
  files: { id: string; name: string; kind: "file" | "dir" }[];
  shares: {
    fileId: string;
    subject: "everyone" | "group" | "member";
    memberId: string | null;
    groupId: string | null;
    level: "view" | "edit";
  }[];
};

// What one shared thing reaches, as the sheet takes it.
const reachOf = (sharing: Sharing | null, id: string | undefined): Reach => {
  const on = id ? (sharing?.shares.filter((s) => s.fileId === id) ?? []) : [];
  return {
    public: false,
    everyone: on.some((s) => s.subject === "everyone"),
    groupIds: on.flatMap((s) => (s.groupId ? [s.groupId] : [])),
    memberIds: on.flatMap((s) => (s.memberId ? [s.memberId] : [])),
    level: on.some((s) => s.level === "edit") ? "edit" : "view",
  };
};

// A file goes up in pieces this big, so a dropped connection loses at most
// one piece and picks up from the last the door kept.
const PIECE = 8 * 1024 * 1024;

// How many rows a page of a folder holds, so a folder of thousands still
// draws at once.
const PER_PAGE = 100;

// The mark a thing wears in the list.
const markOf = (e: Entry) =>
  e.kind === "dir"
    ? RiFolderLine
    : e.kind === "link"
      ? RiLinkM
      : isImage(e)
        ? RiImageLine
        : isVideo(e)
          ? RiVideoLine
          : isText(e)
            ? RiFileTextLine
            : RiFileLine;

// What a thing is, as the Kind column says it: a folder, a link, or a
// file named by its ending.
const KINDS: Record<string, string> = {
  md: "Markdown",
  txt: "Text",
  sh: "Shell script",
  json: "JSON",
  yml: "YAML",
  yaml: "YAML",
  toml: "TOML",
  csv: "CSV",
  log: "Log",
  png: "PNG image",
  jpg: "JPEG image",
  jpeg: "JPEG image",
  gif: "GIF image",
  svg: "SVG image",
  webp: "WebP image",
  heic: "HEIC image",
  pdf: "PDF",
  docx: "Word document",
  xlsx: "Excel workbook",
  pptx: "PowerPoint",
  zip: "ZIP archive",
  tar: "Archive",
  gz: "Archive",
  mp4: "Video",
  mov: "Video",
  webm: "Video",
  mp3: "Audio",
  m4a: "Audio",
  wav: "Audio",
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  mjs: "JavaScript",
  py: "Python",
  html: "HTML",
  css: "CSS",
};
const kindOf = (e: Entry) => {
  if (e.kind === "dir") return "Folder";
  if (e.kind === "link") return "Link";
  const end = ending(e.name);
  if (!end) return "File";
  return KINDS[end] ?? `${end.toUpperCase()} file`;
};

// A moment as a short date, or the time if it is today.
const when = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

// One piece of a file, sent with the bytes it has written reported as they
// go, so the bar moves before the piece lands.
const sendPiece = (
  url: string,
  headers: Record<string, string>,
  body: Blob,
  sent: (bytes: number) => void,
) =>
  new Promise<{ ok: boolean; status: number; body: string }>(
    (resolve, reject) => {
      const call = new XMLHttpRequest();
      call.open("PUT", url);
      for (const [name, value] of Object.entries(headers))
        call.setRequestHeader(name, value);
      call.upload.onprogress = (e) => sent(e.loaded);
      call.onload = () =>
        resolve({
          ok: call.status >= 200 && call.status < 300,
          status: call.status,
          body: call.responseText,
        });
      call.onerror = () => reject(new Error("The connection dropped."));
      call.onabort = () => reject(new Error("The connection dropped."));
      call.send(body);
    },
  );

// The columns a folder is listed in; any of them sorts it. As the list
// narrows, Size and Kind go before Changed, and what goes moves under
// the name.
type Column = "name" | "size" | "kind" | "modified";

const NARROW = {
  size: "@max-[520px]/list:hidden",
  kind: "@max-[520px]/list:hidden",
  modified: "@max-[400px]/list:hidden",
};

const COLUMNS: { id: Column; label: string; className: string }[] = [
  { id: "name", label: "Name", className: "" },
  { id: "size", label: "Size", className: `w-20 text-right ${NARROW.size}` },
  { id: "kind", label: "Kind", className: `w-28 ${NARROW.kind}` },
  {
    id: "modified",
    label: "Changed",
    className: `w-32 text-right ${NARROW.modified}`,
  },
];

// The header's sort mark: down for descending, turned over for ascending,
// and drawn only on the column the list is sorted by.
function SortMark({ dir }: { dir?: "ascending" | "descending" }) {
  if (!dir) return null;
  return (
    <ChevronSortDown
      className={cx(
        // The glyph is small inside its box; the box is kept off the
        // line so a sorted heading is exactly as tall as a row.
        "-my-[3px] size-6 shrink-0 text-text-secondary transition-transform duration-instant ease-out-quart motion-reduce:transition-none",
        dir === "ascending" && "rotate-180",
      )}
    />
  );
}

// The person's files on their own computer. A folder's contents, folders
// first; a look at a file beside them, or beneath them when the window is
// narrow; a small edit saved back; and a file dropped anywhere on the
// window, sent straight to the machine in pieces, carrying on from where
// it stopped if the connection drops.
// The bar of a Files window: where you are, then what you can do here.
// Folded onto a phone, the path keeps the strip under the bar and the
// rest becomes rows in the sheet.
function Toolbar({
  folded,
  where,
  children,
}: {
  folded: boolean;
  where: ReactNode;
  children: ReactNode;
}) {
  const row = (controls: ReactNode) => (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-separator-border px-3">
      {controls}
    </div>
  );
  if (!folded)
    return (
      <InBar as={row} name={false}>
        {where}
        {children}
      </InBar>
    );
  return (
    <>
      <InBar phone="strip" as={row} name={false}>
        {where}
      </InBar>
      <InBar as={row}>{children}</InBar>
    </>
  );
}

// One place in the rail: home, or a folder at the top of it. The mark is a
// choice, not a hover, so it lands the moment it is made.
function Place({
  mark: Mark,
  on,
  onClick,
  onRemove,
  children,
}: {
  mark: typeof RiFolderLine;
  on: boolean;
  onClick: () => void;
  // For a place the person put here: the way to take it off again.
  onRemove?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={on ? "true" : undefined}
      onClick={onClick}
      className={cx(
        "group/place flex h-11 w-full shrink-0 cursor-pointer items-center gap-2 overflow-hidden rounded-lg px-2 text-left outline-none sm:h-7",
        "focus-visible:ring-2 focus-visible:ring-border-focus-ring",
        on
          ? "bg-background-tertiary-default"
          : "transition-colors duration-fast ease-plain hover:bg-background-secondary-hover active:bg-background-tertiary-default",
      )}
    >
      <Mark className="size-4 shrink-0 text-accent-500" aria-hidden />
      <span className="truncate text-body-regular text-text-primary">
        {children}
      </span>
      {onRemove && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Take off the sidebar"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onRemove();
            }
          }}
          className="ml-auto flex size-5 shrink-0 items-center justify-center rounded-md text-foreground-icon-tertiary opacity-0 transition-opacity duration-instant ease-plain group-hover/place:opacity-100 hover:bg-background-tertiary-hover focus-visible:opacity-100"
        >
          <RiCloseLine className="size-3.5" aria-hidden />
        </span>
      )}
    </button>
  );
}

// The name over a group of the rail's rows.
function Section({ children }: { children: ReactNode }) {
  return (
    <p className="mt-3 px-2 pb-1 text-caption-1-medium text-text-tertiary first:mt-0">
      {children}
    </p>
  );
}

export function FileExplorer({
  initialPath,
  initialShare,
  href,
  standalone = false,
}: {
  initialPath?: string;
  // A folder a colleague shared, by its id, opened as its link is.
  initialShare?: string;
  href?: string;
  // On a page of its own, with no desktop to ask, a file opens in a tab.
  standalone?: boolean;
  fresh?: boolean;
} = {}) {
  const folded = useFolded();
  // The folder asked for: by the page's address, or by the window's on the
  // desktop.
  const params = href ? new URL(href, "http://x").searchParams : null;
  const asked = (initialPath ?? params?.get("path") ?? "")
    .split("/")
    .filter(Boolean);
  const askedShare = initialShare ?? params?.get("share") ?? null;
  const [path, setPath] = useState<string[]>(
    askedShare ? asked : asked.slice(0, -1),
  );
  // Whose things are in view: the person's own home, a colleague's list
  // of what they shared, or a folder a colleague shared and a path under
  // it.
  const [colleague, setColleague] = useState<Colleague | null>(null);
  const [share, setShare] = useState<Shared | null>(null);
  const [shared, setShared] = useState<Colleague[]>([]);
  // The row last right-clicked, the thing whose sheet is open, and what
  // the sheet needs.
  const [target, setTarget] = useState<Entry | null>(null);
  const [sharingEntry, setSharingEntry] = useState<Entry | null>(null);
  const [sharing, setSharing] = useState<Sharing | null>(null);
  // A file asked for by name, opened once its folder has loaded.
  const opening = useRef<string | null>(
    askedShare ? null : (asked.at(-1) ?? null),
  );
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // A text file too big to take into the tab: shown as a file, not read.
  // What the door said when it would not take a save.
  const [uploads, setUploads] = useState<Record<string, Upload>>({});
  const [dragging, setDragging] = useState(false);
  // Files whose names start with a dot are the machine's own business
  // until asked for.
  const [dotfiles, setDotfiles] = useState(false);
  // A word typed narrows the list to the names that carry it.
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<SortDescriptor>({
    column: "name",
    direction: "ascending",
  });
  // The rows taken hold of: one by a press, more with the shift or the
  // command key, all with command-A, none again with Escape.
  const [selected, setSelected] = useState<Selection>(new Set());
  // The row whose name is a field, and what the field says.
  const [renaming, setRenaming] = useState<{ of: string; to: string } | null>(
    null,
  );
  // A rename ends once, whether by Return, by a click elsewhere or by both.
  const renamed = useRef(false);
  // Where the person has been in their home, so the bar's arrows go back
  // and forward through it as a browser's do. A step taken by the arrows
  // is not written down again.
  const [trail, setTrail] = useState<{ list: string[][]; at: number }>({
    list: [path],
    at: 0,
  });
  const stepping = useRef(false);
  useEffect(() => {
    if (stepping.current) {
      stepping.current = false;
      return;
    }
    setTrail((t) => {
      const here = t.list[t.at];
      if (here && here.join("/") === path.join("/")) return t;
      const list = [...t.list.slice(0, t.at + 1), path];
      return { list, at: list.length - 1 };
    });
  }, [path]);
  const step = (by: -1 | 1) => {
    const to = trail.list[trail.at + by];
    if (!to) return;
    stepping.current = true;
    setTrail({ ...trail, at: trail.at + by });
    leaving(() => {
      setColleague(null);
      setShare(null);
      setPath(to);
    });
  };
  // Whether the folders rail is shown, as the person last left it. On a
  // phone the rail has nowhere to stand beside the list, so it opens as a
  // sheet instead, and starts closed rather than remembered.
  const [rail, setRail] = useState(true);
  const [sheet, setSheet] = useState(false);
  const wide = !usePhone();
  // What the person dropped on the rail to keep there, and whether a
  // drag is over it now.
  const [pins, setPins] = useState<Pin[]>([]);
  const [over, setOver] = useState(false);
  const keep = (next: Pin[]) => {
    setPins(next);
    localStorage.setItem(PINS, JSON.stringify(next));
  };
  useEffect(() => {
    setRail(localStorage.getItem(RAIL) !== "hidden");
    try {
      setPins(JSON.parse(localStorage.getItem(PINS) ?? "[]") as Pin[]);
    } catch {
      setPins([]);
    }
  }, []);
  const toggleRail = () => {
    if (!wide) return setSheet((on) => !on);
    setRail((on) => {
      localStorage.setItem(RAIL, on ? "hidden" : "shown");
      return !on;
    });
  };
  const railShown = wide ? rail : sheet;
  const input = useRef<HTMLInputElement>(null);
  // The files an upload was given, so a failed one can be tried again.
  const sending = useRef<Record<string, File>>({});

  const dir = path.join("/");
  const at = (name: string) => (dir ? `${dir}/${name}` : name);

  // What is listed: the folder in the home, the folder under a colleague's
  // share, or what one colleague shared, as rows.
  const load = useCallback(async () => {
    setFailed(null);
    try {
      if (colleague && !share) {
        setEntries(
          colleague.files.map((f) => ({
            name: f.name,
            kind: f.kind,
            size: 0,
            modified: "",
            id: f.id,
          })),
        );
        return;
      }
      const res = await fetch(
        share
          ? sharedHref(share.id, "list", dir)
          : `/computer/files/list?path=${encodeURIComponent(dir || ".")}`,
      );
      if (!res.ok) throw new Error(await res.text());
      setEntries((await res.json()) as Entry[]);
    } catch (err) {
      setEntries([]);
      setFailed((err as Error).message);
    }
  }, [dir, share, colleague]);

  useEffect(() => {
    setEntries(null);
    setQuery("");
    setPage(1);
    setSelected(new Set());
    void load();
  }, [load]);

  // What colleagues shared, for the rail; read once, and again whenever
  // the window comes back into view, so a share that landed meanwhile is
  // there.
  const loadShared = useCallback(async () => {
    try {
      const res = await fetch("/computer/files/shared");
      if (res.ok) setShared((await res.json()) as Colleague[]);
    } catch {
      // The rail stays as it was.
    }
  }, []);
  useEffect(() => {
    void loadShared();
    const back = () => {
      if (document.visibilityState === "visible") void loadShared();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
  }, [loadShared]);
  // A colleague named by a linked folder alone is filled in from the rail
  // once that has been read, so their list is one crumb away.
  useEffect(() => {
    if (!colleague || colleague.files.length > 0) return;
    const found = shared.find((c) => c.ownerId === colleague.ownerId);
    if (found) setColleague(found);
  }, [shared, colleague]);

  // A shared folder opened by its link: what it is, then its top.
  useEffect(() => {
    if (!askedShare) return;
    let stopped = false;
    void fetch(sharedHref(askedShare, "stat", ""))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((s: Shared & { ownerId: string; shared: Shared }) => {
        if (stopped) return;
        setColleague({ owner: s.owner, ownerId: s.ownerId, files: [] });
        setShare({ ...s.shared, owner: s.owner, level: s.level });
      })
      .catch(() => !stopped && setFailed("That is not shared with you."));
    return () => {
      stopped = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedShare]);

  // The list follows the disk: the folder shown is watched through the
  // machine's door, and a change in it reads the list again a moment
  // later, once a burst of changes has settled.
  const sock = useRef<WebSocket | null>(null);
  const latest = useRef({
    dir,
    load,
    away: share !== null || colleague !== null,
  });
  latest.current = { dir, load, away: share !== null || colleague !== null };
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
          // A change in the home means nothing to a colleague's list.
          if (latest.current.away) return;
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
    if (share || colleague) return;
    if (sock.current?.readyState === WebSocket.OPEN)
      sock.current.send(JSON.stringify({ watch: dir || "." }));
  }, [dir, share, colleague]);

  // Nothing in Files holds an edit any more, so leaving is leaving.
  const leaving = (go: () => void) => go();

  // A file opens in the Preview window: the desktop is asked, and on a page
  // of its own the address is followed. A colleague's opens by the share
  // it came through.
  const openPath = (file: string, through?: Shared) => {
    const address = through
      ? `/computer/files/view?share=${encodeURIComponent(through.id)}&path=${encodeURIComponent(file)}`
      : `/computer/files/view?path=${encodeURIComponent(file)}`;
    if (standalone) window.open(address, "_blank");
    else
      window.postMessage(
        {
          maslow: "open",
          view: file,
          ...(through ? { share: { id: through.id, name: through.name } } : {}),
        },
        location.origin,
      );
  };
  const open = (e: Entry) =>
    leaving(() => {
      // One of a colleague's shared things: a folder to go into, or a
      // file to look at, each through its own share.
      if (colleague && !share) {
        const it = colleague.files.find((f) => f.id === e.id);
        if (!it) return;
        if (it.kind === "dir") {
          setShare(it);
          setPath([]);
        } else openPath("", it);
        return;
      }
      if (e.kind === "dir") {
        setPath([...path, e.name]);
        return;
      }
      openPath(at(e.name), share ?? undefined);
    });

  // Renaming, moving to the Trash and making a folder are the owner's:
  // in a colleague's share they are not offered.
  const mine = !colleague && !share;

  // The rows the selection names, as they are listed.
  const held = () => {
    const names =
      selected === "all" ? rows.map((r) => r.name) : [...selected].map(String);
    return names.flatMap((n) => rows.filter((r) => r.name === n));
  };

  // One action on the person's own files through the door, in JSON.
  const act = async <T,>(what: string, file: string, body?: unknown) => {
    const res = await fetch(
      `/computer/files/${what}?path=${encodeURIComponent(file)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body ?? {}),
      },
    );
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as T;
  };

  // The row's name becomes a field, prefilled, with the name and not the
  // extension selected.
  const startRename = (e: Entry) => {
    if (!mine) return;
    renamed.current = false;
    setSelected(new Set([e.name]));
    setRenaming({ of: e.name, to: e.name });
  };

  // The field's word becomes the row's name; the same word, or none,
  // changes nothing.
  const finishRename = async (keep: boolean) => {
    if (!renaming || renamed.current) return;
    renamed.current = true;
    setRenaming(null);
    const to = renaming.to.trim();
    if (!keep || !to || to === renaming.of) return;
    try {
      const made = await act<Entry>("rename", at(renaming.of), { to });
      await load();
      setSelected(new Set([made.name]));
    } catch (err) {
      setFailed((err as Error).message);
    }
  };

  // What is selected goes to the Trash of the person's Linux, each thing
  // on its own, so one refused leaves the rest moved.
  const toTrash = async () => {
    const going = held();
    if (!mine || going.length === 0) return;
    let refused: string | null = null;
    for (const e of going)
      await act("delete", at(e.name)).catch((err) => {
        refused ??= (err as Error).message;
      });
    await load();
    if (refused) setFailed(refused);
  };

  // A folder made in the one in view, named as the Finder names one, and
  // its name a field at once.
  const newFolder = async () => {
    if (!mine) return;
    try {
      const made = await act<Entry>("mkdir", dir || ".");
      await load();
      setQuery("");
      startRename(made);
    } catch (err) {
      setFailed((err as Error).message);
    }
  };

  // The file asked for by name, once its folder has answered.
  useEffect(() => {
    if (!entries || !opening.current) return;
    const found = entries.find((e) => e.name === opening.current);
    opening.current = null;
    if (found) open(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  // Sends one file to the machine's door in pieces. A piece that fails is
  // not retried blindly: the door is asked how far it got, and the next
  // piece starts there. A file dropped into a colleague's folder goes to
  // its copy, and onto their disk from there.
  const upload = async (file: File) => {
    const key = at(file.name);
    sending.current[key] = file;
    const mark = (u: Partial<Upload>) =>
      setUploads((was) => {
        const so_far = was[key] ?? { done: 0, total: file.size };
        return { ...was, [key]: { ...so_far, ...u, error: u.error } };
      });
    mark({});
    if (share) {
      try {
        await putShared(share.id, key, file, (done) => mark({ done }));
        forget(key);
        void load();
      } catch (err) {
        mark({ error: (err as Error).message });
      }
      return;
    }
    try {
      const target = await fetch("/computer/files/upload", { method: "POST" });
      if (!target.ok) throw new Error(await target.text());
      const { door, ticket } = (await target.json()) as {
        door: string;
        ticket: string;
      };
      const head = { "x-maslow-ticket": ticket };
      // The file is named to the door by its length and last change, so
      // a part left by an earlier upload of another file by this name is
      // never carried on from.
      const where = `${door}/upload?path=${encodeURIComponent(key)}&total=${file.size}&modified=${file.lastModified}`;
      const have = async () =>
        (
          (await (await fetch(where, { headers: head })).json()) as {
            have: number;
          }
        ).have;
      let done = await have();
      let stumbles = 0;
      // An empty file is one piece of nothing, sent so it exists.
      let sent = false;
      while (done < file.size || (file.size === 0 && !sent)) {
        try {
          const from = done;
          const res = await sendPiece(
            `${where}&offset=${done}&total=${file.size}`,
            { ...head, "content-type": "application/octet-stream" },
            file.slice(done, Math.min(done + PIECE, file.size)),
            (bytes) => mark({ done: Math.min(from + bytes, file.size) }),
          );
          if (res.status === 409) {
            done = (JSON.parse(res.body) as { have: number }).have;
          } else if (res.status === 201) {
            done = file.size;
            sent = true;
          } else if (res.ok) {
            done = (JSON.parse(res.body) as { have: number }).have;
            sent = true;
          } else throw new Error(res.body);
          stumbles = 0;
        } catch (err) {
          if (++stumbles > 20) throw err;
          await new Promise((r) => setTimeout(r, 1500));
          done = await have().catch(() => done);
        }
        mark({ done });
      }
      forget(key);
      void load();
    } catch (err) {
      mark({ error: (err as Error).message });
    }
  };

  const forget = (key: string) => {
    delete sending.current[key];
    setUploads((was) => {
      const { [key]: _gone, ...rest } = was;
      return rest;
    });
  };

  // Whether a file can be put here: the person's own home, or a
  // colleague's folder they may change.
  const takes = !colleague || (share !== null && share.level !== "view");
  const take = (list: FileList | null) => {
    if (!list || !takes) return;
    for (const f of Array.from(list)) void upload(f);
  };

  // Sets what one thing of the person's own reaches, and shows the mark
  // the moment it lands.
  const setReach = async (entry: Entry, to: Reach) => {
    const res = await fetch("/computer/files/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: at(entry.name),
        everyone: to.everyone,
        groups: to.groupIds,
        members: to.memberIds,
        level: to.level,
      }),
    });
    if (!res.ok) return (await res.text()) || "That was not saved.";
    void load();
    void loadSharing();
    return null;
  };
  const loadSharing = async () => {
    const res = await fetch("/computer/files/share");
    setSharing(res.ok ? ((await res.json()) as Sharing) : null);
    return res.ok;
  };
  const openSheet = async (entry: Entry) => {
    if (!(await loadSharing())) {
      setFailed("Your computer is not ready.");
      return;
    }
    setSharingEntry(entry);
  };

  // Folders first, then by the column the list is sorted on, narrowed to
  // the word typed and, unless asked, to what is not hidden.
  const word = query.trim().toLowerCase();
  const shown = entries
    ?.filter((e) => dotfiles || !e.name.startsWith("."))
    .filter((e) => !word || e.name.toLowerCase().includes(word))
    .sort((a, b) => {
      if ((a.kind === "dir") !== (b.kind === "dir"))
        return a.kind === "dir" ? -1 : 1;
      const flip = sort.direction === "descending" ? -1 : 1;
      if (sort.column === "size") return (a.size - b.size) * flip;
      if (sort.column === "kind")
        return kindOf(a).localeCompare(kindOf(b)) * flip;
      if (sort.column === "modified")
        return a.modified.localeCompare(b.modified) * flip;
      return a.name.localeCompare(b.name, undefined, { numeric: true }) * flip;
    });

  // A folder of thousands is read a hundred at a time, so the list is
  // drawn in one beat however much is in it.
  const pages = shown ? Math.max(1, Math.ceil(shown.length / PER_PAGE)) : 1;
  const here = Math.min(page, pages);
  const rows = shown?.slice((here - 1) * PER_PAGE, here * PER_PAGE) ?? [];

  return (
    <div
      className="@container relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDragging(true);
      }}
      onDragLeave={(e) => {
        // A drag crossing a row leaves the row, not the window: the
        // overlay only goes when the pointer has left for good.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        take(e.dataTransfer.files);
      }}
    >
      {/* The bar: where this is, a word to narrow the list, and the way
          to put a file here. On a phone the path stays in view, in a strip
          that scrolls sideways, and the rest folds into the sheet. */}
      <Toolbar
        folded={folded}
        where={
          <>
            {/* The rail is shown or hidden from the bar, where the terminal
                keeps the same control; on a phone it folds into the sheet
                the bar opens, as every other control does. */}
            <InBar leading as={(c) => <>{c}</>}>
              <BarButton
                icon={RiSideBarLine}
                label={railShown ? "Hide the folders" : "Show the folders"}
                pressed={railShown}
                onClick={toggleRail}
                className={cx(!railShown && "text-foreground-icon-tertiary")}
              />
              <BarButton
                icon={RiArrowLeftSLine}
                label="Back"
                disabled={trail.at === 0}
                onClick={() => step(-1)}
              />
              <BarButton
                icon={RiArrowRightSLine}
                label="Forward"
                disabled={trail.at >= trail.list.length - 1}
                onClick={() => step(1)}
              />
            </InBar>
            <Breadcrumb
              className={cx("min-w-0", folded ? "shrink-0" : "-mx-1 flex-1")}
            >
              <BreadcrumbItem
                onClick={
                  path.length === 0 && !share
                    ? undefined
                    : () =>
                        leaving(() => {
                          setShare(null);
                          setPath([]);
                        })
                }
                current={path.length === 0 && !share}
              >
                {colleague ? colleague.owner : "Home"}
              </BreadcrumbItem>
              {share && (
                <BreadcrumbItem
                  onClick={
                    path.length === 0
                      ? undefined
                      : () => leaving(() => setPath([]))
                  }
                  current={path.length === 0}
                  className="truncate"
                >
                  {share.name}
                </BreadcrumbItem>
              )}
              {path.map((name, i) =>
                i === path.length - 1 ? (
                  <BreadcrumbItem key={i} current className="truncate">
                    {name}
                  </BreadcrumbItem>
                ) : (
                  <BreadcrumbItem
                    key={i}
                    onClick={() => leaving(() => setPath(path.slice(0, i + 1)))}
                  >
                    {name}
                  </BreadcrumbItem>
                ),
              )}
            </Breadcrumb>
          </>
        }
      >
        <InputBase
          aria-label="Search this folder"
          placeholder="Search"
          size="small"
          leadingIcon={RiSearchLine}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          // A faint ring at rest, so the field reads as one before a hand
          // reaches it; hover and focus keep their own.
          fieldClassName={cx(
            "h-6 not-data-hovered:not-data-focus-within:ring-border-button-default",
            folded ? "w-full" : "w-36 shrink-0",
          )}
        />
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
        {takes && (
          <BarButton
            icon={RiUploadLine}
            label="Upload"
            title="Upload a file, or drop one anywhere here"
            onClick={() => input.current?.click()}
          />
        )}
      </Toolbar>

      {Object.keys(uploads).length > 0 && (
        <div
          aria-live="polite"
          className="space-y-2 border-b border-separator-border px-3 py-2"
        >
          <AnimatePresence initial={false}>
            {Object.entries(uploads).map(([key, u]) => {
              const name = key.split("/").pop() ?? key;
              const part = Math.round((u.done / Math.max(1, u.total)) * 100);
              return (
                <motion.div
                  key={key}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, transition: LEAVE }}
                  transition={BASE}
                  className="space-y-1"
                >
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-body-2-medium text-text-primary">
                      {name}
                    </span>
                    <span className="shrink-0 text-caption-1-medium text-text-secondary tabular-nums">
                      {u.error
                        ? "Could not be sent."
                        : `${size(u.done)} of ${size(u.total)}`}
                    </span>
                  </div>
                  <Progress
                    aria-label={`Sending ${name}`}
                    value={part}
                    getAriaValueText={() =>
                      `${size(u.done)} of ${size(u.total)}`
                    }
                    className={cx(u.error && "opacity-50")}
                  />
                  {u.error && (
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-caption-1-regular text-text-error-primary">
                        {u.error}
                      </p>
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => {
                          const again = sending.current[key];
                          if (again) void upload(again);
                        }}
                      >
                        Try again
                      </Button>
                      <CloseButton
                        size="xs"
                        aria-label={`Close ${name}`}
                        onClick={() => forget(key)}
                      />
                    </div>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col bg-background-full @md:flex-row">
        {/* Home and what the person put beside it, so any folder is one
            press from any other: down the side on a wide window, where the
            list has room to stand beside it; from a sheet on a phone,
            where it would otherwise cost the list its height. */}
        {(() => {
          const places = (
            <>
              <Section>Favorites</Section>
              <Place
                mark={RiHomeLine}
                on={path.length === 0 && !colleague}
                onClick={() =>
                  leaving(() => {
                    setColleague(null);
                    setShare(null);
                    setPath([]);
                    if (!wide) setSheet(false);
                  })
                }
              >
                Home
              </Place>
              {pins.map((pin) => (
                <Place
                  key={pin.path}
                  mark={pin.kind === "dir" ? RiFolderLine : RiFileLine}
                  on={pin.kind === "dir" && path.join("/") === pin.path}
                  onClick={() =>
                    leaving(() => {
                      if (pin.kind === "dir")
                        setPath(pin.path.split("/").filter(Boolean));
                      else openPath(pin.path);
                      if (!wide) setSheet(false);
                    })
                  }
                  onRemove={() => keep(pins.filter((x) => x.path !== pin.path))}
                >
                  {pin.path.split("/").filter(Boolean).at(-1) ?? pin.path}
                </Place>
              ))}
              {/* What colleagues shared, one row each, holding what they
                  shared and nothing of the rest of their home. */}
              {shared.length > 0 && <Section>Shared</Section>}
              {shared.map((c) => (
                <Place
                  key={c.ownerId}
                  mark={RiGroupLine}
                  on={colleague?.ownerId === c.ownerId}
                  onClick={() =>
                    leaving(() => {
                      setColleague(c);
                      setShare(null);
                      setPath([]);
                      if (!wide) setSheet(false);
                    })
                  }
                >
                  {c.owner}
                </Place>
              ))}
            </>
          );
          // A folder or file of theirs dragged here is kept here.
          const takes = {
            onDragOver: (e: DragEvent<HTMLElement>) => {
              if (!e.dataTransfer.types.includes(CARRIED)) return;
              e.preventDefault();
              e.stopPropagation();
              setOver(true);
            },
            onDragLeave: () => setOver(false),
            onDrop: (e: DragEvent<HTMLElement>) => {
              setOver(false);
              const got = e.dataTransfer.getData(CARRIED);
              if (!got) return;
              e.preventDefault();
              e.stopPropagation();
              const pin = JSON.parse(got) as Pin;
              if (!pins.some((x) => x.path === pin.path)) keep([...pins, pin]);
            },
          };
          return wide ? (
            rail && (
              <nav
                aria-label="Folders"
                {...takes}
                className={cx(
                  "flex w-52 shrink-0 flex-col gap-px overflow-y-auto border-r border-separator-border bg-background-secondary-default/55 p-2.5 transition-colors duration-fast ease-plain",
                  over && "bg-accent-50",
                )}
              >
                {places}
              </nav>
            )
          ) : (
            <Sheet open={sheet} onOpenChange={setSheet}>
              <SheetContent
                side="bottom"
                className="max-h-[70dvh] gap-2 rounded-t-3xl p-3"
              >
                <SheetTitle className="sr-only">Folders</SheetTitle>
                <nav
                  aria-label="Folders"
                  className="flex flex-col gap-px overflow-y-auto"
                >
                  {places}
                </nav>
              </SheetContent>
            </Sheet>
          );
        })()}
        <ContextMenu>
          <ContextMenuTrigger
            className={cx("@container/list flex min-h-0 flex-col", "flex-1")}
            onContextMenu={(e) => {
              // A right-click on the space between rows is about the
              // folder, not a row.
              if (!(e.target as HTMLElement).closest("tr")) setTarget(null);
            }}
            onKeyDownCapture={(e) => {
              // Return with one row held renames it, before the list can
              // take it as an open; opening stays a double-click.
              if ((e.target as HTMLElement).closest("input, textarea")) return;
              if (e.key !== "Enter" || e.metaKey || e.ctrlKey || e.altKey)
                return;
              const one = held();
              if (!mine || one.length !== 1) return;
              e.preventDefault();
              e.stopPropagation();
              startRename(one[0]);
            }}
            onKeyDown={(e) => {
              // Backspace goes up a folder, as a Mac's Finder does, and
              // with Command moves what is held to the Trash; the rest of
              // the keys are the list's own.
              if ((e.target as HTMLElement).closest("input, textarea")) return;
              if (mine && e.key === "Backspace" && e.metaKey) {
                e.preventDefault();
                void toTrash();
                return;
              }
              if (e.key !== "Backspace" || e.metaKey || e.ctrlKey) return;
              if (colleague && !share) return;
              e.preventDefault();
              if (path.length > 0) leaving(() => setPath(path.slice(0, -1)));
              else if (share)
                leaving(() => {
                  setShare(null);
                  setPath([]);
                });
            }}
          >
            <ScrollArea className="min-h-0 flex-1">
              {shown === undefined ? (
                <p className="grid h-full place-items-center p-3 text-body-medium text-text-secondary">
                  Looking…
                </p>
              ) : failed ? (
                <p className="grid h-full place-items-center p-3 text-body-medium text-text-error-primary">
                  {failed}
                </p>
              ) : rows.length === 0 ? (
                // Which nothing this is, and the way out of it.
                <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
                  <span className="text-body-medium text-text-secondary">
                    {word
                      ? "Nothing is called that."
                      : entries?.length
                        ? "Only hidden files"
                        : "Nothing here yet"}
                  </span>
                  <span className="text-body-regular text-text-tertiary">
                    {word
                      ? "Try another word."
                      : entries?.length
                        ? ""
                        : "Drop a file here, or Upload."}
                  </span>
                  {!word && entries?.length ? (
                    <Button
                      variant="secondary"
                      size="small"
                      onClick={() => setDotfiles(true)}
                    >
                      Show hidden files
                    </Button>
                  ) : null}
                  {!word && !entries?.length && (
                    <Button
                      variant="secondary"
                      size="small"
                      leadingIcon={RiUploadLine}
                      onClick={() => input.current?.click()}
                    >
                      Upload a file
                    </Button>
                  )}
                </div>
              ) : (
                // The folder as a table: the columns it can be sorted by
                // across the top and staying there, a hairline between
                // rows, a row per thing with its mark and its name; a
                // press on a row opens it.
                <Table
                  aria-label="Files"
                  size="sm"
                  selectionMode="multiple"
                  selectionBehavior="replace"
                  selectedKeys={selected}
                  onSelectionChange={setSelected}
                  sortDescriptor={sort}
                  onSortChange={(next) => {
                    setSort(next);
                    setPage(1);
                  }}
                  onRowAction={(key) => {
                    const e = rows.find((x) => x.name === key);
                    if (e) open(e);
                  }}
                  containerClassName="overflow-x-visible"
                  className="table-fixed [&_tbody_tr]:border-b-0! [&_td]:h-7 [&_td]:px-3! [&_td]:py-0! @max-[520px]/list:[&_td]:py-1.5! [&_td]:text-body-regular! [&_th]:px-3! [&_th]:py-1! [&_th]:text-caption-1-medium! [&_th]:text-text-tertiary! [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:border-t-0!"
                >
                  <TableHeader>
                    {COLUMNS.map((c) => (
                      <TableColumn
                        key={c.id}
                        id={c.id}
                        isRowHeader={c.id === "name"}
                        allowsSorting
                        className={c.className}
                      >
                        {/* The mark is drawn from our own state rather
                            than the column's render prop, which is made
                            afresh on every sort and so never turns. */}
                        <span
                          className={cx(
                            "inline-flex h-5 cursor-pointer items-center gap-0.5",
                            c.id !== "name" && "justify-end",
                          )}
                        >
                          {c.label}
                          <SortMark
                            dir={
                              sort.column === c.id ? sort.direction : undefined
                            }
                          />
                        </span>
                      </TableColumn>
                    ))}
                  </TableHeader>
                  <TableBody>
                    {rows.map((e) => {
                      const Mark = markOf(e);
                      const on = selected === "all" || selected.has(e.name);
                      return (
                        <TableRow
                          key={e.name}
                          id={e.name}
                          onContextMenu={() => {
                            setTarget(e);
                            // The row under the right-click is the one the
                            // menu is about, unless it is among those held.
                            if (!on) setSelected(new Set([e.name]));
                          }}
                          className={cx(
                            "cursor-default",
                            on
                              ? "bg-accent-600 text-text-white"
                              : "even:bg-background-secondary-default/60 hover:bg-background-primary-hover",
                          )}
                        >
                          <TableCell>
                            <span
                              className="flex items-center gap-2 @max-[400px]/list:min-h-8"
                              draggable={
                                (e.kind === "dir" || e.kind === "file") &&
                                renaming?.of !== e.name
                              }
                              onDragStart={(ev) => {
                                ev.dataTransfer.setData(
                                  CARRIED,
                                  JSON.stringify({
                                    path: at(e.name),
                                    kind: e.kind,
                                  }),
                                );
                                ev.dataTransfer.effectAllowed = "link";
                              }}
                            >
                              <Mark
                                className={cx(
                                  "size-4 shrink-0",
                                  on
                                    ? "text-text-white"
                                    : "text-foreground-icon-secondary",
                                )}
                                aria-hidden
                              />
                              <span className="flex min-w-0 flex-1 flex-col">
                                {renaming?.of === e.name ? (
                                  <InputBase
                                    aria-label="Name"
                                    size="small"
                                    value={renaming.to}
                                    ref={(el) => {
                                      // Focused as it appears, with the name
                                      // and not the extension selected.
                                      if (!el || document.activeElement === el)
                                        return;
                                      el.focus();
                                      const dot = e.name.lastIndexOf(".");
                                      el.setSelectionRange(
                                        0,
                                        e.kind === "file" && dot > 0
                                          ? dot
                                          : e.name.length,
                                      );
                                    }}
                                    onChange={(ev) =>
                                      setRenaming({
                                        of: e.name,
                                        to: ev.target.value,
                                      })
                                    }
                                    onBlur={() => void finishRename(true)}
                                    onKeyDown={(ev) => {
                                      // The keys are the field's, not the
                                      // list's: Return keeps the name and
                                      // Escape leaves it.
                                      ev.stopPropagation();
                                      if (ev.key === "Enter") {
                                        ev.preventDefault();
                                        void finishRename(true);
                                      } else if (ev.key === "Escape") {
                                        ev.preventDefault();
                                        void finishRename(false);
                                      }
                                    }}
                                    onPointerDown={(ev) => ev.stopPropagation()}
                                    onClick={(ev) => ev.stopPropagation()}
                                    onDoubleClick={(ev) => ev.stopPropagation()}
                                    fieldClassName="h-6 flex-1 bg-background-primary-default text-text-primary"
                                    className="text-body-regular text-text-primary"
                                  />
                                ) : (
                                  <span
                                    className={cx(
                                      "flex items-center gap-1.5 truncate text-body-regular",
                                      on
                                        ? "text-text-white"
                                        : "text-text-primary",
                                    )}
                                    title={e.name}
                                  >
                                    <span className="truncate">{e.name}</span>
                                    {e.id && !colleague && (
                                      <RiShareForwardLine
                                        className={cx(
                                          "size-3.5 shrink-0",
                                          on
                                            ? "text-text-white"
                                            : "text-foreground-icon-tertiary",
                                        )}
                                        aria-label="Shared"
                                      />
                                    )}
                                  </span>
                                )}
                                {/* What the columns had to give up, kept
                                    where there is no room for them. */}
                                <span
                                  className={cx(
                                    "hidden truncate text-caption-1-regular tabular-nums @max-[520px]/list:block",
                                    on
                                      ? "text-text-white"
                                      : "text-text-secondary",
                                  )}
                                >
                                  {e.kind === "dir" ? "" : size(e.size)}
                                  <span className="hidden @max-[400px]/list:inline">
                                    {e.kind === "dir"
                                      ? when(e.modified)
                                      : ` · ${when(e.modified)}`}
                                  </span>
                                </span>
                              </span>
                            </span>
                          </TableCell>
                          <TableCell
                            className={cx(
                              "text-right whitespace-nowrap",
                              NARROW.size,
                            )}
                          >
                            <span
                              className={cx(
                                "tabular-nums",
                                on ? "text-text-white" : "text-text-secondary",
                              )}
                            >
                              {e.kind === "dir" || !e.modified
                                ? "--"
                                : size(e.size)}
                            </span>
                          </TableCell>
                          <TableCell
                            className={cx("whitespace-nowrap", NARROW.kind)}
                          >
                            <span
                              className={cx(
                                "truncate",
                                on ? "text-text-white" : "text-text-secondary",
                              )}
                            >
                              {kindOf(e)}
                            </span>
                          </TableCell>
                          <TableCell
                            className={cx(
                              "text-right whitespace-nowrap",
                              NARROW.modified,
                            )}
                          >
                            <span
                              className={cx(
                                "tabular-nums",
                                on ? "text-text-white" : "text-text-secondary",
                              )}
                            >
                              {when(e.modified)}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </ScrollArea>
            {shown && shown.length > PER_PAGE && (
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-separator-border px-3 py-2">
                <span className="shrink-0 text-caption-1-medium text-text-secondary tabular-nums">
                  {(here - 1) * PER_PAGE + 1}–
                  {Math.min(here * PER_PAGE, shown.length)} of {shown.length}
                </span>
                <Pagination
                  page={here}
                  totalPages={pages}
                  onChange={setPage}
                  className="min-w-0"
                />
              </div>
            )}
          </ContextMenuTrigger>
          <ContextMenuContent
            // A rename begun from the menu keeps the field's focus.
            finalFocus={() => !renaming}
          >
            {target && (
              <>
                <ContextMenuItem onClick={() => open(target)}>
                  Open
                </ContextMenuItem>
                {mine && (
                  <>
                    <ContextMenuItem onClick={() => startRename(target)}>
                      Rename
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => void toTrash()}>
                      Move to Trash
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                  </>
                )}
                {!colleague &&
                  (target.kind === "dir" || target.kind === "file") && (
                    <ContextMenuItem onClick={() => void openSheet(target)}>
                      Share…
                    </ContextMenuItem>
                  )}
                {target.id && (
                  <ContextMenuItem
                    onClick={() =>
                      void navigator.clipboard.writeText(shareLink(target.id!))
                    }
                  >
                    Copy link
                  </ContextMenuItem>
                )}
                <ContextMenuSeparator />
              </>
            )}
            {!target && mine && (
              <>
                <ContextMenuItem onClick={() => void newFolder()}>
                  New Folder
                </ContextMenuItem>
                <ContextMenuSeparator />
              </>
            )}
            <ContextMenuCheckboxItem
              checked={dotfiles}
              onCheckedChange={(on) => setDotfiles(on)}
            >
              Show hidden files
            </ContextMenuCheckboxItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>

      {/* The sheet a file or folder of the person's own is shared from:
          the one every shared thing has. */}
      {sharing && (
        <ShareSheet
          open={sharingEntry !== null}
          title={`Share ${sharingEntry?.name ?? ""}`}
          description="Whoever you pick finds it in Files under your name and opens the link below. For everybody else the link is not there at all."
          link={sharingEntry?.id ? shareLink(sharingEntry.id) : ""}
          parties={sharing}
          on={reachOf(sharing, sharingEntry?.id)}
          levels
          onSave={(to) =>
            sharingEntry ? setReach(sharingEntry, to) : Promise.resolve(null)
          }
          onClose={() => setSharingEntry(null)}
        />
      )}

      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, transition: LEAVE }}
            transition={FAST}
            className="pointer-events-none absolute inset-2 grid place-items-center rounded-3xl border border-border-focus-ring bg-background-secondary-default/90 text-body-medium text-text-secondary"
          >
            Drop it here.
          </motion.div>
        )}
      </AnimatePresence>

      {/* An edit is never thrown away without a word. */}
    </div>
  );
}
