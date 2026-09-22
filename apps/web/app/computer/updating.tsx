"use client";

import { RiRefreshLine } from "@remixicon/react";
import { useEffect, useState } from "react";

import { Row, Rows } from "@/app/settings/row";
import { Button } from "@/components/ui/button";
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
import type { Update } from "@/lib/computer";
import type { Stats } from "@/lib/door";

// The person told to update: what is on their computer this moment, asked
// of its door as the dialog opens, so the restart names what it stops
// before it stops it. Their files are never touched.
export function UpdateDialog({
  open,
  onOpenChange,
  onTake,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTake: () => void;
}) {
  // What the restart stops: null while the door is asked, false when it
  // did not say.
  const [stops, setStops] = useState<string[] | false | null>(null);
  useEffect(() => {
    if (!open) return;
    let gone = false;
    setStops(null);
    fetch("/computer/stats")
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json() as Promise<Stats>;
      })
      .then((s) => {
        if (gone) return;
        setStops([
          ...s.ports.map(
            (x) => `port ${x.port}${x.name ? ` (${x.name})` : ""}`,
          ),
          ...(s.running ?? []),
        ]);
      })
      .catch(() => {
        if (!gone) setStops(false);
      });
    return () => {
      gone = true;
    };
  }, [open]);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Update your computer?</AlertDialogTitle>
          <AlertDialogDescription>
            {stops === null
              ? "Seeing what is running…"
              : stops === false
                ? "Your computer did not say what is running on it. Updating stops whatever is; your files are untouched, and it is back in about a minute."
                : stops.length === 0
                  ? "Nothing is running on your computer. Your files are untouched, and it is back in about a minute."
                  : `This stops ${stops.join(", ")}. Your files are untouched, and your computer is back in about a minute.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Not now</AlertDialogCancel>
          <AlertDialogAction
            disabled={stops === null}
            onClick={() => {
              onOpenChange(false);
              onTake();
            }}
          >
            Update
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// The update waiting on the person, as a row of the Computer pane: one
// button, which asks first.
export function Updating({
  update,
  onTake,
}: {
  update: Update;
  onTake: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <Rows>
      <Row
        label="An update is ready"
        description={`Image ${update.image}, ready since ${on(update.readyAt)}. Your computer restarts to take it, which takes about a minute.`}
      >
        <Button size="sm" onClick={() => setAsking(true)}>
          <RiRefreshLine data-icon="inline-start" />
          Update
        </Button>
      </Row>
      {failed && (
        <Row label="That did not happen" description={failed}>
          <span />
        </Row>
      )}
      <UpdateDialog
        open={asking}
        onOpenChange={setAsking}
        onTake={() => {
          setFailed(null);
          onTake().catch((err) => setFailed((err as Error).message));
        }}
      />
    </Rows>
  );
}

const on = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
