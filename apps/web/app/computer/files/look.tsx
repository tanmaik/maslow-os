"use client";

import { RiExternalLinkLine, RiUploadLine } from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import { Editor } from "@/app/computer/files/editor";
import {
  type Entry,
  MOST_TEXT,
  ending,
  isAudio,
  isDocument,
  isImage,
  isPdf,
  isText,
  isUnknown,
  isVideo,
  looksLikeText,
  pdfHref,
  previewHref,
  readHref,
  sharedHref,
  size,
} from "@/app/computer/files/kinds";
import { putShared } from "@/app/computer/files/shared-upload";
import { InBar, useBeforeClose } from "@/app/desktop/panel";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { CloseButton } from "@/components/ui/close-button";
import { BASE, LEAVE } from "@/lib/motion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// How often a page with a colleague's file open asks whether it changed,
// while the person is only reading it.
const RECHECK_MS = 5000;

// What a colleague's file says of itself: the file, whose it is, how much
// the person may do, and whether the answer came from the machine.
type Stat = Entry & {
  owner: string;
  level: "view" | "edit" | "owner";
  live: boolean;
};

// One file, in a window of its own: a picture or a video as it is, text
// in an editor with a save, and anything else named with the way to save
// it down. The file is the person's own, or one a colleague shared, by
// its id and a path under it. The window's name is the file's; its bar
// holds the size, Save and Open. Opened from Files, from the command bar,
// by `open` on the machine, or by a shared file's link.
export function Look({ href }: { href?: string }) {
  const asked = href ? new URL(href, "http://x").searchParams : null;
  const share = asked?.get("share") || null;
  const path = asked?.get("path") ?? null;
  // Where the file is read, written and pictured: on the person's own
  // computer, or through the share it was opened by.
  const at = (what: "read" | "write" | "pdf" | "stat" | "upload") =>
    share ? sharedHref(share, what, path ?? "") : readHref(path ?? "");
  const [entry, setEntry] = useState<Entry | null>(null);
  const [about, setAbout] = useState<Stat | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  // When the file was last changed as it was opened, which a save names,
  // so one that fell behind is said before it lands.
  const [opened, setOpened] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // A save that fell behind: the file changed since it was opened, at
  // this time. The person's text stays where it is, in reach, until they
  // save it over theirs or take theirs.
  const [behind, setBehind] = useState<string | null>(null);
  // Whether the person is being asked about words not saved.
  const [asking, setAsking] = useState<null | {
    go: () => void;
    stop: () => void;
  }>(null);
  const [replacing, setReplacing] = useState(false);
  // Which text the editor opened with: a colleague's save taken in is a
  // new one, so the editor opens it fresh.
  const [taken, setTaken] = useState(0);
  const picker = useRef<HTMLInputElement>(null);
  const name =
    path?.split("/").filter(Boolean).at(-1) ?? about?.name ?? entry?.name ?? "";
  const folder = path?.split("/").filter(Boolean).slice(0, -1).join("/") ?? "";
  const heavy =
    entry !== null &&
    (isText(entry) || isUnknown(entry)) &&
    entry.size > MOST_TEXT;
  // Whether the person may change it: their own, or shared at edit.
  const mayEdit = !share || (about !== null && about.level !== "view");
  // Whether the person has typed since the text was taken in, for a look
  // already under way to leave their words alone.
  const typing = useRef(false);
  typing.current = dirty;
  // Whether the file is edited here: text by name, or found to be text.
  // Whether the file is read as text here: text by name, or found to be
  // text; and whether it is edited here, which also takes the right to.
  const readable =
    entry !== null &&
    !heavy &&
    (isText(entry) || (isUnknown(entry) && text !== null));
  const editable = readable && mayEdit;

  // The file as its folder lists it, or as the share says it is, then
  // its text where it is text.
  const look = async (gone: () => boolean) => {
    let found: Entry | undefined;
    if (share) {
      const res = await fetch(at("stat"));
      if (res.status === 404) {
        setFailed("That file is not there any more.");
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      const s = (await res.json()) as Stat;
      if (gone()) return;
      setAbout(s);
      found = s;
    } else {
      const res = await fetch(
        `/computer/files/list?path=${encodeURIComponent(folder || ".")}`,
      );
      if (!res.ok) throw new Error(await res.text());
      found = ((await res.json()) as Entry[]).find((e) => e.name === name);
    }
    if (gone()) return;
    if (!found) {
      setFailed("That file is not there any more.");
      return;
    }
    setEntry(found);
    setOpened(found.modified);
    // Text by name, or a file of no known kind that turns out to be
    // text once read.
    if ((isText(found) || isUnknown(found)) && found.size <= MOST_TEXT) {
      const r = await fetch(at("read"));
      const got = r.ok ? await r.text() : "";
      if (gone()) return;
      setText(isText(found) || looksLikeText(got) ? got : null);
      setTaken((n) => n + 1);
    }
  };
  useEffect(() => {
    if (!path && !share) return;
    let gone = false;
    look(() => gone).catch((e) => !gone && setFailed(e.message));
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, share, folder, name]);

  // A colleague's file is asked after every few seconds while it is only
  // being read, and taken in again when it changed, so a reader is never
  // more than a moment behind whoever saved.
  useEffect(() => {
    if (!share || dirty || !entry) return;
    const timer = setInterval(() => {
      void (async () => {
        const res = await fetch(at("stat"));
        if (!res.ok) return;
        const s = (await res.json()) as Stat;
        if (s.modified !== opened) await look(() => typing.current);
      })().catch(() => {});
    }, RECHECK_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share, dirty, entry, opened]);

  // Saves the text, naming when the file was opened; a file changed since
  // is not written over but asked about, unless the person said so.
  const save = async (anyway = false) => {
    if ((!path && !share) || text === null) return false;
    setSaving(true);
    setRefused(null);
    const res = await fetch(
      share
        ? at("write")
        : `/computer/files/write?path=${encodeURIComponent(path!)}`,
      {
        method: "PUT",
        headers: opened && !anyway ? { "x-maslow-opened": opened } : {},
        body: text,
      },
    );
    setSaving(false);
    if (res.status === 409) {
      const said = (await res.json().catch(() => null)) as {
        modified?: string;
      } | null;
      if (said?.modified) {
        setBehind(said.modified);
        return false;
      }
    }
    if (!res.ok) {
      setRefused((await res.text()) || "The machine would not take it.");
      return false;
    }
    const wrote = (await res.json()) as { modified?: string };
    if (wrote.modified) setOpened(wrote.modified);
    setDirty(false);
    return true;
  };

  // A colleague at edit replaces a picture, a PDF or anything else that
  // is not edited in place: an upload over it.
  const replace = async (file: File) => {
    if (!share) return;
    setReplacing(true);
    setRefused(null);
    try {
      await putShared(share, path ?? "", file, () => {});
      await look(() => false);
    } catch (err) {
      setRefused((err as Error).message);
    } finally {
      setReplacing(false);
    }
  };

  // Nothing typed is thrown away without asking: the room asks here
  // before it takes the window away, and the tab before it goes.
  useBeforeClose(
    () =>
      new Promise<boolean>((decide) => {
        if (!dirty) return decide(true);
        setAsking({ go: () => decide(true), stop: () => decide(false) });
      }),
  );
  useEffect(() => {
    if (!dirty) return;
    const hold = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [dirty]);

  if (!path && !share)
    return (
      <p className="grid h-full place-items-center p-3 text-sm font-medium text-muted-foreground">
        Nothing to look at.
      </p>
    );
  // Where a picture or a PDF is drawn from: the person's own is pictured
  // on their machine; a colleague's is shown as it is, at an address that
  // changes with the file so a replacement is drawn afresh.
  const fresh = (href: string) =>
    `${href}&v=${encodeURIComponent(entry?.modified ?? "")}`;
  const picture = share
    ? fresh(at("read"))
    : ending(name) === "svg"
      ? readHref(path!)
      : previewHref(path!, entry?.modified ?? "");
  const paper = share
    ? fresh(entry && isDocument(entry) ? at("pdf") : at("read"))
    : pdfHref(path!, entry?.modified ?? "");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <InBar
        as={(controls) => (
          <div className="flex h-9 shrink-0 items-center justify-end gap-2 border-b border-border px-2">
            {controls}
          </div>
        )}
      >
        <span className="ml-auto flex items-center gap-2">
          {about && (
            <span className="shrink-0 truncate text-xs font-medium text-muted-foreground">
              {about.owner}&rsquo;s
              {about.level === "view" ? ", view only" : ""}
            </span>
          )}
          {dirty && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-primary"
              title="Not saved yet"
              aria-label="Not saved yet"
              role="img"
            />
          )}
          {entry && (
            <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
              {size(entry.size)}
            </span>
          )}
          <ButtonGroup aria-label="What to do with it">
            {editable && (
              <Button
                variant="outline"
                size="sm"
                disabled={!dirty || saving}
                onClick={() => void save()}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={saving ? "saving" : "save"}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: LEAVE }}
                    transition={BASE}
                    className="block"
                  >
                    {saving ? "Saving…" : "Save"}
                  </motion.span>
                </AnimatePresence>
              </Button>
            )}
            {share && mayEdit && entry && !editable && (
              <Button
                variant="outline"
                size="sm"
                disabled={replacing}
                onClick={() => picker.current?.click()}
              >
                <RiUploadLine data-icon="inline-start" />
                {replacing ? "Replacing…" : "Replace"}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(at("read"), "_blank", "noopener")}
            >
              <RiExternalLinkLine data-icon="inline-start" />
              Open
            </Button>
          </ButtonGroup>
          <input
            ref={picker}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void replace(f);
              e.target.value = "";
            }}
          />
        </span>
      </InBar>
      {refused && (
        <div className="shrink-0 border-b border-border p-3">
          <Alert variant="destructive">
            <AlertTitle>That was not saved</AlertTitle>
            <AlertDescription>{refused}</AlertDescription>
            <AlertAction>
              <CloseButton
                size="icon-xs"
                aria-label="Dismiss"
                onClick={() => setRefused(null)}
              />
            </AlertAction>
          </Alert>
        </div>
      )}
      {/* A save that fell behind is said here, over the person's own
          text, which stays exactly as they typed it and in reach, so
          they can keep what they need before saving over theirs or
          taking theirs. */}
      {behind !== null && (
        <div className="shrink-0 border-b border-border p-3">
          <Alert>
            <AlertTitle>It changed since you opened it</AlertTitle>
            <AlertDescription>
              {`Someone saved ${name} while you had it open. What you typed is still here and not saved: save it over theirs, or take theirs and lose it.`}
              <span className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    setBehind(null);
                    void save(true);
                  }}
                >
                  Save anyway
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    setBehind(null);
                    setDirty(false);
                    void look(() => false).catch((e) => setFailed(e.message));
                  }}
                >
                  Take theirs
                </Button>
              </span>
            </AlertDescription>
            <AlertAction>
              <CloseButton
                size="icon-xs"
                aria-label="Dismiss"
                onClick={() => setBehind(null)}
              />
            </AlertAction>
          </Alert>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {failed ? (
          <p className="grid h-full place-items-center p-3 text-sm font-medium text-destructive">
            {failed}
          </p>
        ) : !entry ? (
          <p className="grid h-full place-items-center p-3 text-sm font-medium text-muted-foreground">
            Looking…
          </p>
        ) : isAudio(entry) ? (
          <div className="grid h-full place-items-center bg-background p-6">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls preload="metadata" src={at("read")} />
          </div>
        ) : isVideo(entry) ? (
          <div className="grid h-full place-items-center bg-background">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              controls
              playsInline
              preload="metadata"
              poster={share ? undefined : previewHref(path!, entry.modified)}
              src={at("read")}
              className="h-full w-full object-contain"
            />
          </div>
        ) : isPdf(entry) || isDocument(entry) ? (
          <iframe
            title={name}
            src={paper}
            className="h-full w-full border-0 bg-muted"
          />
        ) : isImage(entry) ? (
          <div className="grid h-full place-items-center overflow-auto bg-muted p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={picture}
              alt={name}
              className="max-h-full max-w-full object-contain "
            />
          </div>
        ) : readable ? (
          text === null ? (
            <p className="grid h-full place-items-center p-3 text-sm font-medium text-muted-foreground">
              Looking…
            </p>
          ) : (
            <Editor
              key={taken}
              name={name}
              value={text}
              readOnly={!mayEdit}
              onChange={(next) => {
                setText(next);
                setDirty(true);
              }}
            />
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
            <span className="text-sm font-medium text-muted-foreground">
              {name}
            </span>
            <span className="text-sm text-muted-foreground">
              {size(entry.size)}.{" "}
              {heavy ? "Too big to open here." : "Nothing to show."} Open it to
              save it.
            </span>
          </div>
        )}
      </div>
      <AlertDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open && asking) {
            asking.stop();
            setAsking(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              What you typed in {name} has not been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                asking?.go();
                setAsking(null);
              }}
            >
              Leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
