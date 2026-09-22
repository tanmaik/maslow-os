"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Row, Rows } from "@/app/settings/row";
import { ImageInput } from "@/components/image-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

// Publishing a port as an app: the name it will go by and the face it
// will wear, the port's own offered first and changed here if the person
// likes, whether it opens as a window or in a browser tab of its own, and
// one Add to Dock. An app already published is changed the same way, or
// taken off the shelf.
export function PublishSheet({
  port,
  name,
  face,
  tab,
  unframed,
  published,
  onClose,
}: {
  port: number;
  // What the port is called today: the app's name where it has one, the
  // program's otherwise.
  name: string;
  // The favicon the door found on the port, if any.
  face: string | undefined;
  // Whether it opens in a browser tab today, and whether its page refuses
  // to be shown in a window at all, which leaves no choice.
  tab: boolean;
  unframed: boolean;
  published: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [inTab, setInTab] = useState(tab);
  // A page that refuses a window leaves no choice, whenever that is learnt.
  const on = inTab || unframed;
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
              {published
                ? `Port ${port}, as an app`
                : `Make port ${port} an app`}
            </DialogTitle>
            <DialogDescription>
              An app is in your sidebar and in search, by its name and its icon,
              while its port is listening. Whoever you share it with sees the
              same.
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
            <Field className="min-w-0 flex-1">
              <FieldLabel htmlFor={`app-${port}-name`}>Name</FieldLabel>
              <Input
                id={`app-${port}-name`}
                name="name"
                defaultValue={name}
                maxLength={120}
                required
                autoFocus
              />
            </Field>
          </div>
          <input type="hidden" name="tab" value={on ? "on" : "off"} />
          <Rows>
            <Row
              label="Open in a browser tab"
              description={
                unframed
                  ? "This app does not allow itself to be shown in a window."
                  : "Off, it opens as a window on your desktop."
              }
            >
              <Switch
                size="sm"
                aria-label="Open in a browser tab"
                checked={on}
                disabled={unframed}
                onCheckedChange={setInTab}
              />
            </Row>
          </Rows>
          {refused && <p className="text-sm text-destructive">{refused}</p>}
          <DialogFooter>
            {published && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={busy}
                onClick={() => {
                  const form = new FormData();
                  form.set("port", String(port));
                  form.set("unpublish", "on");
                  void send(form);
                }}
              >
                Stop being an app
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {published ? "Save" : "Make it an app"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
