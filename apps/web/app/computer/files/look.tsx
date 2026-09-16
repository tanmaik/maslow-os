"use client";

import { RiExternalLinkLine } from "@remixicon/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";

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
  size,
} from "@/app/computer/files/kinds";
import { InBar, useBeforeClose } from "@/app/desktop/panel";
import {
  ButtonGroup,
  ButtonGroupItem,
} from "@/components/base/buttons/button-group";
import { Notification } from "@/components/base/notification/notification";
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

// One file of the person's, in a window of its own: a picture or a video
// as it is, text in an editor with a save, and anything else named with
// the way to save it down. The window's name is the file's; its bar holds
// the size, Save and Open. Opened from Files, from the command bar, or by
// `open` on the machine.
export function Look({ href }: { href?: string }) {
  const path = href ? new URL(href, "http://x").searchParams.get("path") : null;
  const [entry, setEntry] = useState<Entry | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  // Whether the person is being asked about words not saved.
  const [asking, setAsking] = useState<null | {
    go: () => void;
    stop: () => void;
  }>(null);
  const name = path?.split("/").filter(Boolean).at(-1) ?? "";
  const folder = path?.split("/").filter(Boolean).slice(0, -1).join("/") ?? "";
  const heavy =
    entry !== null &&
    (isText(entry) || isUnknown(entry)) &&
    entry.size > MOST_TEXT;
  // Whether the file is edited here: text by name, or found to be text.
  const editable =
    entry !== null &&
    !heavy &&
    (isText(entry) || (isUnknown(entry) && text !== null));

  // The file as its folder lists it, then its text where it is text.
  useEffect(() => {
    if (!path) return;
    let gone = false;
    (async () => {
      const res = await fetch(
        `/computer/files/list?path=${encodeURIComponent(folder || ".")}`,
      );
      if (!res.ok) throw new Error(await res.text());
      const found = ((await res.json()) as Entry[]).find(
        (e) => e.name === name,
      );
      if (gone) return;
      if (!found) {
        setFailed("That file is not there any more.");
        return;
      }
      setEntry(found);
      // Text by name, or a file of no known kind that turns out to be
      // text once read.
      if ((isText(found) || isUnknown(found)) && found.size <= MOST_TEXT) {
        const r = await fetch(readHref(path));
        const got = r.ok ? await r.text() : "";
        if (!gone) setText(isText(found) || looksLikeText(got) ? got : null);
      }
    })().catch((e) => !gone && setFailed(e.message));
    return () => {
      gone = true;
    };
  }, [path, folder, name]);

  const save = async () => {
    if (!path || text === null) return false;
    setSaving(true);
    setRefused(null);
    const res = await fetch(
      `/computer/files/write?path=${encodeURIComponent(path)}`,
      { method: "PUT", body: text },
    );
    setSaving(false);
    if (!res.ok) {
      setRefused((await res.text()) || "The machine would not take it.");
      return false;
    }
    setDirty(false);
    return true;
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

  if (!path)
    return (
      <p className="grid h-full place-items-center p-3 text-body-medium text-text-secondary">
        Nothing to look at.
      </p>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <InBar
        as={(controls) => (
          <div className="flex h-8 shrink-0 items-center justify-end gap-2 border-b border-separator-border px-2">
            {controls}
          </div>
        )}
      >
        <span className="ml-auto flex items-center gap-2">
          {dirty && (
            <span
              className="size-1.5 shrink-0 rounded-full bg-accent-500"
              title="Not saved yet"
              aria-label="Not saved yet"
              role="img"
            />
          )}
          {entry && (
            <span className="shrink-0 text-caption-1-medium text-text-secondary tabular-nums">
              {size(entry.size)}
            </span>
          )}
          <ButtonGroup size="small" aria-label="What to do with it">
            {editable && (
              <ButtonGroupItem
                size="small"
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
              </ButtonGroupItem>
            )}
            <ButtonGroupItem
              size="small"
              leadingIcon={RiExternalLinkLine}
              onClick={() => window.open(readHref(path), "_blank", "noopener")}
            >
              Open
            </ButtonGroupItem>
          </ButtonGroup>
        </span>
      </InBar>
      {refused && (
        <div className="shrink-0 border-b border-separator-border p-3">
          <Notification
            status="error"
            title="That was not saved"
            description={refused}
            dismissible
            onDismiss={() => setRefused(null)}
          />
        </div>
      )}
      <div className="min-h-0 flex-1">
        {failed ? (
          <p className="grid h-full place-items-center p-3 text-body-medium text-text-error-primary">
            {failed}
          </p>
        ) : !entry ? (
          <p className="grid h-full place-items-center p-3 text-body-medium text-text-secondary">
            Looking…
          </p>
        ) : isAudio(entry) ? (
          <div className="grid h-full place-items-center bg-background-full p-6">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <audio controls preload="metadata" src={readHref(path)} />
          </div>
        ) : isVideo(entry) ? (
          <div className="grid h-full place-items-center bg-background-full">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              controls
              playsInline
              preload="metadata"
              poster={previewHref(path, entry.modified)}
              src={readHref(path)}
              className="h-full w-full object-contain"
            />
          </div>
        ) : isPdf(entry) || isDocument(entry) ? (
          <iframe
            title={name}
            src={pdfHref(path, entry.modified)}
            className="h-full w-full border-0 bg-background-secondary-default"
          />
        ) : isImage(entry) ? (
          <div className="grid h-full place-items-center overflow-auto bg-background-secondary-default p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              // A picture is made on the machine; a small SVG is shown as is.
              src={
                ending(name) === "svg"
                  ? readHref(path)
                  : previewHref(path, entry.modified)
              }
              alt={name}
              className="max-h-full max-w-full object-contain shadow-card"
            />
          </div>
        ) : editable || (isText(entry) && !heavy) ? (
          text === null ? (
            <p className="grid h-full place-items-center p-3 text-body-medium text-text-secondary">
              Looking…
            </p>
          ) : (
            <Editor
              name={name}
              value={text}
              onChange={(next) => {
                setText(next);
                setDirty(true);
              }}
            />
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
            <span className="text-body-medium text-text-secondary">{name}</span>
            <span className="text-body-regular text-text-tertiary">
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
