"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { ImageInput } from "@/components/image-input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// Publishing a port as an app: the name it will go by and the face it
// will wear, the port's own offered first and changed here if the person
// likes, and one Publish. An app already published is renamed the same
// way, or taken off the shelf.
export function PublishSheet({
  port,
  name,
  face,
  published,
  onClose,
}: {
  port: number;
  // What the port is called today: the app's name where it has one, the
  // program's otherwise.
  name: string;
  // The favicon the door found on the port, if any.
  face: string | undefined;
  published: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [refused, setRefused] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (form: FormData) => {
    setBusy(true);
    const res = await fetch("/computer/publish", {
      method: "POST",
      body: form,
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setRefused(res ? await res.text() : "Could not save.");
    router.refresh();
    onClose();
  };
  return (
    <Dialog open onOpenChange={(now) => !now && onClose()}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(new FormData(e.currentTarget));
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>
              {published ? `Port ${port}, as an app` : `Publish port ${port}`}
            </DialogTitle>
            <DialogDescription>
              An app is on your shelf, in the dock and the command bar, by its
              name and its face, while its port is listening. Whoever you share
              the port with sees the same.
            </DialogDescription>
          </DialogHeader>
          <input type="hidden" name="port" value={port} />
          {face && <input type="hidden" name="face" value={face} />}
          <div className="flex items-center gap-4">
            <ImageInput
              id={`app-${port}-icon`}
              name="icon"
              src={face ?? null}
              fallback={(name.trim()[0] ?? "A").toUpperCase()}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <label
                htmlFor={`app-${port}-name`}
                className="text-caption-1-medium text-text-secondary"
              >
                Name
              </label>
              <Input
                id={`app-${port}-name`}
                name="name"
                defaultValue={name}
                maxLength={120}
                isRequired
                autoFocus
              />
            </div>
          </div>
          {refused && (
            <p className="text-body-regular text-text-error-primary">
              {refused}
            </p>
          )}
          <DialogFooter>
            {published && (
              <Button
                type="button"
                variant="danger"
                size="small"
                disabled={busy}
                onClick={() => {
                  const form = new FormData();
                  form.set("port", String(port));
                  form.set("unpublish", "on");
                  void send(form);
                }}
              >
                Unpublish
              </Button>
            )}
            <Button
              type="button"
              variant="secondary"
              size="small"
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" size="small" disabled={busy}>
              {published ? "Save" : "Publish"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
